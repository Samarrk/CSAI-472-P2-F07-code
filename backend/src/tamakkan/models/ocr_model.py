"""
src/tamakkan/models/ocr_model.py

Speed limit sign reader, using EasyOCR.

What this does:
The tracker already detects traffic signs (class 5 in YOLO) and gives each physical sign a stable track_id that follows it across frames. This file is handed those signs (frame + Track) and reads the number off them. It does not run its own detector.

Why the cache is keyed by track_id:
The camera is on a moving car, so a sign's pixel position changes every single frame as we approach it.

ByteTrack solves this. It gives each sign a track_id that stays the same as the sign moves across the frame. So we cache by track_id, OCR each physical sign roughly once, and reuse the result for the rest of the time we can see it.

Same as the other model wrappers in this folder:
- one job: read a number off a handed crop
- per-track caching plus size gating so EasyOCR runs as rarely as possible
- dataclass return type, auto GPU detection, smoke test at the bottom
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import List, Optional

import cv2
import numpy as np

try:
    import torch
    _HAS_TORCH = True
except ImportError:
    _HAS_TORCH = False

import easyocr


# Saudi speed limits in km/h. anything outside this set is treated as a misread and rejected.
VALID_SPEEDS = {20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140}

# do not run EasyOCR on crops smaller than this in pixels. tiny far-away signs almost always fail to read.
MIN_BOX_HEIGHT = 50

# how long a successful reading stays valid for a given track_id.
# a physical speed sign never changes its number, so once we read it we can reuse it for the life of the track. 
CACHE_TTL_SECONDS = 5.0

# tell EasyOCR to only look for digits. 
_OCR_ALLOWLIST = "0123456789"


@dataclass
class SpeedSignReading:
    """
    Result of trying to read one sign track.

    speed     : the limit as an int or None 
    confidence: EasyOCR confidence between 0 and 1 for the chosen reading (0.0 when speed is None).
    track_id  : which sign this reading belongs to.
    from_cache: True if we returned a cached result without running OCR, False if a fresh OCR produced it.
    """
    speed: Optional[int]
    confidence: float
    track_id: int
    from_cache: bool


class SpeedSignOCR:
    """
    EasyOCR-based speed sign reader.

    How the pipeline uses it:
        ocr = SpeedSignOCR()
        for t in tracks:
            if t.is_traffic_sign:
                reading = ocr.read(frame, t)
                if reading.speed is not None:
                    ...
    """

    def __init__(
        self,
        device: str | None = None,
        min_box_height: int = MIN_BOX_HEIGHT,
        cache_ttl_seconds: float = CACHE_TTL_SECONDS,
    ):
        # auto-detect GPU. EasyOCR on CPU takes seconds per call on the Jetson, so never default to that silently.
        if device is None:
            use_gpu = _HAS_TORCH and torch.cuda.is_available()
        else:
            use_gpu = device != "cpu"

        self.reader = easyocr.Reader(["en"], gpu=use_gpu)
        self.use_gpu = use_gpu
        self.min_box_height = min_box_height
        self.cache_ttl = cache_ttl_seconds

        # track_id -> {"speed": int, "confidence": float, "t": timestamp}
        self._cache: dict[int, dict] = {}

    # public API
    def read(self, frame: np.ndarray, track) -> SpeedSignReading:
        """
        Read the speed off one sign track.

        frame: full BGR frame (H, W, 3).
        track: a Track from the tracker. Must have .track_id and .bbox_int (x1, y1, x2, y2). Caller is responsible for only passing in traffic_sign tracks.

        Returns a SpeedSignReading. speed is None when we don't have a confident valid reading yet.
        """
        tid = int(track.track_id)
        now = time.time()

        # 1. cache hit and not expired, return without running OCR
        cached = self._cache.get(tid)
        if cached is not None and (now - cached["t"]) <= self.cache_ttl:
            return SpeedSignReading(
                speed=cached["speed"],
                confidence=cached["confidence"],
                track_id=tid,
                from_cache=True,
            )

        # 2. sanity and size checks before we touch EasyOCR
        if frame is None or frame.size == 0:
            return self._none(tid)

        x1, y1, x2, y2 = track.bbox_int
        h_f, w_f = frame.shape[:2]
        # clamp the bbox to the frame in case YOLO returned coords slightly outside
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w_f, x2), min(h_f, y2)
        if x2 <= x1 or y2 <= y1:
            return self._none(tid)

        # too small to read reliably, skip the OCR call entirely
        if (y2 - y1) < self.min_box_height:
            return self._none(tid)

        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return self._none(tid)

        # 3. run OCR. tries several preprocessing variants and stops at the first one that gives a valid speed.
        speed, conf = self._ocr_crop(crop)

        if speed is not None:
            self._cache[tid] = {"speed": speed, "confidence": conf, "t": now}
            return SpeedSignReading(speed, conf, tid, from_cache=False)

        # OCR didn't find a valid reading this time. if we have an unexpired prior reading for this track, return that instead of None so one bad frame doesn't drop the reading.
        if cached is not None and (now - cached["t"]) <= self.cache_ttl:
            return SpeedSignReading(
                speed=cached["speed"],
                confidence=cached["confidence"],
                track_id=tid,
                from_cache=True,
            )

        return self._none(tid)

    def reset(self):
        """ Clear the per-track cache. Call this between unrelated clips or sessions. """
        self._cache.clear()

    def prune(self, live_track_ids: set[int]):
        """
        Drop cache entries for tracks that no longer exist. The pipeline can call this every so often so the cache dict doesn't grow forever over a long drive.
        """
        dead = [tid for tid in self._cache if tid not in live_track_ids]
        for tid in dead:
            del self._cache[tid]

    # internals
    @staticmethod
    def _preprocess(crop: np.ndarray) -> List[np.ndarray]:
        """
        Return a few processed versions of the crop, in the order most likely to work.
        Otsu thresholding first (works for dark text on light signs), then inverted Otsu (light text on dark background), then plain grayscale as a fallback.
        Small crops get upscaled more.
        """
        scale = 3.0 if crop.shape[0] < 80 else 2.0
        big = cv2.resize(crop, None, fx=scale, fy=scale,
                         interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)
        _, th = cv2.threshold(gray, 0, 255,
                              cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return [th, cv2.bitwise_not(th), gray]

    def _ocr_crop(self, crop: np.ndarray) -> tuple[Optional[int], float]:
        """
        Try each preprocessing variant in order. Return (speed, confidence) for the first variant that gives a number in our valid set, otherwise (None, 0.0).
        """
        for img in self._preprocess(crop):
            # detail=1 makes EasyOCR return (bbox, text, confidence) tuples instead of just text
            results = self.reader.readtext(
                img, detail=1, allowlist=_OCR_ALLOWLIST
            )
            if not results:
                continue

            # join up all the digit chunks the OCR found into one number
            digits = "".join(
                re.sub(r"[^0-9]", "", txt) for (_, txt, _) in results
            )
            if not digits:
                continue

            try:
                value = int(digits)
            except ValueError:
                continue

            # only accept it if it matches a real speed limit
            if value in VALID_SPEEDS:
                conf = max((c for (_, _, c) in results), default=0.0)
                return value, float(conf)

        return None, 0.0

    @staticmethod
    def _none(track_id: int) -> SpeedSignReading:
        return SpeedSignReading(
            speed=None, confidence=0.0, track_id=track_id, from_cache=False
        )


# visualization helper, only used by test scripts not the live pipeline
def draw_speed(
    frame: np.ndarray,
    reading: SpeedSignReading,
    track,
) -> np.ndarray:
    """
    Draw a sign box and speed label for one reading. Mutates and returns the frame, so pass a copy if you want to keep the original.
    """
    if reading.speed is None:
        return frame

    x1, y1, x2, y2 = track.bbox_int
    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 80), 3)
    label = f"{reading.speed} km/h"
    cv2.putText(frame, label, (x1, max(y1 - 10, 20)),
                cv2.FONT_HERSHEY_DUPLEX, 1.0, (0, 200, 80), 2, cv2.LINE_AA)
    return frame


# standalone smoke test, we run this file directly with a sign crop image to check the OCR works and the cache speeds up the second call. not part of the pipeline.
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("usage: python ocr_model.py <sign_crop_image>")
        print("  pass a tight crop of a speed limit sign")
        sys.exit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"could not read image: {sys.argv[1]}")
        sys.exit(1)

    # fake Track stand-in so we can call read() without wiring up the real tracker
    class _FakeTrack:
        track_id = 1
        @property
        def bbox_int(self):
            h, w = img.shape[:2]
            return (0, 0, w, h)

    ocr = SpeedSignOCR()
    print(f"EasyOCR initialized, gpu={ocr.use_gpu}")

    import time as _t
    t0 = _t.time()
    r1 = ocr.read(img, _FakeTrack())
    dt1 = (_t.time() - t0) * 1000

    t0 = _t.time()
    r2 = ocr.read(img, _FakeTrack())     # second call should be a cache hit
    dt2 = (_t.time() - t0) * 1000

    print(f"first  read: speed={r1.speed} conf={r1.confidence:.2f} "
          f"cache={r1.from_cache}  ({dt1:.0f} ms)")
    print(f"second read: speed={r2.speed} conf={r2.confidence:.2f} "
          f"cache={r2.from_cache}  ({dt2:.0f} ms), cache should make this near zero")

"""
src/tamakkan/detectors/speed_limit_reader.py

Wraps SpeedSignOCR and turns its per-sign readings into the live speed limit state shown on the phone.

SpeedSignOCR reads digits off one traffic_sign track on demand and caches the result by track_id. This file adds the pipeline-level layer on top:

  1. filter the track list to traffic_sign tracks only
  2. pick the best sign when more than one is visible, like at a highway interchange where only one panel is ours
  3. don't replace a high-confidence reading with a low-confidence one
  4. require a few confirming reads before changing the live limit, so a one-frame misread doesn't flicker the phone
  5. optionally skip frames, since OCR cache misses on new signs are still expensive
  6. emit a SpeedLimitChange only when the value actually changes

update() returns Optional[SpeedLimitChange]. The pipeline forwards it to SessionState.set_speed_limit() and the FastAPI server pushes it on the WebSocket.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from tamakkan.events import SpeedLimitChange
from tamakkan.models.ocr_model import SpeedSignOCR, SpeedSignReading
from tamakkan.models.tracker import Track


# tunables

# minimum OCR confidence for a reading to be considered a candidate
CONFIDENCE_MIN_NEW = 0.40

# how many independent readings of the same value before it becomes the live limit
CONFIRM_READS = 1

# cached readings don't count toward CONFIRM_READS because they're the same OCR call replayed, not independent confirmation

# 1 means run OCR every frame, raise only after measuring
DEFAULT_FRAME_SKIP = 1


class SpeedLimitReader:
    """
    Stateful, one per session. Construct with a SpeedSignOCR, call update(tracks, frame) every frame.

    ocr: a SpeedSignOCR instance.
    confidence_min_new: minimum OCR confidence to consider a reading.
    confirm_reads: how many fresh readings of the same value before we change the live limit.
    frame_skip: call OCR every Nth frame, 1 means every frame.
    """

    def __init__(
        self,
        ocr: SpeedSignOCR,
        confidence_min_new: float = CONFIDENCE_MIN_NEW,
        confirm_reads: int = CONFIRM_READS,
        frame_skip: int = DEFAULT_FRAME_SKIP,
    ):
        self.ocr = ocr
        self.confidence_min_new = confidence_min_new
        self.confirm_reads = max(1, confirm_reads)
        self.frame_skip = max(1, frame_skip)

        self.frame_idx = 0

        # live state
        self.current_limit: Optional[int] = None

        # candidate value -> count of fresh confirming reads since the last change, cleared when the limit updates
        self._pending: Dict[int, int] = defaultdict(int)

    # public API
    def update(
        self,
        tracks: List[Track],
        frame: np.ndarray,
    ) -> Optional[SpeedLimitChange]:
        """
        Process one frame.

        tracks: full track list from the tracker, filtered to traffic_sign tracks internally.
        frame: full BGR frame, used for cropping inside OCR.

        Returns a SpeedLimitChange if the limit changed this frame, else None.
        """
        self.frame_idx += 1

        # frame skip: still prune the cache so dead tracks don't accumulate, but don't run OCR
        if (self.frame_idx % self.frame_skip) != 0:
            self._prune_ocr_cache(tracks)
            return None

        # 1. filter to traffic_sign tracks
        signs = [t for t in tracks if t.is_traffic_sign]
        if not signs:
            self._prune_ocr_cache(tracks)
            return None

        # 2. pick the biggest sign on screen as a proxy for "closest, most central". signs we're passing are bigger than distant gantry ones.
        signs.sort(key=lambda t: t.area, reverse=True)
        best_sign = signs[0]

        reading: SpeedSignReading = self.ocr.read(frame, best_sign)

        self._prune_ocr_cache(tracks)

        # 3. reject missing or low-confidence readings
        if reading.speed is None:
            return None
        if reading.confidence < self.confidence_min_new:
            return None

        # 4. cached reading that already matches the current limit, nothing to do
        if reading.from_cache and reading.speed == self.current_limit:
            return None

        value = int(reading.speed)

        # 5. value already equals the current limit, clear any pending alternatives
        if value == self.current_limit:
            self._pending.clear()
            return None

        # 6. accumulate confirming reads for this candidate
        self._pending[value] += 1
        if self._pending[value] < self.confirm_reads:
            return None

        # 7. promote and emit
        self.current_limit = value
        self._pending.clear()
        return SpeedLimitChange(limit_kmh=value, timestamp=time.time())

    def reset(self) -> None:
        """ Clear all internal state. Call between unrelated sessions. """
        self.frame_idx = 0
        self.current_limit = None
        self._pending.clear()
        # the OCR cache itself isn't reset here, that's the pipeline or OCR owner's call

    # internals
    def _prune_ocr_cache(self, tracks: List[Track]) -> None:
        """ Keep the OCR per-track cache bounded over a long session. """
        live_ids = {t.track_id for t in tracks}
        self.ocr.prune(live_ids)


# standalone smoke test, runs the reader's logic with a fake SpeedSignOCR so it works without EasyOCR weights or a GPU. not part of the pipeline.
if __name__ == "__main__":
    import numpy as np

    # fakes
    class _FakeOCR:
        """ Stand-in for SpeedSignOCR, returns scripted readings. """
        def __init__(self):
            self._next: Optional[tuple] = None        # (speed, conf, from_cache)
            self.prune_calls = 0

        def script(self, speed, conf=0.9, from_cache=False):
            self._next = (speed, conf, from_cache)

        def read(self, frame, track):
            if self._next is None:
                # default: missed read
                return SpeedSignReading(None, 0.0, track.track_id, False)
            speed, conf, fc = self._next
            self._next = None
            return SpeedSignReading(speed, conf, track.track_id, fc)

        def prune(self, live_ids):
            self.prune_calls += 1

    class _FakeTrack:
        def __init__(self, tid, area, is_sign=True):
            self.track_id = tid
            self._area = area
            self._is_sign = is_sign

        @property
        def is_traffic_sign(self): return self._is_sign
        @property
        def area(self): return self._area
        @property
        def bbox_int(self): return (0, 0, 100, 100)

    dummy_frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    sign_a = _FakeTrack(tid=1, area=10000)
    sign_b = _FakeTrack(tid=2, area= 1000)
    not_sign = _FakeTrack(tid=3, area=20000, is_sign=False)

    print("no signs visible")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=2)
    out = r.update([not_sign], dummy_frame)
    print(f"  out: {out}  pending: {dict(r._pending)}  current: {r.current_limit}")
    assert out is None and r.current_limit is None

    print("\none read, one confirm, then change emitted")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=2)
    ocr.script(80, 0.9, False)
    out1 = r.update([sign_a], dummy_frame)
    print(f"  after 1st read of 80:  out={out1}  pending={dict(r._pending)}")
    assert out1 is None and r._pending[80] == 1

    ocr.script(80, 0.9, False)
    out2 = r.update([sign_a], dummy_frame)
    print(f"  after 2nd read of 80:  out={out2}  current={r.current_limit}")
    assert out2 is not None and out2.limit_kmh == 80 and r.current_limit == 80

    print("\nsame value while already current produces no emit")
    ocr.script(80, 0.9, False)
    out = r.update([sign_a], dummy_frame)
    print(f"  out: {out}  (expect None)")
    assert out is None

    print("\nlow confidence reading ignored")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=2, confidence_min_new=0.3)
    ocr.script(100, 0.2, False)        # below threshold
    out = r.update([sign_a], dummy_frame)
    print(f"  out: {out}  pending: {dict(r._pending)}")
    assert out is None and not r._pending

    print("\ncached readings don't count as confirming reads")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=2)
    ocr.script(100, 0.9, True)         # cache hit
    out = r.update([sign_a], dummy_frame)
    print(f"  after cache-hit 100: out={out}  pending={dict(r._pending)}  (expect both empty)")
    assert out is None and not r._pending

    print("\nbiggest sign is picked when multiple are visible")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=1)
    ocr.script(120, 0.9, False)
    out = r.update([sign_b, sign_a], dummy_frame)   # sign_a is bigger
    print(f"  out: {out}  current: {r.current_limit}  (sign_a is bigger, reading promoted)")
    assert out is not None and out.limit_kmh == 120

    print("\nchange from 80 to 100 emits a SpeedLimitChange")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=1)
    ocr.script(80, 0.9, False)
    r.update([sign_a], dummy_frame)
    ocr.script(100, 0.9, False)
    out = r.update([sign_a], dummy_frame)
    print(f"  out: {out}  current: {r.current_limit}")
    assert out is not None and out.limit_kmh == 100 and r.current_limit == 100

    print("\nframe_skip: skipped frames return None and still prune")
    ocr = _FakeOCR()
    r = SpeedLimitReader(ocr, confirm_reads=1, frame_skip=3)
    # frames 1 and 2 skipped, frame 3 runs
    ocr.script(60, 0.9, False)
    out1 = r.update([sign_a], dummy_frame)   # frame 1, skipped
    out2 = r.update([sign_a], dummy_frame)   # frame 2, skipped
    # script still set, frame 3 should call OCR
    out3 = r.update([sign_a], dummy_frame)
    print(f"  frame1 skipped: {out1}  frame2 skipped: {out2}  frame3 emitted: {out3}")
    assert out1 is None and out2 is None
    assert out3 is not None and out3.limit_kmh == 60
    assert ocr.prune_calls == 3

    print("\nall asserts passed.")
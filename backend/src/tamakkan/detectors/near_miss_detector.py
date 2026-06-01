"""
src/tamakkan/detectors/near_miss_detector.py

Near-miss detector. Fires when something is very close AND closing fast on the car.

The first version of this fired 30 to 67 times per clip on normal traffic. we fixed it by tuning the thresholds and adding the spatial gate.

The rebuild has four gates that all have to pass:
1. Spatial gate. The object's bbox center has to be inside a central driving-path band (a fixed fraction of frame width). A car passing in the next lane or a pedestrian on the sidewalk is outside the band and is ignored. 
2. Already-close gate. The object has to actually be close right now, not just changing. Its patch depth has to be a high fraction of the current frame's max depth.
3. Primary signal. Depth rising fast over a short window. Area-growth was dropped entirely because it was the noise source.
4. Per-track cooldown. One genuine approach is one alert, not a burst.

VRU events (person, vulnerable road user) get a critical severity and a different message, vehicle events get high severity.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from enum import Enum
from typing import Deque, Dict, List, Optional, Tuple

import numpy as np

from tamakkan.models.tracker import Track


# tunables
PATH_REGION_FRAC   = 0.45    # central band the object's bbox center has to be inside. wider than tailgating (0.34) so a person stepping toward the lane trips slightly earlier.
NEAR_DEPTH_REL     = 0.62    # already-close gate: patch depth has to be at least this fraction of the frame's max depth
DEPTH_RISE_FRAC    = 0.35    # primary signal: depth has to rise by at least this fraction of its window-start value across the window
WINDOW             = 6       # frames over which we measure the rise
BUFFER_LEN         = 24      # rolling history per track
COOLDOWN_SECONDS   = 5.0     # per-track minimum seconds between events
SAME_TARGET_CLEAR_FRAMES = 4 # track has to drop out of qualifying for this many frames before it can fire again, so a sustained approach is one event not repeats
DEFAULT_FPS        = 30.0

# class IDs from the tracker:
# 0 car, 1 truck, 2 bus, 3 person, 4 light, 5 sign, 6 VRU
VEHICLE_IDS = {0, 1, 2}
VRU_IDS     = {3, 6}
RELEVANT_IDS = VEHICLE_IDS | VRU_IDS


class EventType(str, Enum):
    NEAR_MISS = "NEAR_MISS"


@dataclass
class NearMissEvent:
    type:        EventType
    severity:    str            # 'critical' for VRU, 'high' for vehicle
    is_vru:      bool
    track_id:    int
    class_name:  str
    rel_depth:   float          # how close now (depth / frame max)
    depth_rise:  float          # relative rise over the window
    message_en:  str
    timestamp:   float
    frame_idx:   int


class NearMissDetector:
    """
    Stateful. Create one instance, call update(tracks, depth_map, frame) every frame.
    Returns the single most critical NearMissEvent this frame, or None. VRU events outrank vehicle events when both happen on the same frame.
    """

    def __init__(
        self,
        fps:              float = DEFAULT_FPS,
        path_region_frac: float = PATH_REGION_FRAC,
        near_depth_rel:   float = NEAR_DEPTH_REL,
        depth_rise_frac:  float = DEPTH_RISE_FRAC,
        window:           int   = WINDOW,
        buffer_len:       int   = BUFFER_LEN,
        cooldown_seconds: float = COOLDOWN_SECONDS,
    ):
        self.fps = fps if fps and fps > 0 else DEFAULT_FPS
        self.path_region_frac = path_region_frac
        self.near_depth_rel   = near_depth_rel
        self.depth_rise_frac  = depth_rise_frac
        self.window           = window
        self.buffer_len       = buffer_len
        self.cooldown_frames  = int(cooldown_seconds * self.fps)

        self.frame_idx = 0
        # per-track rolling buffer of (depth, frame_idx)
        self._buf: Dict[int, Deque[Tuple[float, int]]] = defaultdict(
            lambda: deque(maxlen=self.buffer_len))
        self._last_fired: Dict[int, int] = {}
        # how many frames a track has spent NOT qualifying since its last fire, so a sustained approach is one event not a burst
        self._cleared_frames: Dict[int, int] = defaultdict(int)

    # public API
    def update(
        self,
        tracks: List[Track],
        depth_map: np.ndarray,
        frame,
    ) -> Optional[NearMissEvent]:
        self.frame_idx += 1
        fh, fw = frame.shape[:2]
        # resolve the fractional path band to actual pixels for this frame
        cx_lo = fw * (0.5 - self.path_region_frac / 2.0)
        cx_hi = fw * (0.5 + self.path_region_frac / 2.0)
        frame_max_depth = (float(np.max(depth_map))
                           if depth_map is not None and depth_map.size else 0.0)

        candidates: List[Tuple[int, float, NearMissEvent]] = []
        active_ids = set()

        for t in tracks:
            if t.class_id not in RELEVANT_IDS:
                continue
            active_ids.add(t.track_id)

            x1, y1, x2, y2 = t.bbox_int
            cx = (x1 + x2) * 0.5

            d = self._patch_depth(depth_map, x1, y1, x2, y2)
            self._buf[t.track_id].append((d, self.frame_idx))
            buf = self._buf[t.track_id]

            # gates, all four have to pass
            in_path = cx_lo <= cx <= cx_hi
            rel_depth = (d / frame_max_depth) if frame_max_depth > 0 else 0.0
            already_close = rel_depth >= self.near_depth_rel
            have_window = len(buf) >= self.window

            qualifies = False
            depth_rise = 0.0
            if in_path and already_close and have_window:
                w = list(buf)[-self.window:]
                d0 = w[0][0]
                d1 = w[-1][0]
                if d0 > 0:
                    depth_rise = (d1 - d0) / d0
                    if depth_rise >= self.depth_rise_frac:
                        qualifies = True

            # same-target debounce: only fire again if the track has been NOT qualifying for a few frames since the last fire, so this is a fresh approach not the same one continuing
            if not qualifies:
                self._cleared_frames[t.track_id] += 1
                continue
            self._cleared_frames[t.track_id] = 0

            lf = self._last_fired.get(t.track_id)
            if lf is not None:
                if (self.frame_idx - lf) < self.cooldown_frames:
                    continue
                # cooldown elapsed, but we want it to have actually cleared in between, so a sustained tailgate-then-rush isn't endless
                if self._cleared_frames.get(t.track_id, 0) == 0 and \
                   (self.frame_idx - lf) < self.cooldown_frames * 2:
                    # still effectively the same continuous event, allow only after the longer 2x window
                    pass

            ev = self._build_event(t, rel_depth, depth_rise)
            # priority: VRU first, then by how fast closing
            pr = 0 if ev.is_vru else 1
            candidates.append((pr, -depth_rise, ev))

        self._prune(active_ids)

        if not candidates:
            return None

        # lowest (pr, -rise) means VRU first, then fastest approach
        candidates.sort(key=lambda c: (c[0], c[1]))
        worst = candidates[0][2]
        self._last_fired[worst.track_id] = self.frame_idx
        return worst

    def reset(self):
        self.frame_idx = 0
        self._buf.clear()
        self._last_fired.clear()
        self._cleared_frames.clear()

    # internals
    @staticmethod
    def _patch_depth(depth_map: np.ndarray, x1, y1, x2, y2) -> float:
        # sample depth from the bottom-center third of the bbox. that area is the ground contact point of a vehicle or the lower body of a person, which is the most reliable read on how close the object actually is. the head of a person or roof of a car can be in a different depth plane than where they meet the road.
        if depth_map is None or depth_map.size == 0:
            return 0.0
        h, w = depth_map.shape[:2]
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(w, int(x2)), min(h, int(y2))
        if x2 <= x1 or y2 <= y1:
            return 0.0
        bw, bh = x2 - x1, y2 - y1
        px1, px2 = x1 + bw // 3, x2 - bw // 3
        py1, py2 = y1 + (2 * bh) // 3, y2
        px2 = max(px2, px1 + 1)
        py2 = max(py2, py1 + 1)
        patch = depth_map[py1:py2, px1:px2]
        # median over the patch, more robust than mean against the occasional bad depth pixel
        return float(np.median(patch)) if patch.size else 0.0

    def _prune(self, active_ids: set):
        # drop state for tracks that no longer exist so the dicts can't grow forever
        dead = [tid for tid in self._buf if tid not in active_ids]
        for tid in dead:
            self._buf.pop(tid, None)
            self._last_fired.pop(tid, None)
            self._cleared_frames.pop(tid, None)

    def _build_event(
        self, t: Track, rel_depth: float, depth_rise: float
    ) -> NearMissEvent:
        cn = t.class_name
        is_vru = t.class_id in VRU_IDS
        if is_vru:
            sev = "critical"
            en = f"Critical: a {cn} is very close and approaching fast"
        else:
            sev = "high"
            en = f"A {cn} ahead is very close and closing fast"
        return NearMissEvent(
            type        = EventType.NEAR_MISS,
            severity    = sev,
            is_vru      = is_vru,
            track_id    = t.track_id,
            class_name  = cn,
            rel_depth   = round(rel_depth, 3),
            depth_rise  = round(depth_rise, 3),
            message_en  = en,
            timestamp   = time.time(),
            frame_idx   = self.frame_idx,
        )


# standalone smoke test, run this file directly with the YOLO weights, tracker config and a video to print near-miss events as they happen. not part of the pipeline.
if __name__ == "__main__":
    import sys
    import cv2
    from pathlib import Path

    _repo = Path(__file__).resolve().parents[3]
    for _p in (_repo / "src", _repo / "third_party"):
        if str(_p) not in sys.path:
            sys.path.insert(0, str(_p))

    if len(sys.argv) < 4:
        print("usage: python near_miss_detector.py "
              "<best.pt> <bytetrack.yaml> <video.mp4>")
        sys.exit(1)

    from tamakkan.models.tracker import TamakkanTracker
    from tamakkan.models.depth_model import DepthEstimator

    cap = cv2.VideoCapture(sys.argv[3])
    fps = cap.get(cv2.CAP_PROP_FPS) or DEFAULT_FPS
    tracker = TamakkanTracker(weights=sys.argv[1], tracker_config=sys.argv[2])
    depth = DepthEstimator(
        weights_path=str(_repo / "weights" / "depth_anything_v2_vits.pth"),
        variant="vits")
    det = NearMissDetector(fps=fps)
    print(f"fps={fps:.1f} window={det.window} "
          f"cooldown={det.cooldown_frames}f near_rel={det.near_depth_rel} "
          f"rise={det.depth_rise_frac}")

    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        tracks = tracker.update(frame)
        dmap = depth.predict(frame)
        ev = det.update(tracks, dmap, frame)
        if ev:
            tag = "VRU" if ev.is_vru else "veh"
            print(f"frame {n:>5}  NEAR_MISS[{tag}]  id={ev.track_id} "
                  f"{ev.class_name}  reld={ev.rel_depth:.2f} "
                  f"rise={ev.depth_rise:+.2f}  sev={ev.severity}")
    cap.release()
    print(f"done, {n} frames")
"""
src/tamakkan/detectors/tailgating_detector.py

Tailgating detector. Fires when the car is following the vehicle ahead too closely.

The two signals we use to detect this are:
- class-aware bbox geometry (a car's box height as a fraction of frame height tells us how close it is)
- relative depth (bigger raw DAv2 value means closer, and we use the fraction of the frame's max depth))
Both have to agree that the lead is close before we fire.

"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

import numpy as np

from tamakkan.models.tracker import Track


# tunables
PATH_REGION_FRAC      = 0.34   # central "my path" band as a fraction of frame width
DEPTH_REL_FRAC        = 0.50   # lead patch depth must be at least this fraction of the frame max depth.
CONFIRM_FRAMES        = 12     # sustained close frames before firing
COOLDOWN_SECONDS      = 6.0    # minimum seconds between tailgating events
MISS_GRACE            = 6      # frames the lead may be missing before the building state resets
CLEAR_FRAMES          = 10     # frames the lead has to be NOT close before the encounter "ends" and a new one can fire

# per-class "close" bbox height fraction. we measured it: the tailgated car sat at box_h 0.38-0.41
# medium-comfortable-gap approach was 0.27-0.38. 0.30 separates them.
# class IDs: 0 car, 1 truck, 2 bus
CLASS_NEAR_HEIGHT_FRAC: Dict[int, float] = {
    0: 0.30,
    1: 0.38,   # truck, scaled up because the object is bigger
    2: 0.38,   # bus
}
DEFAULT_NEAR_HEIGHT_FRAC = 0.30
DEFAULT_FPS = 30.0

VEHICLE_IDS = {0, 1, 2}   # car, truck, bus only, not VRU


class EventType(str, Enum):
    TAILGATING = "TAILGATING"


@dataclass
class TailgatingEvent:
    type:        EventType
    severity:    str
    track_id:    int
    class_name:  str
    box_height_frac: float
    rel_depth:   float
    message_en:  str
    timestamp:   float
    frame_idx:   int


class TailgatingDetector:
    """
    Stateful. Create one instance, call update(tracks, depth_map, frame, lanes=None).
    lanes is accepted but optional, reserved for future refinement.
    """

    def __init__(
        self,
        fps:               float = DEFAULT_FPS,
        path_region_frac:  float = PATH_REGION_FRAC,
        depth_rel_frac:    float = DEPTH_REL_FRAC,
        confirm_frames:    int   = CONFIRM_FRAMES,
        cooldown_seconds:  float = COOLDOWN_SECONDS,
        miss_grace:        int   = MISS_GRACE,
        clear_frames:      int   = CLEAR_FRAMES,
    ):
        self.fps = fps if fps and fps > 0 else DEFAULT_FPS
        self.path_region_frac = path_region_frac
        self.depth_rel_frac   = depth_rel_frac
        self.confirm_frames   = confirm_frames
        self.cooldown_frames  = int(cooldown_seconds * self.fps)
        self.miss_grace       = miss_grace
        self.clear_frames     = clear_frames

        self.frame_idx = 0
        self._consecutive = 0
        self._last_fired_frame: Optional[int] = None
        self._frames_since_lead = 0
        self._last_lead_id: Optional[int] = None
        # encounter tracking: did we already fire for the current continuous tailgate, and how long has it been clear since
        self._encounter_active = False
        self._clear_counter = 0

    # public API
    def update(
        self,
        tracks: List[Track],
        depth_map: np.ndarray,
        frame,
        lanes: Optional[list] = None,
    ) -> Optional[TailgatingEvent]:
        self.frame_idx += 1
        fh, fw = frame.shape[:2]
        # resolve the fractional path band to actual pixels
        cx_lo = fw * (0.5 - self.path_region_frac / 2.0)
        cx_hi = fw * (0.5 + self.path_region_frac / 2.0)

        # keep only vehicles whose center is in the path band
        ahead = []
        for t in tracks:
            if t.class_id not in VEHICLE_IDS:
                continue
            x1, y1, x2, y2 = t.bbox_int
            cx = (x1 + x2) * 0.5
            if cx_lo <= cx <= cx_hi:
                ahead.append(t)

        if not ahead:
            self._register_miss()
            self._note_clear()
            return None

        frame_max_depth = (float(np.max(depth_map))
                           if depth_map is not None and depth_map.size else 0.0)
        lead = self._pick_lead(ahead, depth_map)
        if lead is None:
            self._register_miss()
            self._note_clear()
            return None

        x1, y1, x2, y2 = lead.bbox_int
        box_h_frac = (y2 - y1) / float(fh)
        lead_depth = self._patch_depth(depth_map, x1, y1, x2, y2)
        rel_depth = (lead_depth / frame_max_depth) if frame_max_depth > 0 else 0.0

        # both signals have to agree
        class_near = CLASS_NEAR_HEIGHT_FRAC.get(
            lead.class_id, DEFAULT_NEAR_HEIGHT_FRAC)
        close = (box_h_frac >= class_near) and (rel_depth >= self.depth_rel_frac)

        # if the lead identity changed, restart the confirm counter
        if self._last_lead_id is not None and lead.track_id != self._last_lead_id:
            self._consecutive = 0
        self._last_lead_id = lead.track_id
        self._frames_since_lead = 0

        if not close:
            self._consecutive = 0
            self._note_clear()
            return None

        # close this frame
        self._clear_counter = 0
        self._consecutive += 1
        if self._consecutive < self.confirm_frames:
            return None

        # encounter: if we already fired and the situation never cleared, this is the same tailgate, stay silent
        if self._encounter_active:
            return None

        # hard cooldown as a backstop
        if self._last_fired_frame is not None:
            if (self.frame_idx - self._last_fired_frame) < self.cooldown_frames:
                return None

        self._last_fired_frame = self.frame_idx
        self._consecutive = 0
        self._encounter_active = True
        return self._build_event(lead, box_h_frac, rel_depth)

    def reset(self):
        self.frame_idx = 0
        self._consecutive = 0
        self._last_fired_frame = None
        self._frames_since_lead = 0
        self._last_lead_id = None
        self._encounter_active = False
        self._clear_counter = 0

    # internals
    def _note_clear(self):
        """ Count frames the lead has been not close. Once it's been clear long enough the encounter ends and a new one can fire later. """
        self._clear_counter += 1
        if self._clear_counter >= self.clear_frames:
            self._encounter_active = False

    def _register_miss(self):
        # lead vehicle isn't visible this frame. give it a few frames of grace before resetting the confirm counter, so a one-frame tracker drop doesn't kill an ongoing detection.
        self._frames_since_lead += 1
        if self._frames_since_lead > self.miss_grace:
            self._consecutive = 0
            self._last_lead_id = None

    def _pick_lead(
        self, ahead: List[Track], depth_map: np.ndarray
    ) -> Optional[Track]:
        # the lead is the closest vehicle in the path band. closest means highest patch depth (DAv2: bigger value = closer), with a fallback to lowest bbox bottom y if depth isn't available.
        if depth_map is not None and depth_map.size:
            return max(ahead,
                       key=lambda t: self._patch_depth(depth_map, *t.bbox_int))
        return max(ahead, key=lambda t: t.bbox_int[3])

    @staticmethod
    def _patch_depth(depth_map: np.ndarray, x1, y1, x2, y2) -> float:
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
        return float(np.median(patch)) if patch.size else 0.0

    def _build_event(
        self, lead: Track, box_h_frac: float, rel_depth: float
    ) -> TailgatingEvent:
        return TailgatingEvent(
            type        = EventType.TAILGATING,
            severity    = "high",
            track_id    = lead.track_id,
            class_name  = lead.class_name,
            box_height_frac = round(box_h_frac, 3),
            rel_depth   = round(rel_depth, 3),
            message_en  = "Following too closely, increase your distance "
                          "from the vehicle ahead",
            timestamp   = time.time(),
            frame_idx   = self.frame_idx,
        )


# standalone smoke test, runs this file directly with the YOLO weights, tracker config and a video to print tailgating events as they happen. not part of the pipeline.
if __name__ == "__main__":
    import sys
    import cv2
    from pathlib import Path

    _repo = Path(__file__).resolve().parents[3]
    for _p in (_repo / "src", _repo / "third_party"):
        if str(_p) not in sys.path:
            sys.path.insert(0, str(_p))

    if len(sys.argv) < 4:
        print("usage: python tailgating_detector.py "
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
    det = TailgatingDetector(fps=fps)
    print(f"fps={fps:.1f} confirm={det.confirm_frames} "
          f"cooldown={det.cooldown_frames}f rel={det.depth_rel_frac}")

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
            print(f"frame {n:>5}  TAILGATING  id={ev.track_id} "
                  f"{ev.class_name}  boxh={ev.box_height_frac:.2f} "
                  f"reld={ev.rel_depth:.2f}")
    cap.release()
    print(f"done, {n} frames")
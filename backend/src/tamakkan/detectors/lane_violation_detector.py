"""
src/tamakkan/detectors/lane_violation_detector.py

Lane departure detector. Takes the list of lanes from the UFLD-v2 LaneDetector and fires a LANE_DEPARTURE event when the car drifts off-centre for long enough that it doesn't look like a self-correction.

We catch the slow drifting-out-of-lane pattern that distracted or drowsy driving produces, and report which side (left or right) plus how big the drift is.

Severity is fixed, not scaled by offset size. A bigger offset usually means a deliberate lane change, so scaling severity up would just make intentional changes the loudest false alarms.

UFLD-v2 returns lane points in frame coordinates, so we keep all spatial thresholds as fractions of frame width and resolve them at runtime. Timing is counted in frames with fps passed in, event timestamps are wall-clock.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Tuple

from tamakkan.models.lane_model import Lane


# tunables
EGO_MAX_DIST_FRAC      = 0.475   # how far from center a lane can be and still count as one of our two ego lanes
EGO_EXPECTED_DIST_FRAC = 0.225   # where our lane line should sit when we're centered, used when only one ego lane is visible
DEPART_THRESH_FRAC     = 0.10    # how far off-center we have to be before a frame counts as drifting
MIN_EGO_SEPARATION_FRAC = 0.08   # minimum gap between the two ego lanes, otherwise one is a duplicate detection

FRAMES_TO_CONFIRM      = 15
COOLDOWN_SECONDS       = 6.0
SETTLE_FRAMES          = 12      # consecutive centered frames that count as the driver correcting back into lane
OFFSET_HISTORY_MAX     = 120

DEFAULT_FPS            = 30.0
SEVERITY               = "medium"


class EventType(str, Enum):
    LANE_DEPARTURE = "LANE_DEPARTURE"


@dataclass
class LaneDepartureEvent:
    type:       EventType
    side:       str
    severity:   str
    offset_px:  float
    message_en: str
    timestamp:  float
    frame_idx:  int


class LaneViolationDetector:
    """ Stateful. Create one instance, call update(lanes, frame) every frame. """

    def __init__(
        self,
        fps:                  float = DEFAULT_FPS,
        frames_to_confirm:    int   = FRAMES_TO_CONFIRM,
        cooldown_seconds:     float = COOLDOWN_SECONDS,
        settle_frames:        int   = SETTLE_FRAMES,
        ego_max_dist_frac:    float = EGO_MAX_DIST_FRAC,
        ego_expected_frac:    float = EGO_EXPECTED_DIST_FRAC,
        depart_thresh_frac:   float = DEPART_THRESH_FRAC,
        min_ego_sep_frac:     float = MIN_EGO_SEPARATION_FRAC,
    ):
        # guard against zero or missing fps so the cooldown math doesn't break
        self.fps = fps if fps and fps > 0 else DEFAULT_FPS
        self.frames_to_confirm = frames_to_confirm
        # store cooldown in frames because the rest of this file is frame-based
        self.cooldown_frames   = int(cooldown_seconds * self.fps)
        self.settle_frames     = settle_frames
        self.ego_max_dist_frac = ego_max_dist_frac
        self.ego_expected_frac = ego_expected_frac
        self.depart_thresh_frac = depart_thresh_frac
        self.min_ego_sep_frac  = min_ego_sep_frac

        # state across frames
        self.frame_idx = 0
        self._consecutive_off = 0
        self._offset_history: deque = deque(maxlen=OFFSET_HISTORY_MAX)
        self._last_fired_frame: Optional[int] = None
        self._was_off = False
        self._settle_counter = 0

    def update(self, lanes: List[Lane], frame) -> Optional[LaneDepartureEvent]:
        self.frame_idx += 1
        frame_w = frame.shape[1]
        depart_thresh = self.depart_thresh_frac * frame_w

        ego_left, ego_right = self._pick_ego_lanes(lanes, frame_w)
        offset = self._calculate_offset(ego_left, ego_right, frame_w)

        # no usable lanes this frame
        if offset is None:
            return None

        off = abs(offset) > depart_thresh

        # we were drifting and now we're centered again. count the centered frames, and once we hit settle_frames clear the drift state.
        if self._was_off and not off:
            self._settle_counter += 1
            if self._settle_counter >= self.settle_frames:
                self._reset_drift_state()
            return None
        if off:
            # any new off-frame resets the settle counter
            self._settle_counter = 0

        # accumulate drift evidence or reset
        if off:
            self._was_off = True
            self._consecutive_off += 1
            self._offset_history.append(offset)
        else:
            self._reset_drift_state()
            return None

        # not enough confirmed frames yet
        if self._consecutive_off < self.frames_to_confirm:
            return None

        # cooldown to stop the same departure firing over and over
        if self._last_fired_frame is not None:
            if (self.frame_idx - self._last_fired_frame) < self.cooldown_frames:
                return None

        # fire it. sign of the offset tells us the side.
        self._last_fired_frame = self.frame_idx
        avg_offset = sum(self._offset_history) / len(self._offset_history)
        self._reset_drift_state()
        side = "right" if avg_offset > 0 else "left"
        return self._build_event(avg_offset, side)

    def reset(self):
        # clear everything between unrelated clips or sessions
        self.frame_idx = 0
        self._last_fired_frame = None
        self._reset_drift_state()

    # internals
    def _reset_drift_state(self):
        self._consecutive_off = 0
        self._offset_history.clear()
        self._was_off = False
        self._settle_counter = 0

    def _pick_ego_lanes(
        self, lanes: List[Lane], frame_w: float
    ) -> Tuple[Optional[Lane], Optional[Lane]]:
        # the lane model returns up to 4 lanes (2 ego + 2 outer). pick the closest one on each side of the car, within a max distance.
        car_center = frame_w / 2.0
        max_distance = self.ego_max_dist_frac * frame_w

        left = [l for l in lanes
                if l.x_at_bottom < car_center
                and (car_center - l.x_at_bottom) <= max_distance]
        right = [l for l in lanes
                 if l.x_at_bottom >= car_center
                 and (l.x_at_bottom - car_center) <= max_distance]

        # closest lane on the left, ties broken by confidence
        ego_left = max(
            left, key=lambda l: (l.x_at_bottom, l.confidence)
        ) if left else None
        # closest lane on the right, ties broken by confidence
        ego_right = min(
            right, key=lambda l: (l.x_at_bottom, -l.confidence)
        ) if right else None

        # if the two ego lanes are sitting on top of each other, one is a duplicate detection. drop the lower-confidence one.
        if ego_left is not None and ego_right is not None:
            sep = ego_right.x_at_bottom - ego_left.x_at_bottom
            if sep < self.min_ego_sep_frac * frame_w:
                if ego_left.confidence >= ego_right.confidence:
                    ego_right = None
                else:
                    ego_left = None

        return ego_left, ego_right

    def _calculate_offset(
        self, ego_left: Optional[Lane], ego_right: Optional[Lane],
        frame_w: float
    ) -> Optional[float]:
        # positive offset means the car is right of center, negative means left
        car_center = frame_w / 2.0
        expected = self.ego_expected_frac * frame_w

        # both lanes visible, offset is how far the car center is from the midpoint between them
        if ego_left is not None and ego_right is not None:
            lane_center = (ego_left.x_at_bottom + ego_right.x_at_bottom) / 2.0
            return car_center - lane_center
        # only left lane visible, compare actual distance to expected
        if ego_left is not None:
            actual = car_center - ego_left.x_at_bottom
            return expected - actual
        # only right lane visible, same idea mirrored
        if ego_right is not None:
            actual = ego_right.x_at_bottom - car_center
            return actual - expected
        # no ego lanes at all
        return None

    def _build_event(self, offset_px: float, side: str) -> LaneDepartureEvent:
        if side == "right":
            en = "Lane departure warning: vehicle drifting to the right"
        else:
            en = "Lane departure warning: vehicle drifting to the left"
        return LaneDepartureEvent(
            type       = EventType.LANE_DEPARTURE,
            side       = side,
            severity   = SEVERITY,
            offset_px  = round(offset_px, 1),
            message_en = en,
            timestamp  = time.time(),
            frame_idx  = self.frame_idx,
        )


# standalone smoke test, run this file directly with the lane weights and a video to print departure events as they happen. not part of the pipeline.
if __name__ == "__main__":
    import sys
    import cv2
    from pathlib import Path

    # add src and third_party to sys.path so the imports work when running this file standalone
    _repo = Path(__file__).resolve().parents[3]
    for _p in (_repo / "src", _repo / "third_party"):
        if str(_p) not in sys.path:
            sys.path.insert(0, str(_p))

    if len(sys.argv) < 3:
        print("usage: python lane_violation_detector.py "
              "<weights/culane_res18_v2.pth> <video.mp4>")
        sys.exit(1)

    from tamakkan.models.lane_model import LaneDetector

    cap = cv2.VideoCapture(sys.argv[2])
    fps = cap.get(cv2.CAP_PROP_FPS) or DEFAULT_FPS
    lane = LaneDetector(weights_path=sys.argv[1])
    det = LaneViolationDetector(fps=fps)
    print(f"fps={fps:.1f}  confirm={det.frames_to_confirm}  "
          f"cooldown={det.cooldown_frames}f  settle={det.settle_frames}f")

    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        lanes = lane.update(frame)
        ev = det.update(lanes, frame)
        if ev:
            print(f"frame {n:>5}  {ev.type.value}  side={ev.side}  "
                  f"offset={ev.offset_px:+.0f}px")
    cap.release()
    print(f"done, {n} frames")
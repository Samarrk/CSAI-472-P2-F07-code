"""
src/tamakkan/pipeline.py

One instance per session. Takes BGR frames in, returns per-frame results out. Owns the five models, the four detectors, the alert engine, the session state, and the frame cadence policy.

Frame cadence:
On the Jetson Orin NX, running every model on every frame would not meet the latency budget required for live safety alerts. The pipeline runs the tracker on every frame because ByteTrack track continuity depends on it. Depth and lane inference are run every Nth frame, and detectors that consume their outputs receive the most recent cached result on intermediate frames. The HSV light classifier runs inline inside the red light detector. The speed limit reader applies its own internal frame skip.

The pipeline does not perform I/O. Camera capture, WebSocket transmission, and persistence are owned by the FastAPI server in server/app.py. Session bookkeeping such as score calculation belongs to SessionState.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import numpy as np

# vendored third-party packages (depth_anything_v2, ufld_v2) live under third_party,
import sys as _sys
from pathlib import Path as _Path
_repo = _Path(__file__).resolve().parents[2]
_tp = _repo / "third_party"
if _tp.is_dir() and str(_tp) not in _sys.path:
    _sys.path.insert(0, str(_tp))

from tamakkan.events import Alert, SessionEvent, SpeedLimitChange
from tamakkan.alert_engine import AlertEngine
from tamakkan.session_state import SessionState

from tamakkan.models.tracker import TamakkanTracker, Track
from tamakkan.models.depth_model import DepthEstimator
from tamakkan.models.lane_model import LaneDetector, Lane
from tamakkan.models.ocr_model import SpeedSignOCR

from tamakkan.detectors.red_light_detector import RedLightDetector
from tamakkan.detectors.lane_violation_detector import LaneViolationDetector
from tamakkan.detectors.tailgating_detector import TailgatingDetector
from tamakkan.detectors.near_miss_detector import NearMissDetector
from tamakkan.detectors.speed_limit_reader import SpeedLimitReader


# cadence defaults
DEFAULT_DEPTH_EVERY_N = 8      # run depth inference every Nth frame
DEFAULT_LANES_EVERY_N = 5      # run lane inference every Nth frame
DEFAULT_OCR_FRAME_SKIP = 999   # speed limit reader internal frame skip


@dataclass
class PipelineFrameResult:
    """
    Result of one process_frame() call.

    alert:              spoken alert, if any, to be sent as a kind=alert WebSocket message.
    speed_limit_change: speed limit update, if any, to be sent as a kind=speed_limit message.
    session_events:     all canonicalized events fired this frame, recorded into SessionState.
    frame_idx, frame_seconds: diagnostic fields.
    tracks, lanes, depth_map: exposed for optional test-harness visualization, not part of the wire contract.
    depth_was_fresh, lanes_was_fresh: True if the corresponding model ran on this frame, False if a cached result was reused.
    """
    frame_idx:          int
    frame_seconds:      float
    alert:              Optional[Alert]              = None
    speed_limit_change: Optional[SpeedLimitChange]   = None
    session_events:     List[SessionEvent]           = field(default_factory=list)

    tracks:    List[Track] = field(default_factory=list)
    lanes:     List[Lane]  = field(default_factory=list)
    depth_map: Optional[np.ndarray] = None
    depth_was_fresh: bool = False
    lanes_was_fresh: bool = False


class TamakkanPipeline:
    """
    Construct once per session. Call process_frame(frame) on every frame. Call end_session() once to seal state. to_summary() returns the current session summary at any time.

    yolo_weights:          path to the YOLOv11s weights file.
    bytetrack_config:      path to the ByteTrack configuration file.
    depth_weights:         path to the Depth Anything V2 weights.
    lane_weights:          path to the UFLD-v2 weights.
    device:                'cuda:0', 'cpu', or None for auto-detection. The same value is used by all GPU models.
    fps:                   input stream FPS, used by detectors with frame-based cooldowns.
    session:               an existing SessionState. The server supplies one. A new SessionState is constructed for standalone test scripts.
    depth_every_n:         frame cadence for depth inference.
    lanes_every_n:         frame cadence for lane inference.
    ocr_frame_skip:        frame skip passed to SpeedLimitReader.
    min_alert_gap_seconds: minimum gap between spoken alerts, passed to AlertEngine.
    """

    def __init__(
        self,
        yolo_weights:          str,
        bytetrack_config:      str,
        depth_weights:         str,
        lane_weights:          str,
        device:                Optional[str]   = None,
        fps:                   Optional[float] = None,
        session:               Optional[SessionState] = None,
        depth_every_n:         int   = DEFAULT_DEPTH_EVERY_N,
        lanes_every_n:         int   = DEFAULT_LANES_EVERY_N,
        ocr_frame_skip:        int   = DEFAULT_OCR_FRAME_SKIP,
        min_alert_gap_seconds: float = 4.0,
    ):
        # models. all five are constructed up front so the cold-start cost is paid once at session start.
        self.tracker = TamakkanTracker(
            weights         = yolo_weights,
            tracker_config  = bytetrack_config,
            device          = device,
        )
        self.depth = DepthEstimator(
            weights_path = depth_weights,
            variant      = "vits",
            device       = device,
        )
        self.lane_detector = LaneDetector(
            weights_path = lane_weights,
            device       = device,
        )
        self.ocr = SpeedSignOCR(device=device)

        # detectors
        self.red_light_det      = RedLightDetector(fps=fps or 30.0)
        self.lane_violation_det = LaneViolationDetector(fps=fps or 30.0)
        self.tailgating_det     = TailgatingDetector(fps=fps or 30.0)
        self.near_miss_det      = NearMissDetector(fps=fps or 30.0)
        self.speed_reader       = SpeedLimitReader(
            ocr        = self.ocr,
            frame_skip = ocr_frame_skip,
        )

        # state and alert engine
        self.session = session if session is not None else SessionState()
        self.alert_engine = AlertEngine(min_gap_seconds=min_alert_gap_seconds)

        # cadence state
        self.depth_every_n = max(1, depth_every_n)
        self.lanes_every_n = max(1, lanes_every_n)

        self.frame_idx: int = 0
        self._last_depth: Optional[np.ndarray] = None
        self._last_lanes: List[Lane] = []

    # public API
    def process_frame(self, frame: np.ndarray) -> PipelineFrameResult:
        """
        Run the full pipeline on one BGR frame. Returns a PipelineFrameResult describing what the phone should be told, if anything. Records events into self.session and ticks the FPS counter.
        """
        if frame is None or frame.size == 0:
            raise ValueError("process_frame received empty frame")

        t_start = time.time()
        self.frame_idx += 1

        # 1. tracker, every frame
        tracks = self.tracker.update(frame)

        # 2. depth, every Nth frame, otherwise reuse the cached map. the first call always runs so the cache is populated before any detector reads it.
        depth_fresh = False
        if (self.frame_idx % self.depth_every_n == 0) or self._last_depth is None:
            self._last_depth = self.depth.predict(frame)
            depth_fresh = True
        depth_map = self._last_depth

        # 3. lanes, every Nth frame, otherwise reuse the cached list. same first-call rule as depth.
        lanes_fresh = False
        if (self.frame_idx % self.lanes_every_n == 0) or not self._last_lanes:
            self._last_lanes = self.lane_detector.update(frame)
            lanes_fresh = True
        lanes = self._last_lanes

        # 4. detectors, every frame.
        # red_light returns a list because it can fire AHEAD and RAN on the same frame.
        red_light_events: List = self.red_light_det.update(tracks, frame)
        lane_event   = self.lane_violation_det.update(lanes, frame)
        tail_event   = self.tailgating_det.update(tracks, depth_map, frame)
        near_event   = self.near_miss_det.update(tracks, depth_map, frame)

        detector_events = []
        detector_events.extend(red_light_events)
        for ev in (lane_event, tail_event, near_event):
            if ev is not None:
                detector_events.append(ev)

        # 5. speed limit reader. the result rides on a separate WebSocket channel and is not a mistake event.
        speed_change = self.speed_reader.update(tracks, frame)
        if speed_change is not None:
            self.session.set_speed_limit(speed_change.limit_kmh)

        # 6. alert engine. selects at most one spoken alert and canonicalizes all detector events for recording.
        session_time_s = self.session.session_time_s()
        engine_out = self.alert_engine.process(
            detector_events,
            session_time_s = session_time_s,
        )

        # every canonicalized event is recorded. the alert engine's cooldown suppresses spoken alerts only, never recording.
        for sev in engine_out.session_events:
            self.session.record_event(sev)

        # 7. per-frame bookkeeping
        frame_seconds = time.time() - t_start
        self.session.tick_fps(frame_seconds)

        return PipelineFrameResult(
            frame_idx          = self.frame_idx,
            frame_seconds      = frame_seconds,
            alert              = engine_out.alert,
            speed_limit_change = speed_change,
            session_events     = engine_out.session_events,
            tracks             = tracks,
            lanes              = lanes,
            depth_map          = depth_map,
            depth_was_fresh    = depth_fresh,
            lanes_was_fresh    = lanes_fresh,
        )

    def end_session(self) -> None:
        """ Marks the session as ended in SessionState. Idempotent. After this, to_summary() returns a frozen summary. """
        self.session.end()

    def to_summary(self):
        """ Returns the current session summary. Convenience accessor over self.session.to_summary(). """
        return self.session.to_summary()

    def reset(self) -> None:
        """
        Clears cross-frame state so the pipeline can be reused for a fresh session. The session itself is not replaced here; the server supplies a new SessionState when it starts a new session.
        """
        self.frame_idx = 0
        self._last_depth = None
        self._last_lanes = []
        self.tracker.reset()
        self.lane_detector.reset()
        self.ocr.reset()
        self.red_light_det.reset()
        self.lane_violation_det.reset()
        self.tailgating_det.reset()
        self.near_miss_det.reset()
        self.speed_reader.reset()
        self.alert_engine.reset()


# standalone smoke test, loads the pipeline against real weights and runs it over one video. exercises every model and detector together. not part of the deployed system.
if __name__ == "__main__":
    import sys
    import cv2

    if len(sys.argv) < 2:
        print("usage: python -m tamakkan.pipeline <video_path>")
        sys.exit(1)

    video_path = sys.argv[1]

    # resolve repo root assuming this file is at src/tamakkan/pipeline.py
    repo = Path(__file__).resolve().parents[2]
    weights_dir = repo / "weights"

    yolo_w   = str(weights_dir / "best.engine") if (weights_dir / "best.engine").exists() else str(weights_dir / "best.pt")
    bt_cfg   = str(weights_dir / "bytetrack_tamakkan.yaml")
    depth_w  = str(weights_dir / "depth_anything_v2_vits.engine") if (weights_dir / "depth_anything_v2_vits.engine").exists() else str(weights_dir / "depth_anything_v2_vits.pth")
    lane_w   = str(weights_dir / "culane_res18_v2.engine") if (weights_dir / "culane_res18_v2.engine").exists() else str(weights_dir / "culane_res18_v2.pth")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"could not open video: {video_path}")
        sys.exit(1)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"video: {video_path}")
    print(f"fps:   {fps:.1f}  frames: {total}")
    print(f"cadence: depth every {DEFAULT_DEPTH_EVERY_N}, "
          f"lanes every {DEFAULT_LANES_EVERY_N}, "
          f"ocr skip {DEFAULT_OCR_FRAME_SKIP}")

    pipeline = TamakkanPipeline(
        yolo_weights     = yolo_w,
        bytetrack_config = bt_cfg,
        depth_weights    = depth_w,
        lane_weights     = lane_w,
        fps              = fps,
    )

    alerts_spoken = 0
    events_recorded = 0
    speed_changes = 0
    n = 0

    t_wall_start = time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        n += 1
        result = pipeline.process_frame(frame)

        events_recorded += len(result.session_events)
        if result.alert is not None:
            alerts_spoken += 1
            sub = ("/" + result.alert.subtype.value) if result.alert.subtype else ""
            print(f"  frame {n:>5}  ALERT  "
                  f"{result.alert.event_type.value}{sub}  "
                  f"sev={result.alert.severity.value}  "
                  f"vru={result.alert.is_vru}  "
                  f"\"{result.alert.message_en}\"")
        if result.speed_limit_change is not None:
            speed_changes += 1
            print(f"  frame {n:>5}  SPEED  "
                  f"limit -> {result.speed_limit_change.limit_kmh} km/h")

    cap.release()
    wall = time.time() - t_wall_start

    pipeline.end_session()
    summary = pipeline.to_summary()

    print()
    print(f"run complete")
    print(f"  frames processed:       {n}")
    print(f"  wall seconds:           {wall:.1f}")
    print(f"  effective pipeline FPS: {n / wall:.1f}")
    print(f"  alerts spoken:          {alerts_spoken}")
    print(f"  events recorded:        {events_recorded}")
    print(f"  speed-limit changes:    {speed_changes}")
    print()
    print("session summary")
    import json
    print(json.dumps(summary.to_dict(), indent=2))
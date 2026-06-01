"""
src/tamakkan/session_state.py

Per-session state container. One SessionState instance lives for the duration of one drive and holds everything that has to persist across frames within a session and disappear at the end of it: session id, start time, the live speed limit, the list of recorded SessionEvents, the set of speed limits seen, a rolling FPS tracker, and the score function.

The Jetson is stateless across sessions. Cross-session aggregation (running totals, trip history, weekly stats) belongs to the database, not this module. This file produces a SessionSummary at the end of one drive, in the wire format from events.py.
"""

from __future__ import annotations

import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Deque, List, Optional, Set

from tamakkan.events import (
    SessionEvent,
    SessionSummary,
    EventType,
    RedLightSubtype,
    score_to_label,
)


# scoring weights, isolated here so they can be changed without touching the function below
SCORE_START      = 5.0
SCORE_MIN        = 0.0
SCORE_MAX        = 5.0

PENALTY_NEAR_MISS         = 1.0
PENALTY_RED_LIGHT_RAN     = 1.0
PENALTY_TAILGATING        = 0.5
PENALTY_RED_LIGHT_AHEAD   = 0.0    # ahead is a warning only, no score impact
PENALTY_LANE_DEPARTURE    = 0.4


def compute_score(events: List[SessionEvent]) -> float:
    """
    Per-session score on a 0 to 5 scale. Starts at 5.0, subtracts a penalty for each event, and clamps to [0, 5]. Pure function with no state or I/O
    """
    score = SCORE_START
    for ev in events:
        if ev.event_type == EventType.NEAR_MISS:
            score -= PENALTY_NEAR_MISS
        elif ev.event_type == EventType.RED_LIGHT:
            if ev.subtype == RedLightSubtype.RAN:
                score -= PENALTY_RED_LIGHT_RAN
            else:
                score -= PENALTY_RED_LIGHT_AHEAD
        elif ev.event_type == EventType.TAILGATING:
            score -= PENALTY_TAILGATING
        elif ev.event_type == EventType.LANE_DEPARTURE:
            score -= PENALTY_LANE_DEPARTURE
        # any future EventType silently scores zero
    return max(SCORE_MIN, min(SCORE_MAX, score))


# FPS tracker: rolling-window average of per-frame processing time. Used only for summary metadata so the Jetson's field performance is visible. 
_FPS_WINDOW_FRAMES = 450


@dataclass
class _FPSTracker:
    """ Rolling average frame-processing FPS. Internal helper. """
    window: int = _FPS_WINDOW_FRAMES
    _frame_seconds: Deque[float] = field(
        default_factory=lambda: deque(maxlen=_FPS_WINDOW_FRAMES)
    )

    def tick(self, frame_seconds: float):
        if frame_seconds > 0:
            self._frame_seconds.append(frame_seconds)

    def average_fps(self) -> Optional[float]:
        if not self._frame_seconds:
            return None
        avg_s = sum(self._frame_seconds) / len(self._frame_seconds)
        return (1.0 / avg_s) if avg_s > 0 else None


class SessionState:
    """
    Bookkeeping for one drive. Construct at session start, mutate via record_event(), set_speed_limit(), and tick_fps() during the drive, and call to_summary() at session end.

    Public attributes are readable directly. Mutation goes through the designated methods so derived state (event order, speed-limit history, FPS window) stays consistent.
    """

    def __init__(
        self,
        session_id: Optional[str] = None,
        started_at: Optional[float] = None,
        fps_window_frames: int = _FPS_WINDOW_FRAMES,
    ):

        self.session_id: str = session_id or f"s_{int(time.time())}_{uuid.uuid4().hex[:6]}"

        # wall-clock start. used for session_time_s on every event and for the ISO timestamps in the final summary.
        self.started_at_epoch: float = (
            started_at if started_at is not None else time.time()
        )
        self.ended_at_epoch:   Optional[float] = None

        # live state
        self.current_speed_limit: Optional[int] = None
        self.speed_limits_seen:   Set[int] = set()

        # event log, kept in insertion order. the pipeline records events in wall-clock order so no resort is needed.
        self.events: List[SessionEvent] = []

        # performance tracker
        self._fps = _FPSTracker(window=fps_window_frames)

    # time helpers
    def session_time_s(self, timestamp: Optional[float] = None) -> float:
        """ Seconds since session start at the given wall-clock timestamp. Used to stamp every Alert and SessionEvent. Never negative. """
        t = timestamp if timestamp is not None else time.time()
        return max(0.0, t - self.started_at_epoch)

    # mutators
    def record_event(self, event: SessionEvent) -> None:
        """ Appends one canonical SessionEvent to the session log. """
        self.events.append(event)

    def set_speed_limit(self, limit_kmh: Optional[int]) -> bool:
        """
        Updates the live speed limit. Returns True if the value actually changed (the caller should push a SpeedLimitChange over the WebSocket), or False if the new value is the same as the current one (no WebSocket push needed).

        Every distinct value seen is recorded into speed_limits_seen for the final summary metadata.
        """
        if limit_kmh is not None:
            self.speed_limits_seen.add(int(limit_kmh))

        if limit_kmh == self.current_speed_limit:
            return False

        self.current_speed_limit = limit_kmh
        return True

    def tick_fps(self, frame_seconds: float) -> None:
        """ Records one processed frame's wall-clock seconds for FPS averaging. """
        self._fps.tick(frame_seconds)

    def end(self, ended_at: Optional[float] = None) -> None:
        """ Marks the session as ended. Idempotent. Calling end() twice keeps the first end time. """
        if self.ended_at_epoch is None:
            self.ended_at_epoch = ended_at if ended_at is not None else time.time()

    # read helpers
    @property
    def is_ended(self) -> bool:
        return self.ended_at_epoch is not None

    @property
    def duration_seconds(self) -> int:
        """ Whole-seconds session duration. Returns duration so far if the session has not ended. """
        end = self.ended_at_epoch if self.ended_at_epoch is not None else time.time()
        return max(0, int(round(end - self.started_at_epoch)))

    def average_fps(self) -> Optional[float]:
        return self._fps.average_fps()

    # summary
    def to_summary(self) -> SessionSummary:
        """
        Builds the final SessionSummary from current state. Safe to call before end() (returns the summary so far with the current wall-clock as the end time). After end(), repeated calls return the same fixed summary.

        """
        end_epoch = (
            self.ended_at_epoch if self.ended_at_epoch is not None else time.time()
        )

        score = compute_score(self.events)
        label = score_to_label(score)

        # speed_limits_seen is sorted so the summary is deterministic
        metadata = {
            "speed_limits_seen": sorted(self.speed_limits_seen),
        }
        avg_fps = self.average_fps()
        if avg_fps is not None:
            metadata["model_fps_avg"] = round(avg_fps, 1)

        return SessionSummary(
            session_id       = self.session_id,
            started_at       = _to_iso(self.started_at_epoch),
            ended_at         = _to_iso(end_epoch),
            duration_seconds = max(0, int(round(end_epoch - self.started_at_epoch))),
            score            = score,
            score_label      = label,
            events           = list(self.events),    # defensive copy
            metadata         = metadata,
        )


def _to_iso(epoch: float) -> str:
    dt = datetime.fromtimestamp(epoch, tz=timezone.utc).replace(microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


# standalone smoke test
if __name__ == "__main__":
    import json

    from tamakkan.events import (
        EventType,
        Severity,
        RedLightSubtype,
        SessionEvent,
    )

    print("empty session, clean drive")
    s = SessionState(session_id="s_test_clean")
    # simulate a short drive
    time.sleep(0.01)
    s.tick_fps(1 / 14.0)        # roughly 14 fps
    s.tick_fps(1 / 15.0)
    s.set_speed_limit(80)
    s.set_speed_limit(80)       # no-op
    changed = s.set_speed_limit(100)
    print(f"  100 was a change: {changed}")
    s.end()
    summary = s.to_summary()
    print(json.dumps(summary.to_dict(), indent=2))
    print(f"  score: {summary.score}  label: {summary.score_label.value}")

    print("\nsession with 5 events (mixed)")
    s2 = SessionState(session_id="s_test_mixed")
    t0 = s2.started_at_epoch

    def _ev(et, sub, sev, vru, dt_s):
        ts = t0 + dt_s
        return SessionEvent(et, sub, sev, vru, dt_s, ts)

    s2.record_event(_ev(EventType.LANE_DEPARTURE, None, Severity.MEDIUM, False, 12.0))
    s2.record_event(_ev(EventType.TAILGATING,     None, Severity.HIGH,   False, 60.0))
    s2.record_event(_ev(EventType.RED_LIGHT,      RedLightSubtype.AHEAD, Severity.HIGH, False, 90.0))
    s2.record_event(_ev(EventType.RED_LIGHT,      RedLightSubtype.RAN,   Severity.CRITICAL, False, 130.0))
    s2.record_event(_ev(EventType.NEAR_MISS,      None, Severity.CRITICAL, True, 200.0))
    s2.set_speed_limit(80)
    s2.set_speed_limit(100)
    s2.set_speed_limit(60)
    for _ in range(20):
        s2.tick_fps(1 / 14.3)
    time.sleep(0.01)
    s2.end()
    summary = s2.to_summary()

    # expected score: 5.0 - 0.4 (lane) - 0.5 (tail) - 0 (ahead) - 1.0 (ran) - 1.0 (vru) = 2.1
    print(f"  events:              {len(summary.events)}")
    print(f"  event_counts:        {summary.to_dict()['event_counts']}")
    print(f"  score:               {summary.score}     (expect 2.1)")
    print(f"  score_label:         {summary.score_label.value}     (expect NEEDS WORK)")
    print(f"  speed_limits_seen:   {summary.metadata['speed_limits_seen']}")
    print(f"  model_fps_avg:       {summary.metadata.get('model_fps_avg')}")

    print("\nfloor at zero, catastrophic drive")
    s3 = SessionState(session_id="s_test_floor")
    for _ in range(10):
        s3.record_event(_ev(EventType.NEAR_MISS, None, Severity.CRITICAL, True, 1.0))
    s3.end()
    print(f"  score: {compute_score(s3.events)}  (expect 0.0)")

    print("\nsession_time_s")
    s4 = SessionState(session_id="s_test_time", started_at=1000.0)
    print(f"  at t=1042.5  -> {s4.session_time_s(1042.5)}  (expect 42.5)")
    print(f"  at t=999.0   -> {s4.session_time_s(999.0)}   (expect 0.0, clamped)")

    print("\nto_summary() before end()")
    s5 = SessionState(session_id="s_test_inprogress")
    s5.record_event(_ev(EventType.TAILGATING, None, Severity.HIGH, False, 5.0))
    summary = s5.to_summary()
    print(f"  in-progress duration_seconds: {summary.duration_seconds} (>= 0)")
    print(f"  in-progress score: {summary.score}  (expect 4.5)")
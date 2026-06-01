"""
src/tamakkan/alert_engine.py

Per-frame alert prioritizer and cross-detector cooldown. Sits between the four detectors (red_light, lane_violation, tailgating, near_miss) and the WebSocket, and ensures the phone receives at most one spoken alert per frame.

Responsibilities:
1. Priority. When multiple detectors fire on the same frame, the engine selects the single most important event to speak.
2. Cross-detector cooldown. No two spoken alerts within min_gap_seconds, layered on top of each detector's internal cooldown.
3. Critical override. A new event with strictly higher severity than the last spoken event bypasses the cooldown.

The engine does not decide whether an event occurred. It never suppresses the SessionEvent, only the spoken Alert. WebSocket transmission is handled by the FastAPI server.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Iterable, List, Optional

from tamakkan.events import (
    Alert,
    SessionEvent,
    Severity,
    canonicalize,
)


# minimum seconds between spoken alerts
DEFAULT_MIN_GAP_SECONDS = 4.0


# priority tiers, lower number = more urgent
_PRI_VRU_NEAR_MISS      = 0
_PRI_RED_LIGHT_RAN      = 1
_PRI_VEH_NEAR_MISS      = 2
_PRI_RED_LIGHT_AHEAD    = 3
_PRI_TAILGATING         = 4
_PRI_LANE_DEPARTURE     = 5

_SEVERITY_RANK = {
    Severity.CRITICAL: 3,
    Severity.HIGH:     2,
    Severity.MEDIUM:   1,
}


def _priority_for(internal_type: str, is_vru: bool) -> int:
    """
    Maps a detector event type to its priority number. Unknown types receive a large fallback value so a new detector cannot displace existing ones until it is ranked here explicitly.
    """
    if internal_type == "NEAR_MISS":
        return _PRI_VRU_NEAR_MISS if is_vru else _PRI_VEH_NEAR_MISS
    if internal_type == "RED_LIGHT_RAN":
        return _PRI_RED_LIGHT_RAN
    if internal_type == "RED_LIGHT_AHEAD":
        return _PRI_RED_LIGHT_AHEAD
    if internal_type == "TAILGATING":
        return _PRI_TAILGATING
    if internal_type == "LANE_DEPARTURE":
        return _PRI_LANE_DEPARTURE
    return 999


@dataclass
class EngineOutput:
    """
    Result of one process() call.

    alert: the spoken alert for this frame, or None if nothing should be spoken.
    session_events: every event that fired this frame, canonicalized for recording. All events are recorded regardless of whether the alert was suppressed.
    """
    alert:          Optional[Alert] = None
    session_events: List[SessionEvent] = field(default_factory=list)


class AlertEngine:
    """
    One AlertEngine per session. Construct once, call process(detector_events, session_time_s) every frame.
    """

    def __init__(self, min_gap_seconds: float = DEFAULT_MIN_GAP_SECONDS):
        self.min_gap_seconds: float = min_gap_seconds

        # wall-clock timestamp and severity of the last emitted alert, used by the critical-override rule
        self._last_alert_ts: Optional[float] = None
        self._last_alert_severity: Optional[Severity] = None

    def reset(self) -> None:
        """ Clears cooldown state. Called between unrelated sessions. """
        self._last_alert_ts = None
        self._last_alert_severity = None

    def process(
        self,
        detector_events: Iterable[Any],
        session_time_s: float,
        now: Optional[float] = None,
    ) -> EngineOutput:
        """
        Selects the event to speak this frame and canonicalizes every event for recording.

        detector_events: events returned by the four detectors. None entries are skipped.
        session_time_s: seconds since session start, supplied by the pipeline.
        now: wall-clock time used for cooldown math. Defaults to time.time().

        Returns an EngineOutput containing at most one alert and the full list of canonicalized session events.
        """
        if now is None:
            now = time.time()

        # canonicalize every event, skipping Nones
        canonical: List[tuple[Alert, SessionEvent, str, bool]] = []
        for ev in detector_events:
            if ev is None:
                continue
            alert, sess_ev = canonicalize(ev, session_time_s=session_time_s)
            internal_type = (
                ev.type.value if hasattr(ev.type, "value") else str(ev.type)
            )
            is_vru = bool(getattr(ev, "is_vru", False))
            canonical.append((alert, sess_ev, internal_type, is_vru))

        if not canonical:
            return EngineOutput(alert=None, session_events=[])

        all_session_events = [c[1] for c in canonical]

        # select the highest-priority candidate
        canonical.sort(key=lambda c: _priority_for(c[2], c[3]))
        winner_alert, _, _winner_type, _winner_vru = canonical[0]

        # apply cooldown with critical-override
        if not self._cooldown_allows(winner_alert.severity, now):
            return EngineOutput(alert=None, session_events=all_session_events)

        # emit and update state
        self._last_alert_ts = now
        self._last_alert_severity = winner_alert.severity
        return EngineOutput(alert=winner_alert, session_events=all_session_events)

    def _cooldown_allows(self, candidate_severity: Severity, now: float) -> bool:
        """
        Returns True if the candidate alert may be spoken. A candidate is allowed when no prior alert has been emitted, when the gap since the last alert meets min_gap_seconds, or when the candidate's severity strictly outranks the last emitted severity.
        """
        if self._last_alert_ts is None:
            return True

        if (now - self._last_alert_ts) >= self.min_gap_seconds:
            return True

        if self._last_alert_severity is None:
            return True

        return _SEVERITY_RANK[candidate_severity] > _SEVERITY_RANK[
            self._last_alert_severity
        ]


# standalone smoke test, runs the engine on fake detector events using SimpleNamespace so the test does not depend on the real detector dataclasses
if __name__ == "__main__":
    from types import SimpleNamespace

    def fake(internal_type: str, *, is_vru: bool = False, message_en: str = "msg",
             timestamp: float = 0.0):
        ns = SimpleNamespace()
        ns.type = SimpleNamespace(value=internal_type)
        ns.is_vru = is_vru
        ns.message_en = message_en
        ns.timestamp = timestamp
        return ns

    print("single event, no prior cooldown")
    engine = AlertEngine(min_gap_seconds=4.0)
    out = engine.process(
        [fake("TAILGATING", message_en="Too close")],
        session_time_s=10.0,
        now=100.0,
    )
    assert out.alert is not None and out.alert.event_type.value == "tailgating"
    assert len(out.session_events) == 1
    print("  spoken:", out.alert.event_type.value, out.alert.severity.value)

    print("\ntwo events same frame, priority wins")
    engine = AlertEngine(min_gap_seconds=4.0)
    out = engine.process(
        [
            fake("TAILGATING",        message_en="Too close"),
            fake("NEAR_MISS",         message_en="Pedestrian", is_vru=True),
            fake("LANE_DEPARTURE",    message_en="Drifting"),
        ],
        session_time_s=10.0,
        now=100.0,
    )
    assert out.alert.event_type.value == "near_miss"
    assert out.alert.is_vru is True
    assert len(out.session_events) == 3
    print("  spoken:", out.alert.event_type.value, "(VRU)")
    print("  recorded:", [e.event_type.value for e in out.session_events])

    print("\ncooldown blocks same-severity follow-up")
    engine = AlertEngine(min_gap_seconds=4.0)
    out1 = engine.process(
        [fake("TAILGATING", message_en="Too close")],
        session_time_s=10.0, now=100.0,
    )
    out2 = engine.process(
        [fake("TAILGATING", message_en="Still too close")],
        session_time_s=11.5, now=101.5,
    )
    print(f"  first alert: {out1.alert.event_type.value}")
    print(f"  second alert: {out2.alert} (expect None)")
    print(f"  second session_events len: {len(out2.session_events)} (expect 1)")
    assert out1.alert is not None
    assert out2.alert is None
    assert len(out2.session_events) == 1

    print("\ncritical overrides cooldown")
    engine = AlertEngine(min_gap_seconds=4.0)
    engine.process(
        [fake("LANE_DEPARTURE", message_en="Drifting")],
        session_time_s=10.0, now=100.0,
    )
    out = engine.process(
        [fake("NEAR_MISS", is_vru=True, message_en="Pedestrian")],
        session_time_s=11.2, now=101.2,
    )
    print(f"  critical mid-cooldown spoken: {out.alert is not None} (expect True)")
    assert out.alert is not None
    assert out.alert.severity.value == "critical"

    print("\ncritical does not override another critical mid-cooldown")
    engine = AlertEngine(min_gap_seconds=4.0)
    engine.process(
        [fake("NEAR_MISS", is_vru=True, message_en="Pedestrian")],
        session_time_s=10.0, now=100.0,
    )
    out = engine.process(
        [fake("NEAR_MISS", is_vru=True, message_en="Another pedestrian")],
        session_time_s=11.0, now=101.0,
    )
    print(f"  second critical mid-cooldown spoken: {out.alert is not None} (expect False)")
    assert out.alert is None

    print("\ncooldown expires after min_gap_seconds")
    engine = AlertEngine(min_gap_seconds=4.0)
    engine.process(
        [fake("TAILGATING", message_en="Too close")],
        session_time_s=10.0, now=100.0,
    )
    out = engine.process(
        [fake("TAILGATING", message_en="Still close")],
        session_time_s=14.5, now=104.5,
    )
    print(f"  4.5s later spoken: {out.alert is not None} (expect True)")
    assert out.alert is not None

    print("\nempty input")
    out = AlertEngine().process([], session_time_s=10.0, now=100.0)
    print(f"  alert: {out.alert}  events: {len(out.session_events)}")
    assert out.alert is None and out.session_events == []

    print("\nNone entries tolerated")
    out = AlertEngine().process([None, None], session_time_s=10.0, now=100.0)
    print(f"  alert: {out.alert}  events: {len(out.session_events)}")
    assert out.alert is None and out.session_events == []

    print("\nred light ran beats tailgating same frame")
    engine = AlertEngine()
    out = engine.process(
        [
            fake("TAILGATING"),
            fake("RED_LIGHT_RAN"),
        ],
        session_time_s=10.0, now=100.0,
    )
    print(f"  spoken: {out.alert.event_type.value} subtype={out.alert.subtype.value}")
    assert out.alert.event_type.value == "red_light"
    assert out.alert.subtype.value == "ran"

    print("\nall asserts passed.")
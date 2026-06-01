"""
src/tamakkan/events.py

event types and wire-format dataclasses for the Tamakkan backend. This module is the single source of truth for the event taxonomy that crosses the pipeline-server boundary: the WebSocket payloads, the per-event records stored in the session summary, the SessionSummary itself, and SpeedLimitChange.

Each detector keeps its own internal event dataclass. The canonicalize() function in this module translates any of those into the (Alert, SessionEvent) pair used by the rest of the backend. The dependency direction is one-way: detector modules depend on this file, this file does not import from any detector.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class EventType(str, Enum):
    """ Wire-format event types. These are the exact strings the phone app receives in the event_type field. """
    LANE_DEPARTURE = "lane_departure"
    TAILGATING     = "tailgating"
    RED_LIGHT      = "red_light"
    NEAR_MISS      = "near_miss"


class Severity(str, Enum):
    """ Wire-format severity values. """
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"


class RedLightSubtype(str, Enum):
    """ Used in Alert.subtype and SessionEvent.subtype when event_type is red_light. """
    AHEAD = "ahead"
    RAN   = "ran"


@dataclass
class Alert:
    """
    Real-time alert pushed over the WebSocket. One alert per frame at most, with prioritization and cooldown applied by AlertEngine before this is sent.

    event_type:     canonical EventType value.
    subtype:        red light variant when event_type is red_light, otherwise None.
    severity:       wire-format severity.
    is_vru:         True only for near_miss events involving a person or vulnerable road user.
    message_en:     spoken message.
    timestamp:      wall-clock seconds.
    session_time_s: seconds since session start.
    """
    event_type:     EventType
    subtype:        Optional[RedLightSubtype]
    severity:       Severity
    is_vru:         bool
    message_en:     str
    timestamp:      float
    session_time_s: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind":           "alert",
            "event_type":     self.event_type.value,
            "subtype":        self.subtype.value if self.subtype is not None else None,
            "severity":       self.severity.value,
            "is_vru":         self.is_vru,
            "message_en":     self.message_en,
            "timestamp":      self.timestamp,
            "session_time_s": self.session_time_s,
        }


@dataclass
class SessionEvent:
    """
    A single event as it appears inside SessionSummary.events. Smaller than Alert, since the summary records only the structured fact of the event and not the spoken message.
    """
    event_type:     EventType
    subtype:        Optional[RedLightSubtype]
    severity:       Severity
    is_vru:         bool
    session_time_s: float
    timestamp:      float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_type":     self.event_type.value,
            "subtype":        self.subtype.value if self.subtype is not None else None,
            "severity":       self.severity.value,
            "is_vru":         self.is_vru,
            "session_time_s": self.session_time_s,
            "timestamp":      self.timestamp,
        }


@dataclass
class SpeedLimitChange:
    """
    Emitted by speed_limit_reader when the live speed limit changes. Pushed over the WebSocket with kind=speed_limit. Not a mistake event and never stored in SessionSummary.events.

    limit_kmh may be None to explicitly clear the previously known limit.
    """
    limit_kmh: Optional[int]
    timestamp: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind":      "speed_limit",
            "limit_kmh": self.limit_kmh,
            "timestamp": self.timestamp,
        }


@dataclass
class StatusMessage:
    """ Lifecycle status message, sent by the FastAPI server at WebSocket open and at session end. """
    state:     str    # "active" or "ended"
    timestamp: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind":      "status",
            "state":     self.state,
            "timestamp": self.timestamp,
        }


class ScoreLabel(str, Enum):
    EXCELLENT  = "EXCELLENT"
    GOOD       = "GOOD"
    IMPROVING  = "IMPROVING"
    NEEDS_WORK = "NEEDS WORK"


def score_to_label(score: float, max_score: float = 5.0) -> ScoreLabel:
    """
    Maps a numeric score to a user-facing label on a 0 to 5 scale.
        90 percent and above: EXCELLENT
        75 percent and above: GOOD
        60 percent and above: IMPROVING
        otherwise:            NEEDS WORK
    """
    if max_score <= 0:
        return ScoreLabel.NEEDS_WORK
    pct = score / max_score
    if pct >= 0.90:
        return ScoreLabel.EXCELLENT
    if pct >= 0.75:
        return ScoreLabel.GOOD
    if pct >= 0.60:
        return ScoreLabel.IMPROVING
    return ScoreLabel.NEEDS_WORK


@dataclass
class SessionSummary:
    """
    The complete post-drive payload. Returned by POST /sessions/{id}/stop and GET /sessions/{id}/summary, and forwarded to the database by the app.

    The events list is the canonical record. The serializer builds event_counts from it so the two views are always consistent.
    """
    session_id:       str
    started_at:       str        
    ended_at:         str        
    duration_seconds: int
    score:            float
    score_label:      ScoreLabel
    events:           List[SessionEvent]
    metadata:         Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        # event_counts is derived from events so the two stay consistent
        counts: Dict[str, int] = {et.value: 0 for et in EventType}
        for e in self.events:
            counts[e.event_type.value] += 1
        return {
            "session_id":       self.session_id,
            "started_at":       self.started_at,
            "ended_at":         self.ended_at,
            "duration_seconds": self.duration_seconds,
            "score":            round(self.score, 2),
            "score_label":      self.score_label.value,
            "event_counts":     counts,
            "events":           [e.to_dict() for e in self.events],
            "metadata":         self.metadata,
        }


def canonicalize(
    detector_event: Any,
    session_time_s: float,
) -> tuple[Alert, SessionEvent]:
    """
    Converts a detector's internal event into the (Alert, SessionEvent) pair used by the rest of the backend.

    detector_event: a LaneDepartureEvent, TailgatingEvent, RedLightEvent, or NearMissEvent. Each carries a .type enum whose .value is one of LANE_DEPARTURE, TAILGATING, RED_LIGHT_AHEAD, RED_LIGHT_RAN, or NEAR_MISS.
    session_time_s: seconds since session start, supplied by the pipeline.

    Returns the (Alert, SessionEvent) pair for the same underlying detection. Raises ValueError if the event type is not recognized.
    """
    internal = detector_event.type.value if hasattr(detector_event.type, "value") \
               else str(detector_event.type)

    ts = detector_event.timestamp

    if internal == "LANE_DEPARTURE":
        return (
            Alert(
                event_type     = EventType.LANE_DEPARTURE,
                subtype        = None,
                severity       = Severity.MEDIUM,
                is_vru         = False,
                message_en     = detector_event.message_en,
                timestamp      = ts,
                session_time_s = session_time_s,
            ),
            SessionEvent(
                event_type     = EventType.LANE_DEPARTURE,
                subtype        = None,
                severity       = Severity.MEDIUM,
                is_vru         = False,
                session_time_s = session_time_s,
                timestamp      = ts,
            ),
        )

    if internal == "TAILGATING":
        return (
            Alert(
                event_type     = EventType.TAILGATING,
                subtype        = None,
                severity       = Severity.HIGH,
                is_vru         = False,
                message_en     = detector_event.message_en,
                timestamp      = ts,
                session_time_s = session_time_s,
            ),
            SessionEvent(
                event_type     = EventType.TAILGATING,
                subtype        = None,
                severity       = Severity.HIGH,
                is_vru         = False,
                session_time_s = session_time_s,
                timestamp      = ts,
            ),
        )

    if internal == "RED_LIGHT_AHEAD":
        # the red light detector's event does not carry message_en, so the user-facing string is set here
        return (
            Alert(
                event_type     = EventType.RED_LIGHT,
                subtype        = RedLightSubtype.AHEAD,
                severity       = Severity.HIGH,
                is_vru         = False,
                message_en     = "Red light ahead, prepare to stop",
                timestamp      = ts,
                session_time_s = session_time_s,
            ),
            SessionEvent(
                event_type     = EventType.RED_LIGHT,
                subtype        = RedLightSubtype.AHEAD,
                severity       = Severity.HIGH,
                is_vru         = False,
                session_time_s = session_time_s,
                timestamp      = ts,
            ),
        )

    if internal == "RED_LIGHT_RAN":
        return (
            Alert(
                event_type     = EventType.RED_LIGHT,
                subtype        = RedLightSubtype.RAN,
                severity       = Severity.CRITICAL,
                is_vru         = False,
                message_en     = "You ran a red light",
                timestamp      = ts,
                session_time_s = session_time_s,
            ),
            SessionEvent(
                event_type     = EventType.RED_LIGHT,
                subtype        = RedLightSubtype.RAN,
                severity       = Severity.CRITICAL,
                is_vru         = False,
                session_time_s = session_time_s,
                timestamp      = ts,
            ),
        )

    if internal == "NEAR_MISS":
        # severity depends on whether the near-miss target is a vulnerable road user
        sev = Severity.CRITICAL if detector_event.is_vru else Severity.HIGH
        return (
            Alert(
                event_type     = EventType.NEAR_MISS,
                subtype        = None,
                severity       = sev,
                is_vru         = bool(detector_event.is_vru),
                message_en     = detector_event.message_en,
                timestamp      = ts,
                session_time_s = session_time_s,
            ),
            SessionEvent(
                event_type     = EventType.NEAR_MISS,
                subtype        = None,
                severity       = sev,
                is_vru         = bool(detector_event.is_vru),
                session_time_s = session_time_s,
                timestamp      = ts,
            ),
        )

    raise ValueError(f"unknown detector event type: {internal!r}")


# standalone smoke test, runs the dataclasses and the canonicalize() translator with a fake detector event
if __name__ == "__main__":
    from types import SimpleNamespace
    import json

    print("Alert.to_dict")
    a = Alert(
        event_type=EventType.TAILGATING,
        subtype=None,
        severity=Severity.HIGH,
        is_vru=False,
        message_en="Following too closely",
        timestamp=1716200000.123,
        session_time_s=42.5,
    )
    print(json.dumps(a.to_dict(), indent=2))

    print("\nSpeedLimitChange.to_dict")
    print(SpeedLimitChange(limit_kmh=80, timestamp=1716200000.5).to_dict())

    print("\nscore_to_label")
    for s in (5.0, 4.7, 4.0, 3.2, 2.0):
        print(f"  score={s} -> {score_to_label(s).value}")

    print("\nSessionSummary.to_dict")
    e1 = SessionEvent(EventType.LANE_DEPARTURE, None, Severity.MEDIUM,
                      False, 120.4, 1716200120.4)
    e2 = SessionEvent(EventType.RED_LIGHT, RedLightSubtype.RAN,
                      Severity.CRITICAL, False, 410.0, 1716200410.0)
    summary = SessionSummary(
        session_id="s_1716200000",
        started_at="2026-05-19T17:00:00Z",
        ended_at="2026-05-19T17:32:10Z",
        duration_seconds=1930,
        score=4.2,
        score_label=score_to_label(4.2),
        events=[e1, e2],
        metadata={"speed_limits_seen": [80, 100], "model_fps_avg": 14.6},
    )
    print(json.dumps(summary.to_dict(), indent=2))

    print("\ncanonicalize() on a fake LANE_DEPARTURE")
    fake = SimpleNamespace(
        type=SimpleNamespace(value="LANE_DEPARTURE"),
        message_en="Lane departure warning: drifting right",
        timestamp=1716200120.4,
    )
    alert, sess_ev = canonicalize(fake, session_time_s=120.4)
    print("alert:        ", alert.to_dict())
    print("session_event:", sess_ev.to_dict())
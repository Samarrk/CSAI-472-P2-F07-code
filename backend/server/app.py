"""
server/app.py

FastAPI + WebSocket wrapper around TamakkanPipeline.

Responsibilities:
- Loads the pipeline once at boot. Models stay warm; new sessions reset detector and tracker state but keep the loaded weights on GPU.
- Owns the camera or video source. /sessions/start opens it, /sessions/{id}/stop closes it.
- Runs the per-frame loop in a background asyncio task and pushes Alerts, SpeedLimitChanges, and StatusMessages onto a queue consumed by the WebSocket.
- Enforces one active session at a time. A second /sessions/start while one is active returns 409.

Out of scope: authentication, persistence (the Jetson is stateless across sessions), and anything phone-specific.

CLI:
  python -m server.app --source 0                  webcam
  python -m server.app --source path/to/clip.mp4   video file
  python -m server.app --host 0.0.0.0 --port 8000  network config
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

_HERE = Path(__file__).resolve()
_REPO = _HERE.parents[1]
for _p in (_REPO / "src", _REPO / "third_party"):
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from tamakkan.pipeline import TamakkanPipeline                        
from tamakkan.session_state import SessionState                      
from tamakkan.events import (                                         
    Alert,
    SpeedLimitChange,
    StatusMessage,
    SessionSummary,
)


# runtime config
_CONFIG: Dict[str, Any] = {
    "source":           "0",
    "host":             "0.0.0.0",
    "port":             8000,
    "yolo_weights":     None,
    "bytetrack_config": None,
    "depth_weights":    None,
    "lane_weights":     None,
    "device":           None,
    "depth_every_n":    8,
    "lanes_every_n":    5,
    "ocr_frame_skip":   999,
    "max_fps":          None,
}


def _resolve_source(src_str: str) -> Any:
    """ Camera index ('0', '1', ...) becomes int """
    try:
        return int(src_str)
    except ValueError:
        return src_str


class ActiveSession:
    """
    Holds everything tied to one in-flight drive: SessionState, the asyncio frame loop task, the VideoCapture, and a bounded queue of pending WebSocket messages. One instance lives at module scope for the duration of the drive and is cleared on stop.
    """

    def __init__(self, session_id: str, state: SessionState):
        self.session_id: str = session_id
        self.state: SessionState = state
        self.cap: Optional[cv2.VideoCapture] = None
        self.frame_task: Optional[asyncio.Task] = None
        # bounded queue so on overflow, new messages displace the oldest.
        self.alert_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=64)
        self.ended: bool = False
        self.summary: Optional[SessionSummary] = None
        # diagnostics
        self.frames_processed: int = 0
        self.frames_dropped: int = 0


# module-scope state. one pipeline, at most one active session.
_pipeline: Optional[TamakkanPipeline] = None
_active_session: Optional[ActiveSession] = None
_finished_summaries: Dict[str, SessionSummary] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan handler. Loads the pipeline at startup so the cold-start cost is paid once, before any request, and releases resources at shutdown.
    """
    global _pipeline

    cfg = _CONFIG
    print("Tamakkan server starting")
    print(f"  source:           {cfg['source']}")
    print(f"  weights:")
    print(f"    yolo            {cfg['yolo_weights']}")
    print(f"    bytetrack       {cfg['bytetrack_config']}")
    print(f"    depth           {cfg['depth_weights']}")
    print(f"    lanes           {cfg['lane_weights']}")
    print(f"  device:           {cfg['device'] or 'auto'}")
    print(f"  cadence:")
    print(f"    depth every     {cfg['depth_every_n']}")
    print(f"    lanes every     {cfg['lanes_every_n']}")
    print(f"    ocr skip        {cfg['ocr_frame_skip']}")

    t0 = time.time()
    _pipeline = TamakkanPipeline(
        yolo_weights     = cfg["yolo_weights"],
        bytetrack_config = cfg["bytetrack_config"],
        depth_weights    = cfg["depth_weights"],
        lane_weights     = cfg["lane_weights"],
        device           = cfg["device"],
        depth_every_n    = cfg["depth_every_n"],
        lanes_every_n    = cfg["lanes_every_n"],
        ocr_frame_skip   = cfg["ocr_frame_skip"],
    )
    cold = time.time() - t0
    print(f"pipeline loaded in {cold:.1f}s, ready to accept sessions")

    yield

    # shutdown: stop any active session cleanly
    if _active_session is not None and not _active_session.ended:
        print("shutdown: ending active session")
        await _shutdown_active_session()


app = FastAPI(title="Tamakkan Backend", lifespan=lifespan)

# CORS is open so the phone can reach the server from any origin on the local network. 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# request and response models
class StartSessionRequest(BaseModel):
    device_id: Optional[str] = None   


class StartSessionResponse(BaseModel):
    session_id: str


class HealthResponse(BaseModel):
    status: str
    pipeline_loaded: bool
    active_session_id: Optional[str]


# REST endpoints
@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status            = "ok",
        pipeline_loaded   = _pipeline is not None,
        active_session_id = _active_session.session_id if _active_session else None,
    )


@app.post("/sessions/start", response_model=StartSessionResponse)
async def start_session(_req: StartSessionRequest) -> StartSessionResponse:
    """
    Opens the camera or video source, starts the per-frame loop, and returns a session id. The phone then opens a WebSocket to /ws/session/{session_id} to receive alerts. One session is allowed at a time; concurrent calls return 409.
    """
    global _active_session

    if _pipeline is None:
        raise HTTPException(status_code=503, detail="pipeline not loaded yet")

    if _active_session is not None and not _active_session.ended:
        raise HTTPException(
            status_code=409,
            detail=f"a session is already active: {_active_session.session_id}",
        )

    # build a fresh SessionState and reset the pipeline so detectors, cooldowns, and the alert engine start clean. models stay loaded.
    state = SessionState()
    _pipeline.session = state
    _pipeline.reset()

    # open the source. camera index or file path through the same call.
    src = _resolve_source(_CONFIG["source"])
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise HTTPException(
            status_code=500,
            detail=f"could not open source: {_CONFIG['source']}",
        )

    sess = ActiveSession(session_id=state.session_id, state=state)
    sess.cap = cap

    # start the frame loop. it pushes messages to sess.alert_queue and calls pipeline.process_frame until the source ends or the session is stopped.
    sess.frame_task = asyncio.create_task(_frame_loop(sess))

    _active_session = sess
    print(f"session started: {sess.session_id}  source={_CONFIG['source']}")
    return StartSessionResponse(session_id=sess.session_id)


@app.post("/sessions/{session_id}/stop")
async def stop_session(session_id: str):
    """
    Stops the active session and returns its SessionSummary. After a session ends, calling stop again returns the cached summary. Stopping an unknown id returns 404.
    """
    global _active_session

    if _active_session is not None and _active_session.session_id == session_id:
        summary = await _shutdown_active_session()
        return summary.to_dict()

    if session_id in _finished_summaries:
        return _finished_summaries[session_id].to_dict()

    raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")


@app.get("/sessions/{session_id}/summary")
async def get_summary(session_id: str):
    """ Returns the session summary. Works for both active sessions (returns the summary so far) and finished sessions (returns the final summary). """
    if _active_session is not None and _active_session.session_id == session_id:
        if _active_session.ended and _active_session.summary is not None:
            return _active_session.summary.to_dict()
        return _active_session.state.to_summary().to_dict()

    if session_id in _finished_summaries:
        return _finished_summaries[session_id].to_dict()

    raise HTTPException(status_code=404, detail=f"unknown session: {session_id}")


# WebSocket
@app.websocket("/ws/session/{session_id}")
async def session_ws(ws: WebSocket, session_id: str):
    """
    Subscribes to the live alert stream for one session. The server pushes messages as they arrive in the session's queue:
      - kind=status, state=active   sent immediately on connect
      - kind=alert                  when detectors fire and pass the engine
      - kind=speed_limit            when OCR confirms a new limit
      - kind=status, state=ended    sent when the session stops

    A WebSocket disconnect does not end the session. The pipeline keeps running and events keep recording. On reconnect, the client picks up alerts from that point onward; alerts emitted while disconnected are not buffered.
    """
    await ws.accept()

    sess = _active_session
    if sess is None or sess.session_id != session_id:
        await ws.send_json({
            "kind": "status",
            "state": "ended",
            "timestamp": time.time(),
            "reason": "unknown_session",
        })
        await ws.close(code=4404)
        return

    # active-status handshake on connect
    await ws.send_json(StatusMessage(state="active", timestamp=time.time()).to_dict())

    try:
        while True:
            # wait for either a new queued message or the session ending. on session end, drain remaining messages before sending the final ended status so the phone receives the last alerts before the connection closes.
            try:
                msg = await asyncio.wait_for(sess.alert_queue.get(), timeout=1.0)
                await ws.send_json(msg)
            except asyncio.TimeoutError:
                if sess.ended:
                    while not sess.alert_queue.empty():
                        await ws.send_json(sess.alert_queue.get_nowait())
                    await ws.send_json(
                        StatusMessage(state="ended", timestamp=time.time()).to_dict()
                    )
                    await ws.close()
                    return
                continue
    except WebSocketDisconnect:
        # phone went away. pipeline keeps running; reconnect is allowed at any time.
        print(f"ws disconnected: {session_id} (session continues)")


# frame loop
async def _frame_loop(sess: ActiveSession) -> None:
    """
    Per-session worker. Reads frames from sess.cap, runs them through the pipeline, and queues messages for the WebSocket. Runs until the source ends, sess.ended is set by /stop, or an uncaught exception occurs.

    """
    assert _pipeline is not None
    assert sess.cap is not None
    loop = asyncio.get_event_loop()

    max_fps = _CONFIG.get("max_fps")
    frame_min_dt = (1.0 / max_fps) if max_fps else 0.0

    try:
        while not sess.ended:
            t_loop = time.time()

            # cv2.VideoCapture.read is blocking. for a webcam it returns the next frame; for a file it returns False at EOF.
            ok, frame = await loop.run_in_executor(None, sess.cap.read)
            if not ok or frame is None:
                # end of stream: video file finished or camera dropped. stop the session naturally.
                print(f"session {sess.session_id}: source ended")
                break

            try:
                result = await loop.run_in_executor(
                    None, _pipeline.process_frame, frame
                )
            except Exception as e:
                print(f"session {sess.session_id}: pipeline error: {e!r}")
                break

            sess.frames_processed += 1

            # push any messages the pipeline produced. the queue is bounded and drops the oldest on overflow.
            if result.alert is not None:
                _push_or_drop(sess, result.alert.to_dict())
            if result.speed_limit_change is not None:
                _push_or_drop(sess, result.speed_limit_change.to_dict())

            if frame_min_dt > 0:
                slack = frame_min_dt - (time.time() - t_loop)
                if slack > 0:
                    await asyncio.sleep(slack)

    finally:
        # cleanup is centralised in _shutdown_active_session
        if not sess.ended:

            await _shutdown_active_session(triggered_internally=True)


def _push_or_drop(sess: ActiveSession, msg: Dict[str, Any]) -> None:
    """
    Non-blocking enqueue. If the queue is full (WebSocket not reading fast enough or disconnected), drops the oldest message and pushes the new one, since alerts are time-sensitive and the newest is the most relevant.
    """
    try:
        sess.alert_queue.put_nowait(msg)
    except asyncio.QueueFull:
        try:
            _ = sess.alert_queue.get_nowait()
            sess.alert_queue.put_nowait(msg)
            sess.frames_dropped += 1
        except (asyncio.QueueEmpty, asyncio.QueueFull):
            sess.frames_dropped += 1


async def _shutdown_active_session(triggered_internally: bool = False) -> SessionSummary:
    """ Stops the frame loop, closes the camera, seals the session, and caches the summary. """
    global _active_session

    sess = _active_session
    if sess is None:
        raise HTTPException(status_code=400, detail="no active session")

    if sess.ended and sess.summary is not None:
        return sess.summary

    sess.ended = True

    # cancel the frame loop unless we're already inside it
    if sess.frame_task is not None and not triggered_internally:
        sess.frame_task.cancel()
        try:
            await sess.frame_task
        except (asyncio.CancelledError, Exception):
            pass

    # release the camera
    if sess.cap is not None:
        try:
            sess.cap.release()
        except Exception:
            pass
        sess.cap = None

    # seal the session and build the summary
    sess.state.end()
    summary = sess.state.to_summary()
    sess.summary = summary

    # cache for late /summary calls. capped so a long-running server doesn't accumulate forever.
    _finished_summaries[sess.session_id] = summary
    if len(_finished_summaries) > 16:
        oldest = next(iter(_finished_summaries))
        _finished_summaries.pop(oldest, None)

    print(
        f"session ended: {sess.session_id}  "
        f"frames={sess.frames_processed}  dropped_alerts={sess.frames_dropped}  "
        f"score={summary.score:.2f}  label={summary.score_label.value}  "
        f"events={len(summary.events)}"
    )

    # clear the active slot so a new session can start
    _active_session = None
    return summary


# CLI entry
def _default_weights_dir() -> Path:
    return _REPO / "weights"


def _build_argparser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="tamakkan-server",
        description="Tamakkan backend (FastAPI + WebSocket).",
    )
    p.add_argument(
        "--source",
        default="0",
        help="Camera index (0, 1, ...) or video file path. Default: 0.",
    )
    p.add_argument("--host", default="0.0.0.0", help="Bind host. Default: 0.0.0.0")
    p.add_argument("--port", type=int, default=8000, help="Bind port. Default: 8000")

    p.add_argument(
        "--weights-dir",
        default=str(_default_weights_dir()),
        help=f"Directory with model weights. Default: {_default_weights_dir()}",
    )
    p.add_argument("--device", default=None, help="cuda:0, cpu, or None for auto")
    p.add_argument("--depth-every-n", type=int, default=8)
    p.add_argument("--lanes-every-n", type=int, default=5)
    p.add_argument("--ocr-frame-skip", type=int, default=999)
    p.add_argument(
        "--max-fps",
        type=float,
        default=None,
        help="Cap pipeline FPS by sleeping between frames. None means uncapped.",
    )
    return p


def main():
    args = _build_argparser().parse_args()

    weights_dir = Path(args.weights_dir).resolve()
    if not weights_dir.is_dir():
        print(f"ERROR: weights dir not found: {weights_dir}", file=sys.stderr)
        sys.exit(1)

    # resolve weight files and stash everything in _CONFIG for the lifespan to read at startup
    _CONFIG.update({
        "source":           args.source,
        "host":              args.host,
        "port":              args.port,
        "yolo_weights":      str(weights_dir / "best.engine") if (weights_dir / "best.engine").exists() else str(weights_dir / "best.pt"),
        "bytetrack_config":  str(weights_dir / "bytetrack_tamakkan.yaml"),
        "depth_weights":     str(weights_dir / "depth_anything_v2_vits.engine") if (weights_dir / "depth_anything_v2_vits.engine").exists() else str(weights_dir / "depth_anything_v2_vits.pth"),
        "lane_weights":      str(weights_dir / "culane_res18_v2.engine") if (weights_dir / "culane_res18_v2.engine").exists() else str(weights_dir / "culane_res18_v2.pth"),
        "device":            args.device,
        "depth_every_n":     args.depth_every_n,
        "lanes_every_n":     args.lanes_every_n,
        "ocr_frame_skip":    args.ocr_frame_skip,
        "max_fps":           args.max_fps,
    })

    # verify weights exist before starting the server and accepting sessions, so the user gets immediate feedback if something's wrong instead of waiting through the startup cost and then getting runtime errors when a session starts.
    for label, path in [
        ("yolo",      _CONFIG["yolo_weights"]),
        ("bytetrack", _CONFIG["bytetrack_config"]),
        ("depth",     _CONFIG["depth_weights"]),
        ("lanes",     _CONFIG["lane_weights"]),
    ]:
        if not Path(path).is_file():
            print(f"ERROR: missing {label} weights: {path}", file=sys.stderr)
            sys.exit(1)

    import uvicorn
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
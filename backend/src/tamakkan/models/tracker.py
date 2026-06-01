"""
src/tamakkan/models/tracker.py

TamakkanTracker, the detection and tracking wrapper for the Tamakkan pipeline.

Wraps YOLOv11s and ByteTrack into one component. Every downstream module (depth, OCR, red light, lane, AlertEngine) only ever sees the list of Track objects that .update() returns. 

YOLOv11s and not v11m: we tested both during training. The smaller model gave up some accuracy for the speed boost, and the speed boost is worth it for our use case.

Usage:
    tracker = TamakkanTracker(
        weights="weights/best.pt",           or "weights/best.engine" on Jetson
        tracker_config="weights/bytetrack_tamakkan.yaml",
    )
    for frame in video_stream:
        tracks = tracker.update(frame)
        vehicles = [t for t in tracks if t.is_vehicle]
"""

from __future__ import annotations

# numpy compatibility shim for tensorrt on the jetson.
import numpy as _np
if not hasattr(_np, "bool"):
    _np.bool = bool
if not hasattr(_np, "long"):
    _np.long = int

from dataclasses import dataclass
from pathlib import Path
from typing import List

import numpy as np
import torch
from ultralytics import YOLO


@dataclass
class Track:
    """
    One tracked object in one frame.

    """
    track_id: int                                    # stays the same across frames for the same physical object
    class_id: int                                    # 0-6 according to the CLASS_NAMES mapping
    class_name: str                                  # human-readable class name
    confidence: float                                # detection confidence between 0 and 1
    bbox: tuple                                      # (x1, y1, x2, y2), can be sub-pixel

    # geometric helpers
    @property
    def bbox_int(self):
        """ Bbox rounded to ints and clamped non-negative, ready to use for image cropping. """
        x1, y1, x2, y2 = self.bbox
        return (max(0, int(x1)), max(0, int(y1)),
                max(0, int(x2)), max(0, int(y2)))

    @property
    def center(self):
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) * 0.5, (y1 + y2) * 0.5)

    @property
    def width(self) -> float:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]

    @property
    def area(self) -> float:
        return self.width * self.height

    # semantic helpers so downstream code can write "if t.is_vehicle" instead of "if t.class_id in {0,1,2}"
    @property
    def is_vehicle(self) -> bool:
        return self.class_id in TamakkanTracker.VEHICLE_CLASSES

    @property
    def is_vru(self) -> bool:
        return self.class_id in TamakkanTracker.VRU_CLASSES

    @property
    def is_traffic_light(self) -> bool:
        return self.class_id in TamakkanTracker.LIGHT_CLASSES

    @property
    def is_traffic_sign(self) -> bool:
        return self.class_id in TamakkanTracker.SIGN_CLASSES


class TamakkanTracker:
    """
    YOLOv11s + ByteTrack wrapper.

    Accepts either a PyTorch .pt file or a TensorRT .engine file. Picked from the file extension.
    """

    CLASS_NAMES = {
        0: "car",
        1: "truck",
        2: "bus",
        3: "person",
        4: "traffic_light",
        5: "traffic_sign",
        6: "vulnerable_road_user",
    }

    # class groupings used by the is_vehicle / is_vru / etc helpers above
    VEHICLE_CLASSES = {0, 1, 2}
    VRU_CLASSES     = {3, 6}
    LIGHT_CLASSES   = {4}
    SIGN_CLASSES    = {5}

    def __init__(
        self,
        weights: str,
        tracker_config: str = "bytetrack_tamakkan.yaml",
        conf: float = 0.25,
        iou: float = 0.7,
        imgsz: int = 1280,
        device=None,
        half: bool = True,
    ):
        if not Path(weights).exists():
            raise FileNotFoundError(f"weights file not found: {weights}")
        if not Path(tracker_config).exists():
            raise FileNotFoundError(f"tracker config not found: {tracker_config}")

        if device is None:
            device = "cuda:0" if torch.cuda.is_available() else "cpu"

        # half precision (FP16) only on GPU
        if device == "cpu" and half:
            half = False

        # detect TensorRT engine by file extension. on Jetson we convert our .pt to .engine for faster inference, but on PC we just use the .pt directly.
        is_engine = Path(weights).suffix.lower() == ".engine"

        if is_engine:
            self.model = YOLO(weights, task="detect")
        else:
            self.model = YOLO(weights)

        self.weights_path = weights
        self.is_engine = is_engine
        self.tracker_config = tracker_config
        self.conf = conf
        self.iou = iou
        self.imgsz = imgsz
        self.device = device
        self.half = half

    def update(self, frame: np.ndarray) -> List[Track]:
        # run YOLO + ByteTrack on this frame. persist=True keeps the tracker state alive between calls so track IDs stay stable across frames.
        results = self.model.track(
            source=frame,
            conf=self.conf,
            iou=self.iou,
            imgsz=self.imgsz,
            device=self.device,
            half=self.half,
            persist=True,
            tracker=self.tracker_config,
            verbose=False,
            stream=False,
        )

        result = results[0]

        # nothing detected, or detections exist but ByteTrack hasn't assigned IDs yet
        if result.boxes is None or result.boxes.id is None:
            return []

        # pull everything off the GPU back to numpy in one go
        boxes       = result.boxes.xyxy.cpu().numpy()
        track_ids   = result.boxes.id.cpu().numpy().astype(int)
        class_ids   = result.boxes.cls.cpu().numpy().astype(int)
        confidences = result.boxes.conf.cpu().numpy()

        return [
            Track(
                track_id   = int(track_ids[i]),
                class_id   = int(class_ids[i]),
                class_name = self.CLASS_NAMES.get(int(class_ids[i]),
                                                  f"unknown_{class_ids[i]}"),
                confidence = float(confidences[i]),
                bbox       = tuple(boxes[i].tolist()),
            )
            for i in range(len(track_ids))
        ]

    def reset(self):
        """
        Clear all tracker state. Call between unrelated clips or at the start of a new driving session.
        """
        if self.is_engine:
            self.model = YOLO(self.weights_path, task="detect")
        else:
            self.model = YOLO(self.weights_path)


# standalone smoke test, we run this file directly to check the tracker runs and produces sensible detections on one image. not part of the pipeline.
if __name__ == "__main__":
    import sys
    import time
    import cv2

    if len(sys.argv) < 2:
        print("usage: python tracker.py <image_path> [weights_path]")
        sys.exit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"could not read image: {sys.argv[1]}")
        sys.exit(1)

    weights = sys.argv[2] if len(sys.argv) >= 3 else "weights/best.pt"

    tracker = TamakkanTracker(
        weights=weights,
        tracker_config="weights/bytetrack_tamakkan.yaml",
    )
    print(f"tracker initialized on {tracker.device}, "
          f"engine={tracker.is_engine}, half={tracker.half}")

    # run once before timing because the first call does one-time setup
    _ = tracker.update(img)

    t0 = time.time()
    for _ in range(10):
        tracks = tracker.update(img)
    dt = (time.time() - t0) / 10
    print(f"latency: {dt*1000:.1f} ms per frame  ({1/dt:.1f} FPS)")

    print(f"\ndetected {len(tracks)} tracks:")
    for t in tracks:
        flag = "[V]" if t.is_vehicle else "[P]" if t.is_vru else "[L]" if t.is_traffic_light else "[S]" if t.is_traffic_sign else "[?]"
        print(f"  {flag} id={t.track_id:>3}  {t.class_name:25s}  "
              f"conf={t.confidence:.3f}  bbox={t.bbox_int}")
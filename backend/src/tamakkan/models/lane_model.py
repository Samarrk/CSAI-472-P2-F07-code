"""
src/tamakkan/models/lane_model.py

Wrapper around UFLD-v2 (Ultra-Fast Lane Detection v2, CULane ResNet-18). The pipeline calls this to get lane lines from each camera frame, which the lane departure detector then uses to figure out if we are drifting out of our lane.

Why v2 and not v1:
v1 used row anchors only and was trained on the Chinese CULane dataset. When we tested it on Saudi dashcam footage the lanes flailed all over the road. The model just did not generalize, no amount of code tweaking on our side fixed it. v2 uses both row and column anchors, which makes it work much better on road geometry that does not match what it was trained on.

Two model file formats, same setup as the depth model:
- .pth is regular PyTorch, used on the desktop
- .engine is the TensorRT compiled version, used on the Jetson
The class picks the backend from the file extension.

What this file does:
- BGR frame in, list of Lane objects in the original frame coordinates out
- holds a small smoothing buffer so lanes do not jitter between frames
- visualization (drawing lanes on a frame) is not here, that lives elsewhere


preprocessing is resize then crop, not just resize. controlled by crop_ratio = 0.6. the frame gets resized to (533, 1600), then the bottom 320 rows are kept. this is how the model was trained.


"""

from __future__ import annotations

# numpy compatibility shim for tensorrt on the jetson.
import numpy as _np
if not hasattr(_np, "bool"):
    _np.bool = bool
if not hasattr(_np, "long"):
    _np.long = int

from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
import torch

from ufld_v2.model.model_culane import parsingNet


# CULane ResNet-18 config.
# these are baked into the pretrained weights.
CFG_BACKBONE      = "18"
CFG_GRIDING_NUM   = 200
CFG_NUM_LANES     = 4
CFG_NUM_ROW       = 72      # how many row anchors the model uses
CFG_NUM_COL       = 81      # how many column anchors the model uses
CFG_NUM_CELL_ROW  = 200     # grid resolution along a row
CFG_NUM_CELL_COL  = 100     # grid resolution along a column
CFG_TRAIN_WIDTH   = 1600
CFG_TRAIN_HEIGHT  = 320
CFG_FC_NORM       = True
CFG_CROP_RATIO    = 0.6

# row anchors start at 42% down the image because everything above that is sky/horizon
ROW_ANCHOR = np.linspace(0.42, 1.0, CFG_NUM_ROW)
COL_ANCHOR = np.linspace(0.0, 1.0, CFG_NUM_COL)

# the model can detect 4 lanes. the inner two (indices 1 and 2) are our own lane and we read them off row anchors. the outer two (0 and 3) are the neighboring lanes and we read them off column anchors.
ROW_LANE_IDX = [1, 2]
COL_LANE_IDX = [0, 3]

# CULane's reference image size. the model outputs coordinates in this frame and we scale them to the actual camera frame later.
REF_W = 1640
REF_H = 590

# ImageNet normalization. these are the stats used to train the model, so we need to use them at inference time too. stored as (1,3,1,1).
_IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
_IMAGENET_STD  = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)


@dataclass
class Lane:
    # the lane stored both as raw points and as a fitted polynomial, plus where it crosses the bottom of the frame which is what the lane departure detector actually compares against
    points:     List[Tuple[float, float]]
    polynomial: Tuple[float, float, float]
    side:       str
    confidence: float
    x_at_bottom: float

    @property
    def y_top(self)    -> float: return self.points[0][1]
    @property
    def y_bottom(self) -> float: return self.points[-1][1]


class LaneSmoother:
    # raw lane detections jitter from frame to frame even when nothing in the scene is moving. averaging the last few frames removes most of that and keeps the on-screen lane stable.
    def __init__(self, window: int = 5):
        self.window = window
        self.buffer: deque = deque(maxlen=window)

    def reset(self): self.buffer.clear()

    def update(self, lanes: List[Lane]) -> List[Lane]:
        self.buffer.append(lanes)
        if len(self.buffer) < 2:
            return lanes

        # group lanes from past frames by side (ego_left, ego_right, etc) then average the polynomial and bottom x for each side
        by_side: dict = {}
        for past in self.buffer:
            for ln in past:
                by_side.setdefault(ln.side, []).append(ln)

        smoothed: List[Lane] = []
        for side, group in by_side.items():
            # only smooth if the side was seen in more than half the buffer, otherwise a one-off false detection would create a fake lane
            if len(group) < self.window // 2 + 1:
                continue
            polys = np.array([g.polynomial for g in group])
            xs    = np.array([g.x_at_bottom for g in group])
            avg_poly = tuple(polys.mean(axis=0))
            avg_x    = float(xs.mean())
            ref = group[-1]
            smoothed.append(Lane(
                points      = ref.points,
                polynomial  = avg_poly,
                side        = side,
                confidence  = ref.confidence,
                x_at_bottom = avg_x,
            ))
        smoothed.sort(key=lambda l: l.x_at_bottom)
        return smoothed


class _TRTLaneBackend:
    """ The TensorRT version of the backend, used on the Jetson. Same idea as the TRT backend in depth_model.py but with four output buffers instead of one. """

    def __init__(self, engine_path: str):
        # only import tensorrt and pycuda on the Jetson, the desktop does not have them installed
        import tensorrt as trt
        import pycuda.driver as cuda
        cuda.init()

        # primary CUDA context so we can push it onto FastAPI worker threads
        self._trt = trt
        self._cuda = cuda
        device = cuda.Device(0)
        self._cuda_ctx = device.retain_primary_context()
        self._cuda_ctx.push()

        # load the compiled engine
        logger = trt.Logger(trt.Logger.WARNING)
        runtime = trt.Runtime(logger)
        with open(engine_path, "rb") as f:
            self.engine = runtime.deserialize_cuda_engine(f.read())
        if self.engine is None:
            raise RuntimeError(f"could not load engine: {engine_path}")

        self.context = self.engine.create_execution_context()

        # the engine has five slots: one input and four outputs. names were set when we exported the model in export_ufld_onnx.py. fall back to positions if the names ever change.
        self._bind_input    = self._idx("input",    fallback=0)
        self._bind_loc_row  = self._idx("loc_row",  fallback=1)
        self._bind_loc_col  = self._idx("loc_col",  fallback=2)
        self._bind_exist_r  = self._idx("exist_row",fallback=3)
        self._bind_exist_c  = self._idx("exist_col",fallback=4)

        self.input_shape    = tuple(self.engine.get_binding_shape(self._bind_input))
        self.loc_row_shape  = tuple(self.engine.get_binding_shape(self._bind_loc_row))
        self.loc_col_shape  = tuple(self.engine.get_binding_shape(self._bind_loc_col))
        self.exist_r_shape  = tuple(self.engine.get_binding_shape(self._bind_exist_r))
        self.exist_c_shape  = tuple(self.engine.get_binding_shape(self._bind_exist_c))

        # allocate pinned host buffers and matching GPU buffers, one set per slot, once up front
        self.h_input    = cuda.pagelocked_empty(int(np.prod(self.input_shape)),   dtype=np.float32)
        self.h_loc_row  = cuda.pagelocked_empty(int(np.prod(self.loc_row_shape)), dtype=np.float32)
        self.h_loc_col  = cuda.pagelocked_empty(int(np.prod(self.loc_col_shape)), dtype=np.float32)
        self.h_exist_r  = cuda.pagelocked_empty(int(np.prod(self.exist_r_shape)), dtype=np.float32)
        self.h_exist_c  = cuda.pagelocked_empty(int(np.prod(self.exist_c_shape)), dtype=np.float32)

        self.d_input    = cuda.mem_alloc(self.h_input.nbytes)
        self.d_loc_row  = cuda.mem_alloc(self.h_loc_row.nbytes)
        self.d_loc_col  = cuda.mem_alloc(self.h_loc_col.nbytes)
        self.d_exist_r  = cuda.mem_alloc(self.h_exist_r.nbytes)
        self.d_exist_c  = cuda.mem_alloc(self.h_exist_c.nbytes)

        # TensorRT expects the bindings list ordered by binding index, not by the order we wrote them above. build the list by index so we don't accidentally swap two outputs.
        bindings_list = [None] * self.engine.num_bindings
        bindings_list[self._bind_input]   = int(self.d_input)
        bindings_list[self._bind_loc_row] = int(self.d_loc_row)
        bindings_list[self._bind_loc_col] = int(self.d_loc_col)
        bindings_list[self._bind_exist_r] = int(self.d_exist_r)
        bindings_list[self._bind_exist_c] = int(self.d_exist_c)
        self.bindings = bindings_list

        self.stream = cuda.Stream()
        self._cuda_ctx.pop()

    def _idx(self, name: str, fallback: int) -> int:
        i = self.engine.get_binding_index(name)
        return i if i >= 0 else fallback

    def infer(self, chw_float32: np.ndarray) -> dict:
        """ Run one inference, safe to call from any thread. Returns a dict matching the PyTorch model output so the decoder does not need to know which backend ran. """
        self._cuda_ctx.push()
        try:
            return self._infer_inner(chw_float32)
        finally:
            self._cuda_ctx.pop()

    def _infer_inner(self, chw_float32: np.ndarray) -> dict:
        # send the frame to the GPU
        np.copyto(self.h_input, chw_float32.ravel())
        self._cuda.memcpy_htod_async(self.d_input, self.h_input, self.stream)

        # run
        self.context.execute_async_v2(
            bindings=self.bindings,
            stream_handle=self.stream.handle,
        )

        # pull all four outputs back to the CPU and wait for completion before reading them
        self._cuda.memcpy_dtoh_async(self.h_loc_row, self.d_loc_row, self.stream)
        self._cuda.memcpy_dtoh_async(self.h_loc_col, self.d_loc_col, self.stream)
        self._cuda.memcpy_dtoh_async(self.h_exist_r, self.d_exist_r, self.stream)
        self._cuda.memcpy_dtoh_async(self.h_exist_c, self.d_exist_c, self.stream)
        self.stream.synchronize()

        # wrap as torch tensors because the decoder uses torch ops (argmax, softmax) and we want one decoder shared between both backends
        return {
            "loc_row":   torch.from_numpy(self.h_loc_row.reshape(self.loc_row_shape).copy()),
            "loc_col":   torch.from_numpy(self.h_loc_col.reshape(self.loc_col_shape).copy()),
            "exist_row": torch.from_numpy(self.h_exist_r.reshape(self.exist_r_shape).copy()),
            "exist_col": torch.from_numpy(self.h_exist_c.reshape(self.exist_c_shape).copy()),
        }


class LaneDetector:
    """
    The public lane detector. Pipeline talks to this, not to the backends directly. .pth runs PyTorch on the desktop, .engine runs TensorRT on the Jetson, and the picking is hidden from the caller.
    """

    def __init__(
        self,
        weights_path: str,
        device=None,
        min_points: int = 8,
        min_lane_height_frac: float = 0.20,
        smoothing_window: int = 5,
    ):
        if not Path(weights_path).exists():
            raise FileNotFoundError(f"weights file not found: {weights_path}")

        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device) if isinstance(device, str) else device

        self.weights_path = weights_path
        self.is_engine = Path(weights_path).suffix.lower() == ".engine"

        if self.is_engine:
            # TensorRT path, no torch model needed
            self.trt_backend = _TRTLaneBackend(weights_path)
            self.net = None
            self._dtype = torch.float32
        else:
            # PyTorch path, build the model architecture then load the weights into it
            self.net = parsingNet(
                pretrained=False,
                backbone=CFG_BACKBONE,
                num_grid_row=CFG_NUM_CELL_ROW,
                num_cls_row=CFG_NUM_ROW,
                num_grid_col=CFG_NUM_CELL_COL,
                num_cls_col=CFG_NUM_COL,
                num_lane_on_row=CFG_NUM_LANES,
                num_lane_on_col=CFG_NUM_LANES,
                use_aux=False,
                input_height=CFG_TRAIN_HEIGHT,
                input_width=CFG_TRAIN_WIDTH,
                fc_norm=CFG_FC_NORM,
            )
            ckpt = torch.load(weights_path, map_location=self.device)
            state_dict = ckpt["model"] if "model" in ckpt else ckpt
            # strip the "module." prefix that gets added when a model is trained with DataParallel, so the keys match our non-parallel model
            clean = {
                (k[7:] if k.startswith("module.") else k): v
                for k, v in state_dict.items()
            }
            # strict=False because we don't need the auxiliary training-only layers
            self.net.load_state_dict(clean, strict=False)
            self.net = self.net.to(self.device)
            self.net.eval()
            # half precision on GPU, full on CPU, same reasoning as the depth model
            if self.device.type == "cuda":
                self.net = self.net.half()
                self._dtype = torch.float16
            else:
                self._dtype = torch.float32
            self.trt_backend = None

        # normalization constants on the right device for the PyTorch path
        self._mean = _IMAGENET_MEAN.to(self.device, dtype=self._dtype)
        self._std  = _IMAGENET_STD.to(self.device,  dtype=self._dtype)

        # filtering thresholds, all of these were tuned against our Saudi dashcam footage:
        # min_points = 8       drop lanes with too few points to fit a stable polynomial through
        # min_lane_height_frac don't accept short lane fragments that don't span enough of the frame
        # smoothing_window = 5 average the last 5 frames to kill jitter
        self.min_points = min_points
        self.min_lane_height_frac = min_lane_height_frac
        self.smoother = LaneSmoother(window=smoothing_window)

    # public API
    def update(self, bgr_frame: np.ndarray) -> List[Lane]:
        if bgr_frame is None or bgr_frame.size == 0:
            return []

        h_orig, w_orig = bgr_frame.shape[:2]

        # preprocess on the right path, run the model, then decode
        if self.is_engine:
            chw = self._preprocess_numpy(bgr_frame)   # shape (1,3,320,1600), float32
            pred = self.trt_backend.infer(chw)
        else:
            tensor = self._preprocess_torch(bgr_frame)
            with torch.no_grad():
                pred = self.net(tensor)

        raw = self._decode(pred, w_orig, h_orig)
        # always run the result through the smoother so the output is stable
        return self.smoother.update(raw)

    def reset(self):
        # call this on a new video or after a long pause so old buffered lanes don't bleed into the new scene
        self.smoother.reset()

    # preprocessing
    @torch.no_grad()
    def _preprocess_torch(self, bgr_frame: np.ndarray) -> torch.Tensor:
        """ PyTorch path. Returns a (1,3,320,1600) tensor on self.device. """
        # the model was trained with resize-then-crop, not plain resize. resize to (533, 1600), then keep only the bottom 320 rows. this throws out the sky and keeps the road.
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        resize_h = int(CFG_TRAIN_HEIGHT / CFG_CROP_RATIO)
        resized = cv2.resize(rgb, (CFG_TRAIN_WIDTH, resize_h))
        cropped = resized[resize_h - CFG_TRAIN_HEIGHT:resize_h, :, :]
        tensor = (
            torch.from_numpy(cropped)
            .permute(2, 0, 1)
            .unsqueeze(0)
            .to(self.device, dtype=self._dtype, non_blocking=True)
            .div_(255.0)
        )
        return (tensor - self._mean) / self._std

    def _preprocess_numpy(self, bgr_frame: np.ndarray) -> np.ndarray:
        """ TensorRT path. Same as above but stays in numpy because the TRT backend takes numpy input. """
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        resize_h = int(CFG_TRAIN_HEIGHT / CFG_CROP_RATIO)
        resized = cv2.resize(rgb, (CFG_TRAIN_WIDTH, resize_h))
        cropped = resized[resize_h - CFG_TRAIN_HEIGHT:resize_h, :, :]
        chw = cropped.astype(np.float32).transpose(2, 0, 1)[None, ...] / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 3, 1, 1)
        std  = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 3, 1, 1)
        return (chw - mean) / std

    # decoder. turns the four model outputs into a list of Lane objects.
    def _decode(self, pred: dict, w_orig: int, h_orig: int) -> List[Lane]:
        loc_row = pred["loc_row"]
        loc_col = pred["loc_col"]
        exist_row = pred["exist_row"]
        exist_col = pred["exist_col"]

        _, num_grid_row, num_cls_row, num_lane_row = loc_row.shape
        _, num_grid_col, num_cls_col, num_lane_col = loc_col.shape

        # for each anchor, pick the most likely grid cell (argmax) and whether the lane exists there at all
        max_idx_row = loc_row.argmax(1).cpu()
        valid_row   = exist_row.argmax(1).cpu()
        max_idx_col = loc_col.argmax(1).cpu()
        valid_col   = exist_col.argmax(1).cpu()

        loc_row_cpu = loc_row.float().cpu()
        loc_col_cpu = loc_col.float().cpu()

        # CULane coordinates to actual frame coordinates
        sx = w_orig / REF_W
        sy = h_orig / REF_H

        lanes: List[Lane] = []

        # row anchors give us the two ego lanes (the ones on either side of our car)
        for i in ROW_LANE_IDX:
            # require at least half the anchors to vote "lane exists here", otherwise we'd be fitting noise
            if valid_row[0, :, i].sum() <= num_cls_row / 2:
                continue
            pts = []
            for k in range(num_cls_row):
                if valid_row[0, k, i] == 0:
                    continue
                idx = int(max_idx_row[0, k, i])
                # softmax over a small window around the argmax gives sub-grid precision instead of snapping to the nearest grid cell
                lo = max(0, idx - 4)
                hi = min(num_grid_row - 1, idx + 4)
                prob = loc_row_cpu[0, lo:hi+1, k, i].softmax(0)
                pos = torch.arange(lo, hi+1, dtype=torch.float32)
                loc = (prob * pos).sum().item()
                x_ref = loc / (num_grid_row - 1) * REF_W
                y_ref = ROW_ANCHOR[k] * REF_H
                pts.append((x_ref * sx, y_ref * sy))
            if len(pts) < self.min_points:
                continue
            lanes.append(self._build_lane(pts, h_orig, "ego_left" if i == 1 else "ego_right"))

        # column anchors give us the two outer lanes (the lanes one over from ours on each side)
        for i in COL_LANE_IDX:
            # outer lanes are partially out of frame so we accept a lower bar (quarter instead of half)
            if valid_col[0, :, i].sum() <= num_cls_col / 4:
                continue
            pts = []
            for k in range(num_cls_col):
                if valid_col[0, k, i] == 0:
                    continue
                idx = int(max_idx_col[0, k, i])
                lo = max(0, idx - 4)
                hi = min(num_grid_col - 1, idx + 4)
                prob = loc_col_cpu[0, lo:hi+1, k, i].softmax(0)
                pos = torch.arange(lo, hi+1, dtype=torch.float32)
                loc = (prob * pos).sum().item()
                x_ref = COL_ANCHOR[k] * REF_W
                y_ref = loc / (num_grid_col - 1) * REF_H
                pts.append((x_ref * sx, y_ref * sy))
            if len(pts) < self.min_points:
                continue
            lanes.append(self._build_lane(pts, h_orig, "outer_left" if i == 0 else "outer_right"))

        # drop lanes that don't span enough vertical space. these are usually little fragments at the horizon, not real lanes.
        min_h_px = self.min_lane_height_frac * h_orig
        kept = []
        for ln in lanes:
            if ln.y_bottom - ln.y_top < min_h_px:
                continue
            kept.append(ln)
        # sort left to right so downstream code can rely on the order
        kept.sort(key=lambda l: l.x_at_bottom)
        return kept

    def _build_lane(self, pts: List[Tuple[float, float]], h_orig: int, side: str) -> Lane:
        xs = np.array([p[0] for p in pts])
        ys = np.array([p[1] for p in pts])
        # fit a quadratic curve (x as a function of y) through the points. lanes curve in real life so a straight line isn't enough.
        try:
            poly = np.polyfit(ys, xs, 2)
        except Exception:
            # if the fit ever fails (degenerate points, etc) fall back to a vertical line at the mean x so the pipeline doesn't crash
            poly = (0.0, 0.0, float(np.mean(xs)))
        # x_at_bottom is where the lane crosses the very bottom of the frame, which is what the departure detector compares against
        x_at_bottom = float(np.polyval(poly, h_orig - 1))
        return Lane(
            points      = pts,
            polynomial  = tuple(poly),
            side        = side,
            confidence  = 1.0,
            x_at_bottom = x_at_bottom,
        )


# standalone smoke test, we run this file directly to check the model loads and produces sensible lanes on one image. not part of the pipeline.
if __name__ == "__main__":
    import sys
    import time

    if len(sys.argv) < 2:
        print("usage: python lane_model.py <image_path> [weights_path]")
        sys.exit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"could not read image: {sys.argv[1]}")
        sys.exit(1)

    weights = sys.argv[2] if len(sys.argv) >= 3 else "weights/culane_res18_v2.pth"
    print(f"loading {weights}")
    det = LaneDetector(weights_path=weights)
    print(f"  device={det.device}  is_engine={det.is_engine}")

    # run once before timing because the first call does one-time setup that would skew the average
    _ = det.update(img)

    N = 10
    t0 = time.time()
    for _ in range(N):
        lanes = det.update(img)
    dt = (time.time() - t0) / N
    print(f"latency: {dt*1000:.1f} ms per frame ({1/dt:.1f} FPS)")
    print(f"lanes detected: {len(lanes)}")
    for ln in lanes:
        print(f"  {ln.side:12s}  conf={ln.confidence:.2f}  x_at_bottom={ln.x_at_bottom:.1f}  pts={len(ln.points)}")
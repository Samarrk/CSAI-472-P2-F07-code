
"""
src/tamakkan/models/depth_model.py

This is a Wrapper around the Depth Anything V2 model. The pipeline calls this to get a depth map for each camera frame, which the tailgating detector then uses to estimate how far other cars are from us.

What this files does:
- it handles model loading and running one frame at a time
- the pipeline then decides when to skip frames and when to reuse old results
- the depth values are returned in the model's raw scale, not normalized per frame. this matters because the tailgating detector compares depth across consecutive frames, and if we normalized each frame on its own, the same car at the same distance would get different values every time depending on what else was in the scene.

There are two model file formats we can use. The .pth file is the regular PyTorch, used when working on the desktop. The .engine file is a TensorRT compiled version that runs faster on the Jetson. The class picks which one to load by looking at the file extension.

"""

#imports
from __future__ import annotations

import numpy as _np
if not hasattr(_np, "bool"):
    _np.bool = bool
if not hasattr(_np, "long"):
    _np.long = int

from pathlib import Path

import cv2
import torch
import numpy as np

from depth_anything_v2.dpt import DepthAnythingV2


# same size as it was trained on
INPUT_SIZE = 518

# The model was trained on images that had been normalized using these mean and standard deviation values, which come from the ImageNet
_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 3, 1, 1)
_IMAGENET_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 3, 1, 1)


class _TRTDepthBackend:
    """ The TensorRT version of the backend. Used on the Jetson. """

    def __init__(self, engine_path: str):
        # only import tensorrt and pycuda when we actually need them. on the desktop these libraries are not installed and we use the PyTorch backend instead, so importing them at the top of the file would create an error.
        import tensorrt as trt
        import pycuda.driver as cuda
        cuda.init()

        # a CUDA context is the GPU equivalent of a process. We use the primary context
        self._trt = trt
        self._cuda = cuda
        device = cuda.Device(0)
        self._cuda_ctx = device.retain_primary_context()
        # push it so the rest of __init__ can use the GPU
        self._cuda_ctx.push()

        # load the compiled engine from disk
        logger = trt.Logger(trt.Logger.WARNING)
        runtime = trt.Runtime(logger)
        with open(engine_path, "rb") as f:
            self.engine = runtime.deserialize_cuda_engine(f.read())
        if self.engine is None:
            raise RuntimeError(f"could not load engine: {engine_path}")

        self.context = self.engine.create_execution_context()

        # find the input and output slots by name, fall back to positions if the names changed
        self.input_idx  = self.engine.get_binding_index("input")
        self.output_idx = self.engine.get_binding_index("depth")
        if self.input_idx < 0 or self.output_idx < 0:
            self.input_idx  = 0
            self.output_idx = 1

        self.input_shape  = tuple(self.engine.get_binding_shape(self.input_idx))
        self.output_shape = tuple(self.engine.get_binding_shape(self.output_idx))

        # allocate all the buffers once up front so we don't pay for allocation every frame
        input_vol  = int(np.prod(self.input_shape))
        output_vol = int(np.prod(self.output_shape))

        # pinned memory on the CPU side, makes CPU to GPU transfers faster
        self.h_input  = cuda.pagelocked_empty(input_vol,  dtype=np.float32)
        self.h_output = cuda.pagelocked_empty(output_vol, dtype=np.float32)
        # matching buffers on the GPU side
        self.d_input  = cuda.mem_alloc(self.h_input.nbytes)
        self.d_output = cuda.mem_alloc(self.h_output.nbytes)
        self.bindings = [int(self.d_input), int(self.d_output)]

        # our own queue for GPU work so we don't block the default one
        self.stream = cuda.Stream()

        # pop the context, infer() will push and pop it again per call
        self._cuda_ctx.pop()

    def infer(self, chw_float32: np.ndarray) -> np.ndarray:
        """ Run the model on one preprocessed frame. Safe to call from any thread. """
        self._cuda_ctx.push()
        try:
            return self._infer_inner(chw_float32)
        finally:
            self._cuda_ctx.pop()

    def _infer_inner(self, chw_float32: np.ndarray) -> np.ndarray:
        # copy the frame onto the GPU
        np.copyto(self.h_input, chw_float32.ravel())
        self._cuda.memcpy_htod_async(self.d_input, self.h_input, self.stream)

        # run the model
        self.context.execute_async_v2(
            bindings=self.bindings,
            stream_handle=self.stream.handle,
        )

        # copy the result back and wait for everything to finish before we read it
        self._cuda.memcpy_dtoh_async(self.h_output, self.d_output, self.stream)
        self.stream.synchronize()

        # reshape from flat array back to the depth map shape, drop the batch dim
        return self.h_output.reshape(self.output_shape).squeeze()


class _PyTorchDepthBackend:
    """ The plain PyTorch version of the backend. Used on the desktop. """

    # the three model sizes from the DAv2 paper. we only use vits because it is the only one fast enough for real-time on the Jetson
    MODEL_CONFIGS = {
        "vits": {"encoder": "vits", "features": 64,
                 "out_channels": [48, 96, 192, 384]},
        "vitb": {"encoder": "vitb", "features": 128,
                 "out_channels": [96, 192, 384, 768]},
        "vitl": {"encoder": "vitl", "features": 256,
                 "out_channels": [256, 512, 1024, 1024]},
    }

    def __init__(self, weights_path: str, variant: str, device: str):
        self.device = torch.device(device)
        self.model = DepthAnythingV2(**self.MODEL_CONFIGS[variant]).to(self.device)

        # map_location makes sure the weights end up on the right device even if they were saved from a different one
        state_dict = torch.load(weights_path, map_location=self.device)
        self.model.load_state_dict(state_dict)
        self.model.eval()

        # on GPU we run in float16 to save memory and run faster, on CPU we stay in float32 because CPUs don't benefit from float16
        if self.device.type == "cuda":
            self.model = self.model.half()
            self._dtype = torch.float16
        else:
            self._dtype = torch.float32

        # the normalization constants need to be on the same device and dtype as the model
        self._mean = torch.from_numpy(_IMAGENET_MEAN).to(self.device, dtype=self._dtype)
        self._std  = torch.from_numpy(_IMAGENET_STD).to(self.device,  dtype=self._dtype)

    @torch.no_grad()
    def infer(self, chw_float32: np.ndarray) -> np.ndarray:
        # move the preprocessed frame to GPU, run the model, then bring the result back as a numpy array
        tensor = torch.from_numpy(chw_float32).to(self.device, dtype=self._dtype)
        depth = self.model(tensor)
        return depth.squeeze().float().cpu().numpy()


class DepthEstimator:
    """
    The public depth estimation class. The pipeline talks to this, not to the backends directly. Pass in a frame, get a depth map back. The .pth vs .engine choice is hidden from the caller.
    """

    MODEL_CONFIGS = _PyTorchDepthBackend.MODEL_CONFIGS

    def __init__(
        self,
        weights_path: str,
        variant: str = "vits",
        device=None,
        input_size: int = INPUT_SIZE,
    ):
        # validate arguments here so a bad value fails with a clear message instead of crashing somewhere deeper
        if variant not in self.MODEL_CONFIGS:
            raise ValueError(
                f"variant must be one of {list(self.MODEL_CONFIGS)}, got {variant!r}"
            )
        if input_size % 14 != 0:
            raise ValueError(
                f"input_size must be a multiple of 14, got {input_size}"
            )

        if not Path(weights_path).exists():
            raise FileNotFoundError(f"weights file not found: {weights_path}")

        # default to GPU when available
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"

        self.device     = torch.device(device) if isinstance(device, str) else device
        self.input_size = input_size
        self.variant    = variant
        self.weights_path = weights_path
        self.is_engine  = Path(weights_path).suffix.lower() == ".engine"

        # pick the backend from the file extension
        if self.is_engine:
            self.backend = _TRTDepthBackend(weights_path)
            self._dtype  = torch.float32
        else:
            self.backend = _PyTorchDepthBackend(weights_path, variant, str(self.device))
            self._dtype  = self.backend._dtype

    def predict(self, frame: np.ndarray) -> np.ndarray:
        """
        Run one depth pass on a camera frame.
        Input is a BGR uint8 array of shape (H, W, 3), which is OpenCV's default.
        Output is a float32 depth map at the same (H, W). Higher value means closer to the camera.
        Values are in the model's raw scale, not meters and not normalized per frame, because the tailgating detector needs the scale to stay stable across frames.
        """
        if frame is None or frame.size == 0:
            raise ValueError("predict() got an empty frame")

        h_orig, w_orig = frame.shape[:2]

        # BGR to RGB because the model was trained on RGB
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        # resize to the fixed model input size
        resized = cv2.resize(rgb, (self.input_size, self.input_size))

        # rearrange to (1, 3, H, W) which is what the model expects, then scale to 0-1 and apply ImageNet normalization
        chw = resized.astype(np.float32).transpose(2, 0, 1)[None, ...]
        chw /= 255.0
        chw = (chw - _IMAGENET_MEAN) / _IMAGENET_STD

        # run the model, returns depth at model resolution
        depth = self.backend.infer(chw)

        # resize back to the original frame size so the depth map lines up with the camera frame
        depth = cv2.resize(depth, (w_orig, h_orig))
        return depth.astype(np.float32)

    @staticmethod
    def colorize(depth: np.ndarray) -> np.ndarray:
        # turn the raw depth map into a viewable color image, only used for debugging
        # shift to 0, scale to 255, the tiny epsilon avoids divide by zero on a flat depth map
        d = depth - depth.min()
        d = d / (d.max() + 1e-8) * 255.0
        # INFERNO maps close objects to bright colors and far ones to dark, easy to read at a glance
        return cv2.applyColorMap(d.astype(np.uint8), cv2.COLORMAP_INFERNO)


# standalone smoke test, run this file directly to check the model loads and gives sensible output on one image. not part of the pipeline.
if __name__ == "__main__":
    import sys
    import time

    if len(sys.argv) < 2:
        print("usage: python depth_model.py <image_path> [weights_path]")
        sys.exit(1)

    img = cv2.imread(sys.argv[1])
    if img is None:
        print(f"could not read image: {sys.argv[1]}")
        sys.exit(1)

    weights = sys.argv[2] if len(sys.argv) >= 3 else "weights/depth_anything_v2_vits.pth"
    print(f"loading {weights}")
    est = DepthEstimator(weights_path=weights, variant="vits")
    print(f"  device={est.device}  is_engine={est.is_engine}")

    # run once before timing because the first call does one-time setup that would skew the average
    _ = est.predict(img)

    N = 10
    t0 = time.time()
    for _ in range(N):
        depth = est.predict(img)
    dt = (time.time() - t0) / N
    print(f"latency: {dt*1000:.1f} ms per frame ({1/dt:.1f} FPS)")
    print(f"depth range: [{depth.min():.3f}, {depth.max():.3f}]  shape: {depth.shape}")

    out = "depth_test.jpg"
    cv2.imwrite(out, DepthEstimator.colorize(depth))
    print(f"wrote colorized depth to {out}")

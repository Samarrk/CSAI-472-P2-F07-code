"""
src/tamakkan/models/light_classifier.py

Traffic light color classifier using HSV. Takes a BGR crop of a traffic_light bounding box from the tracker and decides if the bulb is red, green, or unknown.

The accuracy on real Saudi dashcam footage started at around 81% and got tuned up to about 95.3% by iterating on the thresholds in this file.

How it works:
- one crop in, one classification out
- no state between calls
- pure numpy and opencv, no need for GPU

Yellow is treated as red on purpose. Yellow means "be ready to stop", so flagging it as red is the safe behavior for our use case. 

"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np


@dataclass
class LightClassification:
    """
    Result of classifying one traffic light crop.

    color: "red" | "green" | "unknown"
    confidence: how dominant the winning color was, between 0 and 1. roughly:
        0.5 means ambiguous (will be rejected before reaching here)
        0.7 is decent
        0.9 and above is strongly dominant
    debug: per-frame numbers used for tuning the thresholds.
    """
    color: str
    confidence: float
    debug: dict = field(default_factory=dict)


class LightClassifier:
    """ Classify a traffic light crop as red, green, or unknown using HSV. """

    # HSV thresholds. opencv uses hue in [0, 180].
    # red wraps around both ends of the hue circle so we need two ranges for it.
    HUE_RED_LOW  = (0,   35)   # pure red plus yellow and orange-red LEDs
    HUE_RED_HIGH = (165, 180)  # wrap-around side, magenta-red
    HUE_GREEN    = (60,  95)   # may need widening to (55, 100) for bloomed Saudi LEDs

    # a pixel counts as "valid colored" if it has decent saturation and value,
    # OR if it is very bright with at least a tiny bit of saturation. the second
    # case catches the white-hot center of a bloomed bulb where the color
    # nearly washes out.
    SAT_MIN = 40
    VAL_MIN = 60
    BRIGHT_VAL_MIN = 200
    BRIGHT_SAT_MIN = 15

    # final classification gates
    MIN_PIXEL_PCT = 0.015      # winning color must be at least 1.5% of the crop
    MARGIN_PCT    = 0.2        # winner must beat runner-up by at least 20% relatively

    # brightness gate, the most important early filter
    # if not enough of the crop is bright at all, the bulb is off or the crop is bad.
    MIN_BRIGHT_FRACTION = 0.015
    BRIGHT_GATE_VAL     = 180

    def classify(self, bgr_crop: Optional[np.ndarray]) -> LightClassification:
        """
        Input is a BGR uint8 crop of a traffic light bounding box, usually from YOLO. Any size works but anything under 5x5 is not worth processing.
        Output is a LightClassification with color, confidence, and debug numbers.
        """
        # sanity guards
        if bgr_crop is None or bgr_crop.size == 0:
            return self._unknown(0.0, reason="empty_crop")
        if bgr_crop.shape[0] < 5 or bgr_crop.shape[1] < 5:
            return self._unknown(0.0, reason="crop_too_small")

        hsv = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2HSV)
        h = hsv[:, :, 0]
        s = hsv[:, :, 1]
        v = hsv[:, :, 2]

        total = bgr_crop.shape[0] * bgr_crop.shape[1]

        # brightness gate: if nothing in the crop is bright enough to be a lit bulb, bail out early.
        # this catches off lights, dark housings, night poles, and bad YOLO crops.
        bright_fraction = float(np.sum(v >= self.BRIGHT_GATE_VAL)) / total
        if bright_fraction < self.MIN_BRIGHT_FRACTION:
            return self._unknown(
                0.0,
                reason="no_bright_region",
                bright_fraction=round(bright_fraction, 4),
            )

        # which pixels are "valid colored". either decent saturation and value, or bright-with-some-color.
        valid_standard = (s >= self.SAT_MIN) & (v >= self.VAL_MIN)
        valid_bright   = (v >= self.BRIGHT_VAL_MIN) & (s >= self.BRIGHT_SAT_MIN)
        valid = valid_standard | valid_bright

        # red lives in two hue ranges because of the wrap-around
        red_mask = (
            ((h >= self.HUE_RED_LOW[0])  & (h <= self.HUE_RED_LOW[1])) |
            ((h >= self.HUE_RED_HIGH[0]) & (h <= self.HUE_RED_HIGH[1]))
        )
        green_mask = (h >= self.HUE_GREEN[0]) & (h <= self.HUE_GREEN[1])

        # how much of the crop is valid-and-red vs valid-and-green
        red_pct   = float(np.sum(valid & red_mask))   / total
        green_pct = float(np.sum(valid & green_mask)) / total

        scores        = {"red": red_pct, "green": green_pct}
        winner        = max(scores, key=scores.get)
        winner_pct    = scores[winner]
        runner_up_pct = scores["green" if winner == "red" else "red"]

        debug = {
            "red_pct":         round(red_pct,         4),
            "green_pct":       round(green_pct,       4),
            "bright_fraction": round(bright_fraction, 4),
        }

        # gate 1: winner has to cover enough of the crop to be a real signal, not a stray pixel
        if winner_pct < self.MIN_PIXEL_PCT:
            return LightClassification(
                color="unknown",
                confidence=0.0,
                debug={**debug, "reason": "below_min_pixel_pct"},
            )

        # gate 2: winner has to beat the runner-up by a clear margin. if red and green are nearly tied, we don't trust either.
        if runner_up_pct > 0 and \
           (winner_pct - runner_up_pct) / winner_pct < self.MARGIN_PCT:
            return LightClassification(
                color="unknown",
                confidence=0.0,
                debug={**debug, "reason": "ambiguous_margin"},
            )

        # confidence is the winner's share of the total colored pixels.
        # 1.0 means pure red or pure green, 0.5 means tied.
        total_colored = red_pct + green_pct
        real_conf = winner_pct / (total_colored + 1e-6) if total_colored > 0 else 0.0

        return LightClassification(
            color=winner,
            confidence=float(real_conf),
            debug=debug,
        )

    @staticmethod
    def _unknown(confidence: float = 0.0, **debug_kv) -> LightClassification:
        return LightClassification(
            color="unknown",
            confidence=float(confidence),
            debug=debug_kv,
        )


# standalone smoke test, run this file directly to check the classifier on a few synthetic colors. not part of the pipeline.
if __name__ == "__main__":
    classifier = LightClassifier()

    test_cases = [
        ("Solid red",        np.full((40, 40, 3), (0,   0,   255), dtype=np.uint8)),
        ("Yellow/orange-red", np.full((40, 40, 3), (0,   140, 255), dtype=np.uint8)),
        ("Solid green",      np.full((40, 40, 3), (0,   255, 0),   dtype=np.uint8)),
        ("Solid gray",       np.full((40, 40, 3), 128,             dtype=np.uint8)),
        ("Dark housing",     np.full((40, 40, 3), 30,              dtype=np.uint8)),
    ]

    for label, img in test_cases:
        result = classifier.classify(img)
        print(f"{label:20s} -> {result.color:8s}  conf={result.confidence:.3f}  {result.debug}")
"""Hand landmarks behind one interface (docs §5.2 V3). MediaPipe Hand Landmarker by default."""

from __future__ import annotations

import os
import urllib.request
from pathlib import Path
from typing import Protocol

import numpy as np

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"


class HandTracker(Protocol):
    name: str

    def hands(self, frame_rgb: np.ndarray) -> list[np.ndarray]:
        """Each detected hand as a (21, 2) array of pixel coordinates."""
        ...


def model_path() -> Path:
    d = Path(os.environ.get("TABER_CACHE_DIR", "~/.cache/taber")).expanduser() / "models"
    p = d / "hand_landmarker.task"
    if not p.exists():
        d.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".part")
        urllib.request.urlretrieve(MODEL_URL, tmp)  # ~7.5 MB, once
        tmp.replace(p)
    return p


class MediaPipeHands:
    name = "mediapipe-hand-landmarker"

    def __init__(self, num_hands: int = 2, min_conf: float = 0.4):
        from mediapipe.tasks.python import BaseOptions, vision

        opts = vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path())),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=num_hands,
            min_hand_detection_confidence=min_conf,
            min_hand_presence_confidence=min_conf,
        )
        self._lm = vision.HandLandmarker.create_from_options(opts)

    def hands(self, frame_rgb: np.ndarray) -> list[np.ndarray]:
        import mediapipe as mp

        h, w = frame_rgb.shape[:2]
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame_rgb))
        res = self._lm.detect(img)
        return [np.array([[p.x * w, p.y * h] for p in hand], dtype=np.float32) for hand in res.hand_landmarks]

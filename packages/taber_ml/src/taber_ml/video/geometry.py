"""Fretboard geometry: image <-> fretboard coordinates and fingertip evidence (docs §5.2 V2/V4/V6).

Fretboard coordinates (u, v):
  u = distance from the nut as a fraction of the scale length; fret wire n sits at u = 1 - 2^(-n/12)
  v = across the strings: 0 on string 6 (low E), 1 on string 1 (high e)

The user calibrates once by clicking the two outer strings at two fret wires A < B; a homography maps
image pixels to (u, v). Scoring fingertips against candidate positions lives in taber_ir.fusion.video
(it runs at assembly time, with whatever tuning and capo the user picks).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from taber_ir.fusion.video import fret_u

FINGER_TIPS = (8, 12, 16, 20)  # index, middle, ring, little (MediaPipe landmark ids); the thumb frets nothing
FINGER_OF_TIP = {8: 1, 12: 2, 16: 3, 20: 4}


def calibration_homography(points_px: np.ndarray, fret_a: int, fret_b: int) -> np.ndarray:
    """3x3 homography image(px) -> (u, v) from the 4 clicked corners.

    points order: (fret A, string 6), (fret A, string 1), (fret B, string 1), (fret B, string 6).
    """
    import cv2

    if not (0 <= fret_a < fret_b <= 24):
        raise ValueError("need 0 <= fret A < fret B <= 24")
    ua, ub = fret_u(fret_a), fret_u(fret_b)
    dst = np.float32([[ua, 0.0], [ua, 1.0], [ub, 1.0], [ub, 0.0]])
    src = np.float32(points_px).reshape(4, 2)
    return cv2.getPerspectiveTransform(src, dst)


def to_board(H: np.ndarray, pts_px: np.ndarray) -> np.ndarray:
    """Apply homography to (n, 2) pixel points -> (n, 2) (u, v)."""
    p = np.hstack([np.asarray(pts_px, float).reshape(-1, 2), np.ones((len(pts_px), 1))])
    q = p @ H.T
    return q[:, :2] / q[:, 2:3]


@dataclass
class Fingertip:
    u: float
    v: float
    finger: int  # 1..4


def fingertips_on_board(H: np.ndarray, landmarks_px: np.ndarray) -> list[Fingertip]:
    """Fingertips of one hand (21x2 pixel landmarks) that land on (or just around) the fretboard."""
    tips = to_board(H, landmarks_px[list(FINGER_TIPS)])
    out = []
    for (u, v), lm in zip(tips, FINGER_TIPS):
        if -0.35 <= v <= 1.35 and 0.0 < u < 0.8:
            out.append(Fingertip(float(u), float(v), FINGER_OF_TIP[lm]))
    return out

"""Fretboard geometry: image <-> fretboard coordinates and fingertip evidence (docs §5.2 V2/V4/V6).

Fretboard coordinates (u, v):
  u = distance from the nut as a fraction of the scale length; fret wire n sits at u = 1 - 2^(-n/12)
  v = across the strings: 0 on string 6 (low E), 1 on string 1 (high e)

The user calibrates once by clicking the two outer strings on 2 to 5 fret wires. The neck is a plane,
so a homography maps image pixels to the *physical* neck plane, where the strings spread out from the
nut to the bridge (the taper of the guitar body type):
    x = u,   y = (v - 1/2) * (1 + taper * u)          (lengths as fractions of the scale)
and (u, v) follow from (x, y). With more than two wires the homography is a least-squares fit.
Scoring fingertips against candidate positions lives in taber_ir.fusion.video (it runs at assembly time,
with whatever tuning and capo the user picks).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from taber_ir.fusion.video import fret_u

FINGER_TIPS = (8, 12, 16, 20)  # index, middle, ring, little (MediaPipe landmark ids); the thumb frets nothing
FINGER_OF_TIP = {8: 1, 12: 2, 16: 3, 20: 4}

# How fast the outer strings spread along the neck: spread(u) = spread_nut * (1 + taper * u), from the
# E-to-e distance at the nut and at the saddle of typical guitars (scale ~648 mm):
#   electric  35.0 -> 52.5 mm,  acoustic (steel)  36.5 -> 54.0 mm,  classical (nylon)  43.0 -> 58.0 mm.
# Mirrored in apps/web/src/lib/homography.ts (TAPER).
TAPER = {"parallel": 0.0, "electric": 0.5, "acoustic": 0.48, "classical": 0.35}


def board_to_phys(uv: np.ndarray, taper: float) -> np.ndarray:
    uv = np.asarray(uv, float).reshape(-1, 2)
    return np.stack([uv[:, 0], (uv[:, 1] - 0.5) * (1 + taper * uv[:, 0])], axis=1)


def phys_to_board(xy: np.ndarray, taper: float) -> np.ndarray:
    xy = np.asarray(xy, float).reshape(-1, 2)
    return np.stack([xy[:, 0], xy[:, 1] / (1 + taper * xy[:, 0]) + 0.5], axis=1)


def calibration_board_points(frets: Sequence[int]) -> np.ndarray:
    """(u, v) of the clicked points, in click order: snaking over the wires (A6 A1 B1 B6 C6 C1 ...)."""
    out = []
    for i, f in enumerate(frets):
        vs = (0.0, 1.0) if i % 2 == 0 else (1.0, 0.0)
        out += [(fret_u(f), v) for v in vs]
    return np.array(out)


def calibration_homography(points_px: np.ndarray, frets: Sequence[int], taper: float = 0.0) -> np.ndarray:
    """3x3 homography image(px) -> physical neck plane, from both outer strings clicked on each wire.

    Exact for two wires (4 points), least squares for more.
    """
    import cv2

    frets = list(frets)
    if len(frets) < 2 or any(b <= a for a, b in zip(frets, frets[1:])) or frets[0] < 0 or frets[-1] > 24:
        raise ValueError("need at least two fret wires, going up, between 0 and 24")
    src = np.float64(points_px).reshape(-1, 2)
    if len(src) != 2 * len(frets):
        raise ValueError("need both outer strings on every fret wire")
    phys = board_to_phys(calibration_board_points(frets), taper)
    if len(src) == 4:
        return cv2.getPerspectiveTransform(src.astype(np.float32), phys.astype(np.float32)).astype(np.float64)
    # Fit physical -> image, then invert: the error is in the clicks, so it is the reprojection error in the
    # image that must be small. (Fitting image -> physical weighs the clicks wrongly and is no better than
    # two wires.) Plain least squares: every click counts.
    to_img, _ = cv2.findHomography(phys, src, 0)
    if to_img is None or abs(np.linalg.det(to_img)) < 1e-12:
        raise ValueError("these points do not describe a fretboard")
    return np.linalg.inv(to_img)


def to_phys(H: np.ndarray, pts_px: np.ndarray) -> np.ndarray:
    """Apply homography to (n, 2) pixel points -> (n, 2) physical neck coordinates."""
    p = np.hstack([np.asarray(pts_px, float).reshape(-1, 2), np.ones((len(pts_px), 1))])
    q = p @ H.T
    return q[:, :2] / q[:, 2:3]


def to_board(H: np.ndarray, pts_px: np.ndarray, taper: float = 0.0) -> np.ndarray:
    """(n, 2) pixel points -> (n, 2) (u, v) board coordinates."""
    return phys_to_board(to_phys(H, pts_px), taper)


def board_to_image(H: np.ndarray, uv: np.ndarray, taper: float = 0.0) -> np.ndarray:
    """(n, 2) (u, v) -> (n, 2) pixels, the inverse of ``to_board``."""
    return to_phys(np.linalg.inv(H), board_to_phys(uv, taper))


@dataclass
class Fingertip:
    u: float
    v: float
    finger: int  # 1..4
    x: float = 0.0  # where it is in the image (px), for the tracking overlay
    y: float = 0.0


def fingertips_on_board(H: np.ndarray, landmarks_px: np.ndarray, taper: float = 0.0) -> list[Fingertip]:
    """Fingertips of one hand (21x2 pixel landmarks) that land on (or just around) the fretboard."""
    px = landmarks_px[list(FINGER_TIPS)]
    tips = to_board(H, px, taper)
    out = []
    for (u, v), (x, y), lm in zip(tips, px, FINGER_TIPS):
        if -0.35 <= v <= 1.35 and 0.0 < u < 0.8:
            out.append(Fingertip(float(u), float(v), FINGER_OF_TIP[lm], float(x), float(y)))
    return out

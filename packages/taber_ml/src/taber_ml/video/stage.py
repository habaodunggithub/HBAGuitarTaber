"""Video stage (docs §5): fingertips on the fretboard around every note onset.

Only frames near note onsets are analysed (a few per note), so a 3-minute 60 fps video costs a few hundred
hand-landmark calls, not ten thousand. The guitar may move a little: an ORB feature match of the neck region
against the calibration frame updates the homography (falls back to the calibration if tracking is lost).
"""

from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass, field

import numpy as np
from taber_ir.fusion.video import fret_u
from taber_ir.models import NoteEvent, VideoCalibration

from .geometry import TAPER, board_to_image, calibration_homography, fingertips_on_board
from .hands import HandTracker

MAX_SIDE = 960  # frames are downscaled to this before any processing
SAMPLE_OFFSETS = (0.02, 0.07)  # seconds after the onset: the fretting finger is down by then
MIN_INLIERS = 12
TRACK_FPS = 10.0  # neck-tracking samples per second kept for the editor's overlay


@dataclass
class VideoReport:
    used: bool
    frames: int
    hands_ratio: float
    notes_with_evidence: int
    tracked_ratio: float
    reason: str = ""
    # where the neck was seen over time (Analysis.video_track); popped before the report goes into quality
    track: dict | None = field(default=None, repr=False)


def _quad(pts: np.ndarray, M: np.ndarray | None, w: int, h: int) -> list[float]:
    """The calibration corners as seen in this frame (normalised x, y), M maps this frame -> calibration."""
    if M is not None:
        import cv2

        try:
            pts = cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float64), np.linalg.inv(M)).reshape(-1, 2)
        except np.linalg.LinAlgError:
            pass
    return [round(float(v), 4) for x, y in pts for v in (x / w, y / h)]


def _open(path: str):
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened() or int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) <= 0:
        raise ValueError("could not open the video")
    return cap


def _scale(frame: np.ndarray) -> np.ndarray:
    import cv2

    h, w = frame.shape[:2]
    k = min(1.0, MAX_SIDE / max(h, w))
    return cv2.resize(frame, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA) if k < 1 else frame


def read_frame_at(path: str, t: float) -> np.ndarray:
    """BGR frame (downscaled) closest to time t."""
    import cv2

    cap = _open(path)
    cap.set(cv2.CAP_PROP_POS_MSEC, max(t, 0) * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise ValueError(f"could not read a frame at {t:.2f}s")
    return _scale(frame)


class NeckTracker:
    """Homography of the current frame onto the calibration frame, from ORB matches in the neck region."""

    def __init__(self, cal_frame: np.ndarray, points_px: np.ndarray):
        import cv2

        self.orb = cv2.ORB_create(nfeatures=1500)
        h, w = cal_frame.shape[:2]
        x0, y0 = points_px.min(axis=0)
        x1, y1 = points_px.max(axis=0)
        pad_x, pad_y = (x1 - x0) * 0.25 + 20, (y1 - y0) * 0.6 + 20
        self.box = (int(max(x0 - pad_x, 0)), int(max(y0 - pad_y, 0)), int(min(x1 + pad_x, w)), int(min(y1 + pad_y, h)))
        self.mask = np.zeros((h, w), np.uint8)
        self.mask[self.box[1] : self.box[3], self.box[0] : self.box[2]] = 255
        gray = cv2.cvtColor(cal_frame, cv2.COLOR_BGR2GRAY)
        self.kp, self.des = self.orb.detectAndCompute(gray, self.mask)
        self.bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

    def to_calibration(self, frame: np.ndarray) -> np.ndarray | None:
        import cv2

        if self.des is None or len(self.kp) < MIN_INLIERS:
            return None
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        kp, des = self.orb.detectAndCompute(gray, self.mask)
        if des is None or len(kp) < MIN_INLIERS:
            return None
        matches = self.bf.match(des, self.des)
        if len(matches) < MIN_INLIERS:
            return None
        src = np.float32([kp[m.queryIdx].pt for m in matches])
        dst = np.float32([self.kp[m.trainIdx].pt for m in matches])
        M, inl = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
        if M is None or int(inl.sum()) < MIN_INLIERS:
            return None
        return M


def analyze_video(path: str, notes: list[NoteEvent], cal: VideoCalibration, tracker: HandTracker,
                  time_offset_s: float = 0.0) -> VideoReport:
    """Attach fingertip evidence to ``notes`` (NoteEvent.video_evidence). Returns what happened.

    ``time_offset_s`` = video time - audio time (0 when the audio was extracted from the video itself).
    """
    import cv2

    if not notes:
        return VideoReport(False, 0, 0.0, 0, 0.0, "no notes")
    cal_frame = read_frame_at(path, cal.t_s)
    h, w = cal_frame.shape[:2]
    pts = np.float32([[x * w, y * h] for x, y in cal.points])
    taper = TAPER[cal.guitar]
    H_cal = calibration_homography(pts, cal.wires, taper)
    neck = NeckTracker(cal_frame, pts)
    # the overlay's reference: the fitted outer strings on the first and last clicked wires, as seen in the
    # calibration frame (with more than two wires these are not exactly the clicked points)
    ua, ub = fret_u(cal.fret_a), fret_u(cal.fret_b)
    corners = board_to_image(H_cal, np.array([[ua, 0.0], [ua, 1.0], [ub, 1.0], [ub, 0.0]]), taper)

    # which notes want which video times
    wants: list[tuple[float, int]] = sorted(
        (n.onset_s + d + time_offset_s, i) for i, n in enumerate(notes) for d in SAMPLE_OFFSETS
    )
    times = [t for t, _ in wants]
    frames_per_note: dict[int, list] = {}
    cap = _open(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    half = 0.5 / fps + 1e-3
    first = max(times[0] - 0.5, 0)
    cap.set(cv2.CAP_PROP_POS_MSEC, first * 1000)
    k, processed, with_hand, tracked = 0, 0, 0, 0
    last = times[-1] + half
    # the overlay: every frame we look at (TRACK_FPS, plus the onset frames) -> [t, tracked, quad...]
    samples: list[list[float]] = []
    tip_samples: list[list[float]] = []  # [t, x, y, finger] of the fingertips that counted, at onsets
    next_track = first
    while True:
        if not cap.grab():
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if t > last:
            break
        while k < len(times) and times[k] < t - half:
            k += 1  # frames missing (VFR / end): give up on that sample
        for_note = k < len(times) and abs(times[k] - t) <= half
        for_track = t >= next_track
        if not (for_note or for_track):
            continue
        ok, frame = cap.retrieve()
        if not ok:
            continue
        frame = _scale(frame)
        M = neck.to_calibration(frame)
        samples.append([round(t, 3), int(M is not None), *_quad(corners, M, w, h)])
        if for_track:
            next_track = t + 1.0 / TRACK_FPS - half
        if not for_note:
            continue
        processed += 1
        if M is not None:
            tracked += 1
        H = H_cal @ M if M is not None else H_cal
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        hands = tracker.hands(rgb)
        # the fretting hand is the one with the most fingertips on the fretboard
        best: list = []
        for lm in hands:
            tips = fingertips_on_board(H, lm, taper)
            if len(tips) > len(best):
                best = tips
        if best:
            with_hand += 1
        tip_samples.extend([round(t, 3), round(f.x / w, 4), round(f.y / h, 4), f.finger] for f in best)
        j = bisect_left(times, t - half)
        while j < len(times) and times[j] <= t + half:
            frames_per_note.setdefault(wants[j][1], []).append([[round(f.u, 4), round(f.v, 4), f.finger] for f in best])
            j += 1
        k = j
    cap.release()
    track = {
        "time_offset_s": time_offset_s,  # sample times are video times
        "size": [w, h],
        "fret_a": cal.fret_a,
        "fret_b": cal.fret_b,
        "taper": taper,
        "samples": samples,
        "tips": tip_samples,
    }

    n_ev = 0
    for i, n in enumerate(notes):
        fr = frames_per_note.get(i)
        if fr and any(fr):
            n.video_evidence = {"frames": fr}
            n_ev += 1
    return VideoReport(
        used=n_ev > 0,
        frames=processed,
        hands_ratio=round(with_hand / processed, 3) if processed else 0.0,
        notes_with_evidence=n_ev,
        tracked_ratio=round(tracked / processed, 3) if processed else 0.0,
        reason="" if n_ev else "no fingertips seen on the fretboard around the notes",
        track=track,
    )

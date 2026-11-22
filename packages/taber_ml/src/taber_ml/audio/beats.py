"""Stage 2: beat / downbeat / tempo (docs §4.2).

Beat This! (CPJKU, ISMIR 2024, MIT; the ``final0`` checkpoint is downloaded on first use) when
installed, librosa otherwise. Solo guitar without drums gives unreliable beats, so an unstable
result returns an empty grid and the assembly phase falls back to hint / free timing instead of
trusting garbage. Measured in ml/eval/beat_study.py.
"""

from __future__ import annotations

import numpy as np
from taber_ir.models import BeatGrid

from .ingest import Audio

HOP = 256


def _stable(beats: np.ndarray, max_cv: float = 0.10) -> bool:
    if len(beats) < 8:
        return False
    iv = np.diff(beats)
    return bool(np.std(iv) / np.mean(iv) < max_cv)


def fill_gaps(beats: np.ndarray, tol: float = 0.25) -> np.ndarray:
    """Make a beat list steady: where the tracker skipped beats (guitar resting, a held note) an
    interval of ~k periods gets k-1 evenly spaced beats; a beat closer than half a period to the
    previous kept one is dropped. Without this, the assembly reads a skipped beat as one beat twice
    as long and halves the rhythm of that passage."""
    beats = np.asarray(beats, dtype=float)
    if len(beats) < 4:
        return beats
    period = float(np.median(np.diff(beats)))
    out = [beats[0]]
    for b in beats[1:]:
        r = (b - out[-1]) / period
        if r < 0.5:
            continue
        k = int(round(r))
        if k >= 2 and abs(r - k) <= tol * k:
            out.extend(out[-1] + (b - out[-1]) * np.arange(1, k) / k)
        out.append(b)
    return np.array(out)


def _beats_per_bar(beats: np.ndarray, downbeats: np.ndarray, default: int = 4) -> int:
    """Median number of beats between consecutive downbeats (2, 3, 4 or 6), else ``default``."""
    if len(downbeats) < 3:
        return default
    counts = [int(np.sum((beats >= a - 1e-3) & (beats < b - 1e-3))) for a, b in zip(downbeats[:-1], downbeats[1:])]
    m = int(np.median(counts))
    return m if m in (2, 3, 4, 6) else default


class LibrosaBeatTracker:
    name = "librosa"

    def track(self, audio: Audio, tempo_hint: float | None = None, beats_per_bar: int = 4) -> BeatGrid:
        import librosa

        env = librosa.onset.onset_strength(y=audio.y, sr=audio.sr, hop_length=HOP)
        tempo, frames = librosa.beat.beat_track(
            onset_envelope=env, sr=audio.sr, hop_length=HOP, start_bpm=tempo_hint or 100.0,
            tightness=200, units="frames",
        )
        tempo = float(np.atleast_1d(tempo)[0])
        beats = librosa.frames_to_time(frames, sr=audio.sr, hop_length=HOP)
        if not _stable(beats):
            return BeatGrid(tempo_bpm=round(tempo, 1) if tempo else None)
        # downbeat phase: the bar position whose beats carry the most onset energy
        strength = env[np.clip(frames, 0, len(env) - 1)]
        phase = int(np.argmax([strength[k::beats_per_bar].mean() for k in range(beats_per_bar)]))
        return BeatGrid(
            beats_s=[round(float(b), 4) for b in beats],
            downbeats_s=[round(float(b), 4) for b in beats[phase::beats_per_bar]],
            time_signature=f"{beats_per_bar}/4",
            tempo_bpm=round(float(60.0 / np.median(np.diff(beats))), 1),
        )


class BeatThisTracker:
    name = "beat_this"
    max_cv = 0.20  # after fill_gaps; on GuitarSet solos: 80% of takes get a grid (beat F 0.65 on those)

    def __init__(self, device: str | None = None, checkpoint: str = "final0"):
        from beat_this.inference import Audio2Beats

        from ..device import torch_device
        from ..weights import WEIGHTS

        local = WEIGHTS["beat_this"].path  # fetched by weights.ensure(): no download inside beat_this
        if checkpoint == "final0" and local.exists():
            checkpoint = str(local)
        self.a2b = Audio2Beats(checkpoint_path=checkpoint, device=device or torch_device(), dbn=False)

    def track(self, audio: Audio, tempo_hint: float | None = None, beats_per_bar: int = 4) -> BeatGrid:
        beats, downbeats = self.a2b(np.asarray(audio.y, dtype=np.float32), audio.sr)
        beats, downbeats = fill_gaps(np.asarray(beats, dtype=float)), np.asarray(downbeats, dtype=float)
        tempo = round(float(60.0 / np.median(np.diff(beats))), 1) if len(beats) > 1 else None
        if not _stable(beats, self.max_cv):
            return BeatGrid(tempo_bpm=tempo)
        bpb = _beats_per_bar(beats, downbeats, beats_per_bar)
        return BeatGrid(
            beats_s=[round(float(b), 4) for b in beats],
            downbeats_s=[round(float(b), 4) for b in downbeats],
            time_signature=f"{bpb}/4",
            tempo_bpm=tempo,
        )


def get_beat_tracker(name: str = "auto"):
    if name == "librosa":
        return LibrosaBeatTracker()
    if name == "beat_this":
        return BeatThisTracker()
    try:
        import beat_this  # noqa: F401
        import torch  # noqa: F401

        return BeatThisTracker()
    except Exception:
        return LibrosaBeatTracker()

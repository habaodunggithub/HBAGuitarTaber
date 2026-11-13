"""Stage 2: beat / downbeat / tempo (docs §4.2).

librosa tracker as the always-available baseline; Beat This! if installed. Solo guitar
without drums gives unreliable beats, so an unstable result returns an empty grid and the
assembly phase falls back to hint / free timing instead of trusting garbage.
"""

from __future__ import annotations

import numpy as np
from taber_ir.models import BeatGrid

from .ingest import Audio

HOP = 256


def _stable(beats: np.ndarray) -> bool:
    if len(beats) < 8:
        return False
    iv = np.diff(beats)
    return bool(np.std(iv) / np.mean(iv) < 0.10)


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

    def __init__(self, device: str | None = None):
        self.device = device

    def track(self, audio: Audio, tempo_hint: float | None = None, beats_per_bar: int = 4) -> BeatGrid:
        import torch
        from beat_this.inference import Audio2Beats

        dev = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        a2b = Audio2Beats(checkpoint_path="final0", device=dev, dbn=False)
        beats, downbeats = a2b(audio.y, audio.sr)
        beats = np.asarray(beats, dtype=float)
        if not _stable(beats):
            return BeatGrid()
        return BeatGrid(
            beats_s=[round(float(b), 4) for b in beats],
            downbeats_s=[round(float(b), 4) for b in downbeats],
            time_signature="4/4",
            tempo_bpm=round(float(60.0 / np.median(np.diff(beats))), 1),
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

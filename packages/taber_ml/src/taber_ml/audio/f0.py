"""Pitch trackers behind one interface (docs §4.2 Stage 3).

All trackers return frame-wise MIDI pitch (float, NaN where unvoiced) and a 0..1 confidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

FMIN_HZ = 65.0  # below drop-C
FMAX_HZ = 1500.0  # above fret 24 on string 1


@dataclass
class F0Result:
    times: np.ndarray  # seconds
    midi: np.ndarray  # float, NaN = unvoiced
    conf: np.ndarray  # 0..1
    hop_s: float
    name: str

    def __len__(self) -> int:
        return len(self.times)


class PitchTracker(Protocol):
    name: str

    def track(self, y: np.ndarray, sr: int) -> F0Result: ...


def hz_to_midi(f: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return 69.0 + 12.0 * np.log2(f / 440.0)


class PyinTracker:
    """librosa.pyin: CPU, no extra dependency, robust on clean/mildly distorted mono lines."""

    name = "pyin"

    def __init__(self, hop_s: float = 0.006, frame_s: float = 0.046):
        self.hop_s, self.frame_s = hop_s, frame_s

    def track(self, y: np.ndarray, sr: int) -> F0Result:
        import librosa

        hop = max(int(round(self.hop_s * sr)), 1)
        frame = int(2 ** np.ceil(np.log2(self.frame_s * sr)))
        f0, voiced, prob = librosa.pyin(
            y, fmin=FMIN_HZ, fmax=FMAX_HZ, sr=sr, frame_length=frame, hop_length=hop,
            fill_na=np.nan, resolution=0.1, switch_prob=0.02, no_trough_prob=0.02,
        )
        midi = hz_to_midi(f0)
        midi[~voiced] = np.nan
        times = librosa.times_like(f0, sr=sr, hop_length=hop)
        return F0Result(times, midi, np.nan_to_num(prob), hop / sr, self.name)


class PestoTracker:
    """PESTO (pesto-pitch): fast, GPU-friendly, pitch-equivariant network.

    pesto-pitch 2.0.1 degrades on long inputs: on a 90 s synthetic solo, per-frame accuracy
    fell from 100% (first 15 s) to 54% (last 15 s), with octave errors, when the whole signal
    was passed in one call; 10 s independent chunks stay at 100%. So audio is processed in
    independent chunks with a little context on each side (no chunk boundary artefacts).
    """

    name = "pesto"
    CHUNK_S = 10.0
    CONTEXT_S = 0.3

    def __init__(self, device: str | None = None, step_ms: float = 5.0):
        self.device, self.step_ms = device, step_ms

    @staticmethod
    def _np(x) -> np.ndarray:
        return np.asarray(x.detach().cpu() if hasattr(x, "detach") else x, dtype=float)

    def track(self, y: np.ndarray, sr: int) -> F0Result:
        import pesto
        import torch

        dev = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        n = len(y)
        chunk, ctx = int(self.CHUNK_S * sr), int(self.CONTEXT_S * sr)
        times, midi, conf = [], [], []
        a = 0
        while a < n:
            b = min(a + chunk, n)
            s0, s1 = max(a - ctx, 0), min(b + ctx, n)
            x = torch.from_numpy(np.ascontiguousarray(y[s0:s1])).float().to(dev)
            ts, pitch, cf, _ = pesto.predict(x, sr, step_size=self.step_ms, convert_to_freq=False)
            t_abs = self._np(ts) / 1000.0 + s0 / sr
            keep = (t_abs >= a / sr) & (t_abs < b / sr)
            times.append(t_abs[keep])
            midi.append(self._np(pitch)[keep])
            conf.append(self._np(cf)[keep])
            a = b
        t_all, m_all, c_all = np.concatenate(times), np.concatenate(midi).copy(), np.concatenate(conf)
        m_all[(c_all < 0.3) | (m_all < 36) | (m_all > 100)] = np.nan
        return F0Result(t_all, m_all, np.clip(c_all, 0, 1), self.step_ms / 1000.0, self.name)


class CrepeTracker:
    """torchcrepe (tiny/full)."""

    name = "crepe"

    def __init__(self, device: str | None = None, model: str = "full", hop_s: float = 0.005):
        self.device, self.model, self.hop_s = device, model, hop_s

    def track(self, y: np.ndarray, sr: int) -> F0Result:
        import torch
        import torchcrepe

        dev = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
        hop = int(round(self.hop_s * sr))
        x = torch.from_numpy(y).float()[None].to(dev)
        f0, per = torchcrepe.predict(
            x, sr, hop, FMIN_HZ, FMAX_HZ, model=self.model, batch_size=512,
            device=dev, return_periodicity=True,
        )
        f0 = f0[0].cpu().numpy()
        per = per[0].cpu().numpy()
        midi = hz_to_midi(f0)
        midi[per < 0.4] = np.nan
        times = np.arange(len(f0)) * hop / sr
        return F0Result(times, midi, np.clip(per, 0, 1), hop / sr, f"crepe-{self.model}")


def get_tracker(name: str = "auto") -> PitchTracker:
    """auto: PESTO if installed (+GPU or CPU), else pyin."""
    if name in ("pyin",):
        return PyinTracker()
    if name == "pesto":
        return PestoTracker()
    if name == "crepe":
        return CrepeTracker()
    if name != "auto":
        raise ValueError(f"unknown pitch tracker: {name}")
    try:
        import pesto  # noqa: F401
        import torch  # noqa: F401

        return PestoTracker()
    except Exception:
        return PyinTracker()

"""Stage 0: load, mono, resample, normalise, sanity-check."""

from __future__ import annotations

import io
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

ANALYSIS_SR = 22050
MAX_DURATION_S = 10 * 60


class IngestError(ValueError):
    pass


@dataclass
class Audio:
    y: np.ndarray  # mono float32 in [-1, 1]
    sr: int
    duration_s: float
    clipping: bool
    rms_db: float

    @property
    def n(self) -> int:
        return len(self.y)


def _ffmpeg_decode(path: Path, sr: int) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "wav", "-"]
    try:
        res = subprocess.run(cmd, capture_output=True, check=True, timeout=300)
    except FileNotFoundError as e:
        raise IngestError("ffmpeg not found; install ffmpeg to read this file type") from e
    except subprocess.CalledProcessError as e:
        raise IngestError(f"cannot decode {path.name}: {e.stderr.decode(errors='ignore')[:200]}") from e
    y, _ = sf.read(io.BytesIO(res.stdout), dtype="float32")
    return y


def load_audio(path: str | Path, sr: int = ANALYSIS_SR, normalize: bool = True) -> Audio:
    path = Path(path)
    if not path.exists():
        raise IngestError(f"file not found: {path}")
    y: np.ndarray
    try:
        data, file_sr = sf.read(str(path), dtype="float32", always_2d=True)
        y = data.mean(axis=1)
        if file_sr != sr:
            import soxr

            y = soxr.resample(y, file_sr, sr)
    except Exception:  # mp3/m4a/mp4... -> ffmpeg
        y = _ffmpeg_decode(path, sr)
    if y.size == 0:
        raise IngestError("empty audio")
    dur = len(y) / sr
    if dur > MAX_DURATION_S:
        raise IngestError(f"audio too long ({dur:.0f}s > {MAX_DURATION_S}s)")
    clipping = bool(np.mean(np.abs(y) > 0.999) > 1e-4)
    active = y[np.abs(y) > 10 ** (-50 / 20)]
    rms = float(np.sqrt(np.mean(active**2))) if active.size else 0.0
    rms_db = 20 * np.log10(rms + 1e-9)
    if normalize and rms > 1e-6:
        peak = float(np.max(np.abs(y)))
        gain = min(10 ** (-20 / 20) / rms, 0.98 / peak)  # target -20 dBFS RMS, never clip
        y = (y * gain).astype(np.float32)
    return Audio(y=y.astype(np.float32), sr=sr, duration_s=dur, clipping=clipping, rms_db=float(rms_db))

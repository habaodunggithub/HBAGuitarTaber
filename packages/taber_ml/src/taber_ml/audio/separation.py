"""Stage 1: separate the guitar from the backing track (docs §4.2, Demucs htdemucs_6s, MIT).

htdemucs_6s splits a mix into drums, bass, other, vocals, guitar and piano. We keep the **guitar stem
only**: on 12 real GuitarSet solo takes mixed with a band (ml/eval/separation_study.py) it brought note F1
from 0.62 back to 0.85 with the band at the guitar's level, and from 0.46 to 0.83 with the band 6 dB louder;
the same held with the guitar driven through light distortion (0.64 -> 0.85, 0.48 -> 0.82). Adding the
"other" stem made things worse (the chord pad lives there).

The original audio is kept instead when
- there is (almost) no band: separation would only add artefacts;
- the guitar stem is (almost) empty: Demucs did not find a guitar, analysing silence would lose every note.

Results are cached on disk by content hash, so re-analysing the same take does not separate it again.

For listening, two stereo AAC files are kept next to the decision: the guitar stem and the backing
(every other stem summed). The worker uploads them so the editor can play the guitar alone or the band
alone (``playback_files``).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from .ingest import ANALYSIS_SR, Audio, IngestError, _ffmpeg_decode

log = logging.getLogger("taber.separation")

MODEL = "htdemucs_6s"
MODEL_SR = 44100
DECISION_VERSION = 3  # bump when choose_stem() changes: cached decisions are keyed by it
SOLO_BACKING_DB = -14.0  # backing this far below the mix => treat the take as solo, keep the original
EMPTY_GUITAR_DB = -30.0  # guitar stem this far below the mix => Demucs found no guitar
PLAYBACK_ROLES = ("guitar", "backing")  # the stems the editor can play instead of the original


@dataclass
class SeparationInfo:
    used: bool  # True if the analysis ran on the separated stem
    stem: str  # "original" | "guitar"
    reason: str
    backing_db: float  # energy of everything that is not guitar(+other), relative to the mix
    stems_db: dict[str, float]  # each stem's energy relative to the mix
    warning: str | None = None
    model: str = MODEL
    cached: bool = False


def cache_dir() -> Path:
    return Path(os.environ.get("TABER_CACHE_DIR", "~/.cache/taber")).expanduser() / "stems"


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:24]


def load_stereo(path: Path, sr: int = MODEL_SR) -> np.ndarray:
    """(2, n) float32 at ``sr``; mono files are duplicated."""
    import soundfile as sf

    try:
        data, file_sr = sf.read(str(path), dtype="float32", always_2d=True)
        y = data.T
        if file_sr != sr:
            import soxr

            y = soxr.resample(data, file_sr, sr).T
    except Exception:
        y = np.stack([_ffmpeg_decode(path, sr)])  # mono via ffmpeg
    if y.shape[0] == 1:
        y = np.repeat(y, 2, axis=0)
    return np.ascontiguousarray(y[:2], dtype=np.float32)


def _db(e: float, ref: float) -> float:
    return float(10 * np.log10(max(e, 1e-12) / max(ref, 1e-12)))


def choose_stem(stems: dict[str, np.ndarray], mix: np.ndarray) -> tuple[np.ndarray | None, SeparationInfo]:
    """Decide what to analyse. Returns (mono guitar stem, or None = keep the original audio; info)."""
    e_mix = float(np.mean(mix**2))
    energy = {k: float(np.mean(v**2)) for k, v in stems.items()}
    stems_db = {k: round(_db(e, e_mix), 1) for k, e in energy.items()}
    backing_db = round(_db(sum(e for k, e in energy.items() if k != "guitar"), e_mix), 1)
    guitar_db = stems_db.get("guitar", -120.0)
    if guitar_db < EMPTY_GUITAR_DB:
        return None, SeparationInfo(
            False, "original", "No clear guitar after separation, using the original audio", backing_db, stems_db,
            warning="The guitar could not be separated from the backing track, so notes were read from the full mix and may include other instruments.",
        )
    if backing_db < SOLO_BACKING_DB:
        return None, SeparationInfo(False, "original", "The recording is almost only guitar, using the original audio", backing_db, stems_db)
    mono = stems["guitar"].mean(axis=0).astype(np.float32)
    return mono, SeparationInfo(True, "guitar", "Guitar separated from the backing track", backing_db, stems_db)


MELODIC = ("guitar", "other", "piano")
RULES = {
    "guitar": "the guitar stem only",
    "guitar+other": "guitar + other",
    "minus_rhythm": "everything except drums, bass and vocals",
    "melodic_10db": "melodic stems (guitar/other/piano) within 10 dB of the strongest one",
}


def select_stems(stems: dict[str, np.ndarray], rule: str) -> list[str]:
    """Which stems to keep under a named rule (see RULES)."""
    if rule == "guitar":
        return ["guitar"]
    if rule == "guitar+other":
        return ["guitar", "other"]
    if rule == "minus_rhythm":
        return [k for k in stems if k not in ("drums", "bass", "vocals")]
    if rule == "melodic_10db":
        e = {k: 10 * np.log10(float(np.mean(stems[k] ** 2)) + 1e-12) for k in MELODIC if k in stems}
        top = max(e.values())
        return [k for k, v in e.items() if v >= top - 10]
    raise ValueError(f"unknown rule {rule}")


class DemucsSeparator:
    name = MODEL

    def __init__(self, device: str | None = None):
        self.device = device
        self._model = None

    def _load(self):
        if self._model is None:
            from demucs.pretrained import get_model

            from ..device import torch_device

            dev = self.device or torch_device()
            self._model = get_model(MODEL).eval().to(dev)
            self._dev = dev
        return self._model

    def stems(self, mix: np.ndarray) -> dict[str, np.ndarray]:
        """(2, n) mix at 44.1 kHz -> {source: (2, n)}."""
        import torch
        from demucs.apply import apply_model

        model = self._load()
        x = torch.from_numpy(mix)[None]
        ref = x.mean(1).std() + 1e-8  # demucs expects roughly unit-variance input
        try:
            with torch.no_grad():
                out = apply_model(model, (x / ref).to(self._dev), split=True, overlap=0.25, device=self._dev)
        except torch.cuda.OutOfMemoryError:  # small GPU and a long take: finish on the CPU
            torch.cuda.empty_cache()
            model.to("cpu")
            self._dev = "cpu"
            with torch.no_grad():
                out = apply_model(model, x / ref, split=True, overlap=0.25, device="cpu")
        out = (out[0] * ref).cpu().numpy()
        return {src: out[i] for i, src in enumerate(model.sources)}

    def release(self) -> None:
        self._model = None
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass


def stem_key(path: Path) -> str:
    """Cache key of a take's separation (content hash + model + decision version)."""
    return f"{_file_hash(path)}_{MODEL}_v{DECISION_VERSION}"


def _playback_path(key: str, role: str) -> Path:
    return cache_dir() / f"{key}.{role}.m4a"


def playback_files(key: str) -> dict[str, Path]:
    """The listening stems cached for ``key`` (role -> .m4a), empty when there are none."""
    files = {r: _playback_path(key, r) for r in PLAYBACK_ROLES}
    return files if all(p.exists() for p in files.values()) else {}


def encode_m4a(y: np.ndarray, dest: Path, sr: int = MODEL_SR) -> None:
    """(2, n) float audio -> stereo AAC in an .m4a (plays in every browser, ~1.2 MB per minute)."""
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak > 0.99:  # stems can overshoot the mix a little: avoid clipping in the encoder
        y = y * (0.99 / peak)
    tmp = dest.with_name(dest.name + ".part")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "2", "-i", "-",
         "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-f", "mp4", str(tmp)],
        input=np.ascontiguousarray(y.T, dtype=np.float32).tobytes(), capture_output=True, check=True, timeout=900,
    )
    tmp.replace(dest)


def _save_playback(key: str, stems: dict[str, np.ndarray]) -> None:
    backing = sum(v for k, v in stems.items() if k != "guitar")
    try:
        for role, y in (("guitar", stems["guitar"]), ("backing", backing)):
            encode_m4a(np.asarray(y, dtype=np.float32), _playback_path(key, role))
    except (OSError, subprocess.SubprocessError) as e:  # listening stems are a convenience, never fatal
        log.warning("could not encode the listening stems: %s", e)


def separate_file(
    path: Path, separator: DemucsSeparator, force: bool = False, key: str | None = None,
) -> tuple[Audio | None, SeparationInfo]:
    """Separate ``path``; return (Audio to analyse, or None = keep the original; info). Cached by content.

    ``force`` ("always separate") uses the guitar stem even for a solo take, but never an empty one.
    ``key`` is ``stem_key(path)`` when the caller already has it.
    """
    key = key or stem_key(path)
    d = cache_dir()
    wav, meta = d / f"{key}.npy", d / f"{key}.json"
    info = SeparationInfo(**json.loads(meta.read_text())) if meta.exists() else None
    usable = info is not None and info.stems_db.get("guitar", -120.0) >= EMPTY_GUITAR_DB
    if info is not None and (playback_files(key) or not usable):
        info.cached = True
    else:  # first time, or a cache from before the listening stems: separate (again)
        mix = load_stereo(path)
        if mix.shape[1] < MODEL_SR // 2:
            raise IngestError("audio too short for source separation")
        stems = separator.stems(mix)
        _, info = choose_stem(stems, mix)
        d.mkdir(parents=True, exist_ok=True)
        if info.stems_db.get("guitar", -120.0) >= EMPTY_GUITAR_DB:  # keep a usable stem, even if not used now
            import soxr

            np.save(wav, soxr.resample(stems["guitar"].mean(axis=0), MODEL_SR, ANALYSIS_SR).astype(np.float32))
            _save_playback(key, stems)
        meta.write_text(json.dumps(asdict(info)))
    if force and not info.used and wav.exists():
        info = SeparationInfo(**{**asdict(info), "used": True, "stem": "guitar", "reason": "Always separate (your choice)"})
    if not info.used or not wav.exists():
        return None, info
    return _as_audio(np.load(wav)), info


def _as_audio(y: np.ndarray) -> Audio:
    peak = float(np.max(np.abs(y))) or 1.0
    active = y[np.abs(y) > 10 ** (-50 / 20)]
    rms = float(np.sqrt(np.mean(active**2))) if active.size else 0.0
    if rms > 1e-6:
        y = y * min(10 ** (-20 / 20) / rms, 0.98 / peak)
    return Audio(y=y.astype(np.float32), sr=ANALYSIS_SR, duration_s=len(y) / ANALYSIS_SR, clipping=False,
                 rms_db=float(20 * np.log10(rms + 1e-9)))

"""String classifier: which string a note was played on, from its timbre (docs §6, ADR-006).

The same pitch sounds different on each string: a thicker string played higher up the neck has
stiffer, more inharmonic partials and a darker spectrum. A small CNN reads a pitch-aligned CQT patch
(the note's fundamental always sits at the same row, so only the timbre is left) for ~280 ms from
the onset, plus the pitch itself, and gives P(string) for strings 1..6. The probabilities go into
``NoteEvent.string_probs``; the Viterbi in taber_ir adds ``-w_audio * log p`` to each position, so
the hand-movement prior and the video still have their say.

Trained on GuitarSet players 00-03 (CC BY 4.0, attribution in THIRD_PARTY_LICENSES.md) by
``ml/train/string_classifier.py``, with amp-style distortion and EQ augmentation because GuitarSet is
acoustic. The analysis phase does not know the tuning (that is an assembly parameter), so no
playability mask is applied here: the Viterbi only scores playable positions, and the softmax
normaliser is the same for every candidate of a note.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SR = 22050  # what load_audio() gives
HOP = 256  # 11.6 ms
BPS = 3  # CQT bins per semitone
MIDI_MIN = 39  # lowest CQT bin: one semitone under E2
N_BINS = (124 - MIDI_MIN) * BPS  # top bin ~MIDI 123.7 = 10.3 kHz, under Nyquist
PATCH_F = 37 * BPS  # one semitone below the fundamental .. 3 octaves above
WEIGHT_DIR = Path(__file__).resolve().parent / "weights"
WEIGHTS = WEIGHT_DIR / "string_cnn.pt"  # base: trained on the laptop
WEIGHTS_LARGE = WEIGHT_DIR / "string_cnn_large.pt"  # large: trained on Kaggle (kaggle/train_strings)


@dataclass(frozen=True)
class Size:
    """What a checkpoint needs to rebuild its network and its input patches."""

    name: str
    patch_t: int  # frames of context
    pre_frames: int  # frames before the onset
    widths: tuple[int, ...]
    residual: bool
    head: int


SIZES = {
    # 58k parameters, ~280 ms from 23 ms before the onset
    "base": Size("base", 24, 2, (16, 32, 48), False, 64),
    # ~1.2M parameters, ~460 ms from 46 ms before the onset: sees the pick attack and more of the decay
    "large": Size("large", 40, 4, (32, 64, 128, 192), True, 128),
}


def cqt_db(y: np.ndarray, sr: int) -> np.ndarray:
    """Log-magnitude CQT, (frames, bins), MIDI 39 .. 123.7 at 3 bins per semitone."""
    import librosa

    if sr != SR:
        y = librosa.resample(np.asarray(y, dtype=np.float32), orig_sr=sr, target_sr=SR)
    C = np.abs(librosa.cqt(np.asarray(y, dtype=np.float32), sr=SR, hop_length=HOP, n_bins=N_BINS,
                           bins_per_octave=12 * BPS, fmin=librosa.midi_to_hz(MIDI_MIN)))
    return librosa.amplitude_to_db(C, ref=np.max(C) + 1e-9, top_db=90.0).T.astype(np.float32)


def patches(C: np.ndarray, onsets_s: list[float], pitches: list[int], size: Size = SIZES["base"]) -> np.ndarray:
    """(N, patch_t, PATCH_F) pitch-aligned patches, each scaled to its own peak (0 dB) and /40."""
    T = size.patch_t
    out = np.full((len(onsets_s), T, PATCH_F), -90.0, dtype=np.float32)
    for i, (t, p) in enumerate(zip(onsets_s, pitches)):
        f0 = int(round(t * SR / HOP)) - size.pre_frames
        b0 = (int(p) - 1 - MIDI_MIN) * BPS
        t_lo, t_hi = max(f0, 0), min(f0 + T, len(C))
        f_lo, f_hi = max(b0, 0), min(b0 + PATCH_F, C.shape[1])
        if t_hi > t_lo and f_hi > f_lo:
            out[i, t_lo - f0 : t_hi - f0, f_lo - b0 : f_hi - b0] = C[t_lo:t_hi, f_lo:f_hi]
    out -= out.max(axis=(1, 2), keepdims=True)
    return np.maximum(out, -90.0) / 40.0 + 1.0


def build_net(size: Size | str = "base"):
    import torch
    from torch import nn

    size = SIZES[size] if isinstance(size, str) else size

    class Block(nn.Module):
        def __init__(self, i, o, residual):
            super().__init__()
            self.body = nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(),
                                      nn.Conv2d(o, o, 3, padding=1), nn.BatchNorm2d(o))
            self.skip = (nn.Conv2d(i, o, 1) if i != o else nn.Identity()) if residual else None

        def forward(self, x):
            h = self.body(x)
            return torch.relu(h + self.skip(x) if self.skip is not None else h)

    class StringNet(nn.Module):
        def __init__(self):
            super().__init__()
            w = size.widths
            pools = [(2, 2), (2, 3), (2, 2)]
            layers, prev = [], 1
            for k, ch in enumerate(w):
                layers.append(Block(prev, ch, size.residual))
                if k < len(w) - 1:
                    layers.append(nn.MaxPool2d(pools[min(k, len(pools) - 1)]))
                prev = ch
            self.f = nn.Sequential(*layers)
            self.head = nn.Sequential(nn.Linear(prev * 2 + 1, size.head), nn.ReLU(), nn.Dropout(0.3), nn.Linear(size.head, 6))

        def forward(self, x, pitch):
            h = self.f(x.unsqueeze(1))
            h = torch.cat([h.mean(dim=(2, 3)), h.amax(dim=(2, 3))], dim=1)
            return self.head(torch.cat([h, ((pitch - 64.0) / 24.0).unsqueeze(1)], dim=1))

    return StringNet()


def default_weights() -> Path:
    """TABER_STRING_MODEL=base|large|<path> picks one; otherwise the large model when it is installed."""
    choice = os.environ.get("TABER_STRING_MODEL", "auto")
    if choice == "base":
        return WEIGHTS
    if choice == "large":
        return WEIGHTS_LARGE
    if choice not in ("", "auto"):
        return Path(choice)
    return WEIGHTS_LARGE if WEIGHTS_LARGE.exists() else WEIGHTS


class StringClassifier:
    """Loads a checkpoint: one network (``state_dict``) or an ensemble (``state_dicts``, probabilities averaged)."""

    def __init__(self, path: Path | None = None, device: str | None = None):
        import torch

        path = Path(path) if path else default_weights()
        from .device import torch_device

        self.device = device or torch_device()
        ck = torch.load(path, map_location="cpu", weights_only=True)
        self.size = SIZES[ck.get("size", "base")]
        states = ck.get("state_dicts") or [ck["state_dict"]]
        self.nets = []
        for st in states:
            net = build_net(self.size)
            # checkpoints from before Block existed name the layers f.<i>.<j>: same layers, renamed
            st = {re.sub(r"^f\.(\d+)\.(\d+)\.", r"f.\1.body.\2.", k): v for k, v in st.items()}
            net.load_state_dict(st)
            self.nets.append(net.to(self.device).eval())
        self.version = str(ck.get("version", "?"))
        self.name = "string_cnn" if self.size.name == "base" else f"string_cnn_{self.size.name}"
        if len(self.nets) > 1:
            self.name += f"x{len(self.nets)}"

    def predict(self, y: np.ndarray, sr: int, onsets_s: list[float], pitches: list[int], batch: int = 512) -> np.ndarray:
        """(N, 6) probabilities, string 1..6."""
        import torch

        if not len(onsets_s):
            return np.zeros((0, 6), np.float32)
        X = patches(cqt_db(y, sr), onsets_s, pitches, self.size)
        out = []
        with torch.no_grad():
            for b in range(0, len(X), batch):
                x = torch.from_numpy(X[b : b + batch]).to(self.device)
                p = torch.tensor(pitches[b : b + batch], dtype=torch.float32, device=self.device)
                out.append(torch.stack([torch.softmax(n(x, p), dim=1) for n in self.nets]).mean(0).cpu().numpy())
        return np.concatenate(out)


def available() -> bool:
    try:
        import torch  # noqa: F401
    except ImportError:
        return False
    return default_weights().exists()

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

from pathlib import Path

import numpy as np

SR = 22050  # what load_audio() gives
HOP = 256  # 11.6 ms
BPS = 3  # CQT bins per semitone
MIDI_MIN = 39  # lowest CQT bin: one semitone under E2
N_BINS = (124 - MIDI_MIN) * BPS  # top bin ~MIDI 123.7 = 10.3 kHz, under Nyquist
PATCH_F = 37 * BPS  # one semitone below the fundamental .. 3 octaves above
PATCH_T = 24  # frames: 2 before the onset .. ~255 ms after
PRE_FRAMES = 2
WEIGHTS = Path(__file__).resolve().parent / "weights" / "string_cnn.pt"


def cqt_db(y: np.ndarray, sr: int) -> np.ndarray:
    """Log-magnitude CQT, (frames, bins), MIDI 39 .. 123.7 at 3 bins per semitone."""
    import librosa

    if sr != SR:
        y = librosa.resample(np.asarray(y, dtype=np.float32), orig_sr=sr, target_sr=SR)
    C = np.abs(librosa.cqt(np.asarray(y, dtype=np.float32), sr=SR, hop_length=HOP, n_bins=N_BINS,
                           bins_per_octave=12 * BPS, fmin=librosa.midi_to_hz(MIDI_MIN)))
    return librosa.amplitude_to_db(C, ref=np.max(C) + 1e-9, top_db=90.0).T.astype(np.float32)


def patches(C: np.ndarray, onsets_s: list[float], pitches: list[int]) -> np.ndarray:
    """(N, PATCH_T, PATCH_F) pitch-aligned patches, each scaled to its own peak (0 dB) and /40."""
    out = np.full((len(onsets_s), PATCH_T, PATCH_F), -90.0, dtype=np.float32)
    for i, (t, p) in enumerate(zip(onsets_s, pitches)):
        f0 = int(round(t * SR / HOP)) - PRE_FRAMES
        b0 = (int(p) - 1 - MIDI_MIN) * BPS
        t_lo, t_hi = max(f0, 0), min(f0 + PATCH_T, len(C))
        f_lo, f_hi = max(b0, 0), min(b0 + PATCH_F, C.shape[1])
        if t_hi > t_lo and f_hi > f_lo:
            out[i, t_lo - f0 : t_hi - f0, f_lo - b0 : f_hi - b0] = C[t_lo:t_hi, f_lo:f_hi]
    out -= out.max(axis=(1, 2), keepdims=True)
    return np.maximum(out, -90.0) / 40.0 + 1.0


def build_net():
    import torch
    from torch import nn

    class StringNet(nn.Module):
        def __init__(self):
            super().__init__()

            def block(i, o):
                return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(), nn.Conv2d(o, o, 3, padding=1),
                                     nn.BatchNorm2d(o), nn.ReLU())

            self.f = nn.Sequential(block(1, 16), nn.MaxPool2d((2, 2)), block(16, 32), nn.MaxPool2d((2, 3)), block(32, 48))
            self.head = nn.Sequential(nn.Linear(48 * 2 + 1, 64), nn.ReLU(), nn.Dropout(0.3), nn.Linear(64, 6))

        def forward(self, x, pitch):
            h = self.f(x.unsqueeze(1))  # (B, 48, T', F')
            h = torch.cat([h.mean(dim=(2, 3)), h.amax(dim=(2, 3))], dim=1)
            return self.head(torch.cat([h, ((pitch - 64.0) / 24.0).unsqueeze(1)], dim=1))

    return StringNet()


class StringClassifier:
    name = "string_cnn"

    def __init__(self, path: Path = WEIGHTS, device: str | None = None):
        import torch

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        ck = torch.load(path, map_location="cpu", weights_only=True)
        self.net = build_net()
        self.net.load_state_dict(ck["state_dict"])
        self.net.to(self.device).eval()
        self.version = str(ck.get("version", "?"))

    def predict(self, y: np.ndarray, sr: int, onsets_s: list[float], pitches: list[int], batch: int = 512) -> np.ndarray:
        """(N, 6) probabilities, string 1..6."""
        import torch

        if not len(onsets_s):
            return np.zeros((0, 6), np.float32)
        X = patches(cqt_db(y, sr), onsets_s, pitches)
        out = []
        with torch.no_grad():
            for b in range(0, len(X), batch):
                x = torch.from_numpy(X[b : b + batch]).to(self.device)
                p = torch.tensor(pitches[b : b + batch], dtype=torch.float32, device=self.device)
                out.append(torch.softmax(self.net(x, p), dim=1).cpu().numpy())
        return np.concatenate(out)


def available() -> bool:
    try:
        import torch  # noqa: F401
    except ImportError:
        return False
    return WEIGHTS.exists()

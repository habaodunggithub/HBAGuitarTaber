"""Learned note-onset activations: Basic Pitch (Spotify, ICASSP 2022, Apache-2.0).

Only the ONNX model file is used (``weights/basic_pitch_nmp.onnx``, 230 kB) through onnxruntime on
the CPU: the ``basic-pitch`` package pins TensorFlow, which does not run with numpy 2. The windowing
below re-implements ``basic_pitch.inference`` (2 s windows, 30 frames of overlap), but times each
frame from its window's real sample position instead of the package's drift correction.

Output: per-frame onset and note posteriors for the 88 piano keys (MIDI 21..108) at 86 frames/s.
The segmenter reads them around the pitch PESTO tracks, so pitch stays PESTO's job and onsets
(where a note starts, including a re-picked same-pitch note) become the model's.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

SR = 22050
HOP = 256
N_SAMPLES = SR * 2 - HOP  # 43844 samples per window
OVERLAP_FRAMES = 30
WIN_HOP = N_SAMPLES - OVERLAP_FRAMES * HOP
MIDI_LO = 21
MODEL = Path(__file__).resolve().parent.parent / "weights" / "basic_pitch_nmp.onnx"


@dataclass
class Posteriors:
    times: np.ndarray  # (T,) seconds
    onset: np.ndarray  # (T, 88)
    note: np.ndarray  # (T, 88)

    def around(self, pitch: float, semitones: int = 1) -> tuple[np.ndarray, np.ndarray]:
        """Onset / note activation of the keys within ``semitones`` of ``pitch`` (max over them)."""
        k = int(round(pitch)) - MIDI_LO
        lo, hi = max(k - semitones, 0), min(k + semitones + 1, 88)
        if hi <= lo:
            z = np.zeros(len(self.times))
            return z, z
        return self.onset[:, lo:hi].max(axis=1), self.note[:, lo:hi].max(axis=1)


class BasicPitchOnsets:
    name = "basic_pitch"

    def __init__(self, threads: int = 0):
        import onnxruntime as ort

        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(MODEL), so, providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name
        names = [o.name for o in self.session.get_outputs()]
        # outputs of the exported Keras model: contour (:0), note (:1), onset (:2)
        self.out_note = next(n for n in names if n.endswith(":1"))
        self.out_onset = next(n for n in names if n.endswith(":2"))

    def run(self, y: np.ndarray, sr: int, batch: int = 8) -> Posteriors:
        import librosa

        x = librosa.resample(np.asarray(y, dtype=np.float32), orig_sr=sr, target_sr=SR) if sr != SR else np.asarray(y, np.float32)
        n_orig = len(x)
        pad = OVERLAP_FRAMES * HOP // 2
        x = np.concatenate([np.zeros(pad, np.float32), x])
        starts = list(range(0, len(x), WIN_HOP))
        wins = np.zeros((len(starts), N_SAMPLES, 1), np.float32)
        for i, s in enumerate(starts):
            seg = x[s : s + N_SAMPLES]
            wins[i, : len(seg), 0] = seg
        notes, onsets = [], []
        for b in range(0, len(wins), batch):
            note, onset = self.session.run([self.out_note, self.out_onset], {self.input: wins[b : b + batch]})
            notes.append(note)
            onsets.append(onset)
        note = np.concatenate(notes)
        onset = np.concatenate(onsets)
        half = OVERLAP_FRAMES // 2
        keep = slice(half, note.shape[1] - half)
        # frame j of window i sits at sample starts[i] + j*HOP of the padded signal (= minus pad in the original)
        t = np.concatenate([(s + np.arange(note.shape[1])[keep] * HOP - pad) / SR for s in starts])
        note = note[:, keep].reshape(-1, 88)
        onset = onset[:, keep].reshape(-1, 88)
        ok = (t >= 0) & (t < n_orig / SR)
        return Posteriors(times=t[ok], onset=onset[ok], note=note[ok])

"""Key (tonic + mode) estimation from detected notes, and the scale it implies.

Duration- and confidence-weighted pitch-class histogram correlated with 24 rotated key profiles
(Krumhansl-Kessler by default). Notes, not raw f0 frames, are used: in a solo the f0 between notes is
bends, slides and noise, and the note list is what the scale prior later acts on.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from taber_ir.models import NoteEvent

PROFILES: dict[str, tuple[list[float], list[float]]] = {
    # (major, minor), index 0 = tonic
    "krumhansl": (
        [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
        [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    ),
    "temperley": (
        [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0],
        [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0],
    ),
}
MAJOR_STEPS = (0, 2, 4, 5, 7, 9, 11)
MINOR_STEPS = (0, 2, 3, 5, 7, 8, 10)  # natural minor: same pitch set as the relative major
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


@dataclass(frozen=True)
class KeyEstimate:
    tonic: int  # pitch class 0..11
    mode: str  # "major" | "minor"
    score: float  # correlation of the best key
    margin: float  # best minus best key with a different scale (0: ambiguous)

    @property
    def name(self) -> str:
        return f"{NAMES[self.tonic]}:{self.mode}"

    @property
    def scale(self) -> frozenset[int]:
        steps = MAJOR_STEPS if self.mode == "major" else MINOR_STEPS
        return frozenset((self.tonic + s) % 12 for s in steps)


def pc_histogram(notes: list[NoteEvent]) -> np.ndarray:
    h = np.zeros(12)
    for n in notes:
        dur = float(np.clip(n.offset_s - n.onset_s, 0.05, 1.0))
        h[n.pitch_midi % 12] += dur * (0.25 + n.confidence)
    return h


def detect_key(notes: list[NoteEvent], profile: str = "temperley") -> KeyEstimate | None:
    """profile: a key profile name, or "fit" (pick the diatonic set holding the most note weight, then
    the tonic among its two relative keys with the Temperley profile)."""
    if len(notes) < 8:
        return None
    h = pc_histogram(notes)
    if h.sum() <= 0:
        return None
    maj, mnr = (np.asarray(p, float) for p in PROFILES["temperley" if profile == "fit" else profile])
    scored: list[tuple[float, int, str]] = []
    for tonic in range(12):
        for mode, prof in (("major", maj), ("minor", mnr)):
            r = float(np.corrcoef(h, np.roll(prof, tonic))[0, 1])
            if profile == "fit":
                inside = sum(h[(tonic + s) % 12] for s in (MAJOR_STEPS if mode == "major" else MINOR_STEPS))
                r = float(inside / h.sum()) + 1e-3 * r  # scale fit first, profile only breaks the tie
            scored.append((r, tonic, mode))
    scored.sort(reverse=True)
    best = KeyEstimate(scored[0][1], scored[0][2], scored[0][0], 0.0)
    other = next(s for s, t, m in scored[1:] if KeyEstimate(t, m, s, 0.0).scale != best.scale)
    return KeyEstimate(best.tonic, best.mode, best.score, best.score - other)


def observed_scale(notes: list[NoteEvent], size: int = 7) -> frozenset[int] | None:
    """The `size` most used pitch classes of the take: a 'scale' that follows modes and blue notes."""
    if len(notes) < 8:
        return None
    h = pc_histogram(notes)
    return frozenset(int(i) for i in np.argsort(h)[::-1][:size])


def parse_key(name: str) -> KeyEstimate:
    """'Eb:major' -> KeyEstimate (enharmonic spellings accepted)."""
    tonic, mode = name.split(":")
    alias = {"Db": "C#", "D#": "Eb", "Gb": "F#", "G#": "Ab", "A#": "Bb", "Cb": "B", "Fb": "E"}
    return KeyEstimate(NAMES.index(alias.get(tonic, tonic)), mode, 1.0, 1.0)

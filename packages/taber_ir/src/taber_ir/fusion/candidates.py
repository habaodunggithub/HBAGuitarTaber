"""Candidate (string, fret) positions for a pitch (docs §6.1)."""

from __future__ import annotations

from ..models import Tuning
from ..tuning import num_strings, open_pitch


def candidates(pitch: int, tuning: Tuning, max_fret: int = 22) -> list[tuple[int, int]]:
    """All (string, fret) that sound ``pitch``. ``fret`` is relative to the capo.

    f = pitch - open_pitch(string) - capo, 0 <= f <= max_fret - capo.
    Returned in string order 1..N (high to low).
    """
    out: list[tuple[int, int]] = []
    limit = max_fret - tuning.capo
    for s in range(1, num_strings(tuning) + 1):
        f = pitch - open_pitch(tuning, s) - tuning.capo
        if 0 <= f <= limit:
            out.append((s, f))
    return out

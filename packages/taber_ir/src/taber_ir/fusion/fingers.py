"""Heuristic finger assignment (1-4) from the chosen positions (docs §6.2).

Without video evidence the left-hand "position" is the fret under the index
finger. We estimate it per note from a window of neighbouring fretted notes and
set ``finger = clamp(fret - position + 1, 1, 4)``.
"""

from __future__ import annotations

from ..models import Finger

WINDOW = 3  # notes on each side
WINDOW_S = 1.0


def assign_fingers(
    frets: list[int], onsets: list[float]
) -> list[Finger]:
    out: list[Finger] = []
    n = len(frets)
    for i in range(n):
        f = frets[i]
        if f == 0:
            out.append("0")
            continue
        lo, hi = max(0, i - WINDOW), min(n, i + WINDOW + 1)
        near = [
            frets[k]
            for k in range(lo, hi)
            if frets[k] > 0 and abs(onsets[k] - onsets[i]) <= WINDOW_S
        ]
        pos = min(near) if near else f
        pos = max(pos, f - 3)  # a finger can reach at most 3 frets above the index
        finger = min(max(f - pos + 1, 1), 4)
        out.append(str(finger))  # type: ignore[arg-type]
    return out

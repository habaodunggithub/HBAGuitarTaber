"""Rhythm quantization by dynamic programming (docs §4.2 Stage 7).

Time unit = 1/24 of a beat (quarter note): a 16th is 6 units, a triplet 8th is 8,
a 32nd is 3, a triplet 16th is 4. Onsets are chosen on that grid by minimising
timing error + notation complexity; durations are then tiled into note values.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import cache

UNITS_PER_BEAT = 24
WHOLE = 4 * UNITS_PER_BEAT  # 96
WINDOW = 3  # candidate onset units around the observed position
ERR_SCALE = 1.5  # units of error that cost 1.0
BAD_GAPS = {1, 2, 5}  # not expressible as a sum of note values

# (units, duration string, dotted, tuplet)
TOKENS: list[tuple[int, str, bool, tuple[int, int] | None]] = [
    (96, "1/1", False, None),
    (72, "1/2", True, None),
    (48, "1/2", False, None),
    (36, "1/4", True, None),
    (24, "1/4", False, None),
    (18, "1/8", True, None),
    (12, "1/8", False, None),
    (9, "1/16", True, None),
    (6, "1/16", False, None),
    (3, "1/32", False, None),
    (16, "1/4", False, (3, 2)),
    (8, "1/8", False, (3, 2)),
    (4, "1/16", False, (3, 2)),
]
_ALIGN = {96: 96, 72: 24, 48: 24, 36: 12, 24: 24, 18: 6, 12: 12, 9: 3, 6: 6, 3: 3, 16: 8, 8: 8, 4: 4}
SNAP_DURS = [3, 6, 9, 12, 18, 24, 36, 48, 72, 96]
TRIPLET_DURS = [4, 8, 16, 32, 48]  # used when the note starts on a triplet position


def _complexity(u: int) -> float:
    if u % 24 == 0:
        return 0.0
    if u % 12 == 0:
        return 0.05
    if u % 6 == 0:
        return 0.12
    if u % 8 == 0:
        return 0.35
    if u % 4 == 0:
        return 0.5
    if u % 3 == 0:
        return 0.6
    return math.inf  # not representable


def _cls(u: int) -> int:
    if u % 24 == 0:
        return 0  # on the beat: neutral
    if u % 6 == 0:
        return 1  # straight
    return 2  # triplet-ish


def quantize_onsets(positions: list[float]) -> list[int]:
    """Choose strictly increasing grid units for observed positions (in beats).

    Every gap between consecutive chosen units is >= 3 and not in BAD_GAPS, so
    every duration can later be tiled exactly with note values.
    """
    n = len(positions)
    if n == 0:
        return []
    cands: list[list[int]] = []
    for p in positions:
        base = round(p * UNITS_PER_BEAT)
        cs = [u for u in range(base - WINDOW, base + WINDOW + 1) if u >= 0 and _complexity(u) < math.inf]
        if not cs:
            cs = [max(base, 0)]
        cands.append(cs)

    def emit(i: int, u: int) -> float:
        err = abs(u - positions[i] * UNITS_PER_BEAT) / ERR_SCALE
        return err * err + _complexity(u)

    cost = [[emit(0, u) for u in cands[0]]]
    back: list[list[int]] = [[-1] * len(cands[0])]
    for i in range(1, n):
        row, brow = [], []
        for u in cands[i]:
            best, arg = math.inf, -1
            for k, v in enumerate(cands[i - 1]):
                g = u - v
                if g < 3 or g in BAD_GAPS:
                    continue
                c = cost[i - 1][k]
                if _cls(u) and _cls(v) and _cls(u) != _cls(v):
                    c += 0.25  # discourage mixing straight and triplet feel
                if c < best:
                    best, arg = c, k
            row.append(best + emit(i, u) if arg >= 0 else math.inf)
            brow.append(arg)
        if all(math.isinf(c) for c in row):  # infeasible: relax by pushing past the previous note
            prev_u = cands[i - 1][min(range(len(cost[i - 1])), key=lambda k: cost[i - 1][k])]
            u = prev_u + 3
            while (u - prev_u) in BAD_GAPS or _complexity(u) == math.inf:
                u += 1
            cands[i] = [u]
            kbest = min(range(len(cost[i - 1])), key=lambda k: cost[i - 1][k])
            row, brow = [cost[i - 1][kbest] + emit(i, u) + 5.0], [kbest]
        cost.append(row)
        back.append(brow)

    j = min(range(len(cost[-1])), key=lambda k: cost[-1][k])
    out = [0] * n
    for i in range(n - 1, -1, -1):
        out[i] = cands[i][j]
        j = back[i][j]
    return out


def _snap_dur(raw_units: float, limit: int, onset_u: int = 0) -> int:
    pool = TRIPLET_DURS if _cls(onset_u) == 2 else SNAP_DURS
    best = min(pool, key=lambda d: abs(d - raw_units))
    return min(best, limit)


@dataclass
class Event:
    start: int  # unit, relative to the measure origin
    end: int
    group: int | None  # index of the note group, None = rest


def _piece_ok(length: int) -> bool:
    return length >= 3 and length not in BAD_GAPS


def _cuts_ok(a: int, b: int, measure_u: int | None) -> bool:
    """Every piece of [a, b) after cutting at bar lines can be tiled with note values."""
    if b <= a:
        return False
    if not measure_u:
        return _piece_ok(b - a)
    pts = [a] + list(range((a // measure_u + 1) * measure_u, b, measure_u)) + [b]
    return all(_piece_ok(y - x) for x, y in zip(pts, pts[1:]))


def _choose_dur(onset: int, raw: float, limit: int, measure_u: int | None, trailing: bool) -> int:
    """Pick a note length <= limit that keeps the note, and the rest after it, tileable."""
    pool = TRIPLET_DURS if _cls(onset) == 2 else SNAP_DURS
    for d in sorted((d for d in pool if d <= limit), key=lambda d: abs(d - raw)):
        if not _cuts_ok(onset, onset + d, measure_u):
            continue
        if trailing:  # last note: the rest up to the end of the bar must be tileable too
            if measure_u:
                rest = (-(onset + d)) % measure_u
                if rest and not _cuts_ok(onset + d, onset + d + rest, measure_u):
                    continue
        elif limit - d and not _cuts_ok(onset + d, onset + limit, measure_u):
            continue
        return d
    return limit


def build_events(
    onset_u: list[int], raw_dur_u: list[float], measure_u: int | None = None
) -> list[Event]:
    """Turn quantized onsets (+ observed durations) into a gap-free list of note/rest events.

    With ``measure_u`` given, every note/rest piece produced by cutting at bar lines is
    guaranteed to be expressible as a sum of note values.
    """
    n = len(onset_u)
    events: list[Event] = []
    for i in range(n):
        if i + 1 < n:
            gap = onset_u[i + 1] - onset_u[i]
            raw = raw_dur_u[i]
            if gap <= 12 or raw >= 0.65 * gap:
                dur = gap
            else:
                dur = _choose_dur(onset_u[i], raw, gap, measure_u, trailing=False)
            events.append(Event(onset_u[i], onset_u[i] + dur, i))
            if gap - dur:
                events.append(Event(onset_u[i] + dur, onset_u[i + 1], None))
        else:
            dur = _choose_dur(onset_u[i], raw_dur_u[i], WHOLE, measure_u, trailing=True)
            dur = max(dur, 4 if _cls(onset_u[i]) == 2 else 6)
            events.append(Event(onset_u[i], onset_u[i] + dur, i))
    return events


def _misalign(p: int, size: int) -> bool:
    return p % _ALIGN[size] != 0


def tile(a: int, b: int) -> list[tuple[int, str, bool, tuple[int, int] | None]] | None:
    """Tile [a, b) (units, measure-local) with note values, minimising tokens + awkwardness."""

    @cache
    def f(p: int) -> tuple[float, tuple[int, ...]] | None:
        if p == b:
            return 0.0, ()
        best: tuple[float, tuple[int, ...]] | None = None
        for k, (size, _d, dotted, tup) in enumerate(TOKENS):
            if p + size > b:
                continue
            rest = f(p + size)
            if rest is None:
                continue
            c = 1.0 + (0.3 if tup else 0.0) + (0.15 if dotted else 0.0)
            if _misalign(p, size):
                c += 1.5
            total = c + rest[0]
            if best is None or total < best[0]:
                best = (total, (k,) + rest[1])
        return best

    res = f(a)
    if res is None:
        return None
    return [TOKENS[k] for k in res[1]]

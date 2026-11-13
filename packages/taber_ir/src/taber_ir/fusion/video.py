"""Video evidence for string/fret choice (docs §6.2 emission term), computed at assembly time.

The analysis stores, per note, the fretting-hand fingertips seen around the onset in fretboard coordinates
(u = fraction of scale length from the nut, v = 0 on string 6 .. 1 on string 1). Scoring them against the
candidate positions here keeps the stored evidence valid when the user changes tuning or capo.

NoteEvent.video_evidence = {"frames": [[[u, v, finger], ...], ...]}   (one list of fingertips per sampled frame)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..models import NoteEvent


def fret_u(n: float) -> float:
    """Position of fret wire n (0 = nut) as a fraction of the scale length."""
    return 1.0 - 2.0 ** (-n / 12.0)


def u_to_fret(u: float) -> float:
    """Continuous fret-wire number at position u (inverse of fret_u)."""
    return -12.0 * math.log2(max(1.0 - u, 1e-6))


def string_v(string: int, n_strings: int = 6) -> float:
    return (n_strings - string) / (n_strings - 1)  # string 6 -> 0, string 1 -> 1


@dataclass
class EvidenceParams:
    fret_sigma: float = 0.45  # fret units
    string_sigma: float = 0.55  # string spacings
    tip_offset: float = 0.3  # a fingertip sits this far (fret units) behind the wire of the fret it presses
    open_score: float = 0.12  # likelihood for open strings (no finger needed)
    floor: float = 0.02


def _frame_scores(tips, candidates, capo, p, n_strings):
    raw, fingers = [], []
    for s, f in candidates:
        if f == 0:
            raw.append(p.open_score)
            fingers.append(None)
            continue
        target = f + capo - p.tip_offset  # frets are relative to the capo; the camera sees absolute frets
        sv = string_v(s, n_strings)
        best, who = 0.0, None
        for u, v, finger in tips:
            df = (u_to_fret(u) - target) / p.fret_sigma
            ds = (v - sv) * (n_strings - 1) / p.string_sigma
            like = math.exp(-0.5 * (df * df + ds * ds))
            if like > best:
                best, who = like, finger
        raw.append(best)
        fingers.append(who)
    return raw, fingers


def video_scores(note: NoteEvent, candidates: list[tuple[int, int]], capo: int = 0, n_strings: int = 6,
                 params: EvidenceParams | None = None) -> dict[tuple[int, int], tuple[float, float, int | None]]:
    """{(string, fret): (probability among candidates, evidence strength 0..1, finger)} or {} without evidence.

    Strength is the best fingertip likelihood over the sampled frames: ~1 when a fingertip sits right on a
    candidate, ~0 when no fingertip is near any candidate (then the video must not sway the choice).
    """
    ev = note.video_evidence or {}
    frames = ev.get("frames") or []
    if not frames or not candidates:
        return {}
    p = params or EvidenceParams()
    acc = [0.0] * len(candidates)
    strength = 0.0
    finger_votes: list[dict[int, float]] = [dict() for _ in candidates]
    for tips in frames:
        if not tips:
            continue
        raw, fingers = _frame_scores(tips, candidates, capo, p, n_strings)
        for i, r in enumerate(raw):
            acc[i] += r
            if fingers[i] is not None:
                finger_votes[i][fingers[i]] = finger_votes[i].get(fingers[i], 0.0) + r
        strength = max(strength, max((r for r, (_, f) in zip(raw, candidates) if f > 0), default=0.0))
    if strength <= 0:
        return {}
    total = sum(acc) + p.floor * len(acc)
    out = {}
    for i, c in enumerate(candidates):
        fv = finger_votes[i]
        out[c] = ((acc[i] + p.floor) / total, min(strength, 1.0), max(fv, key=fv.get) if fv else None)
    return out

"""Metrics (docs §12.4): note F1 (mir_eval), tab accuracy, rhythm accuracy."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from taber_ir.models import NoteEvent, Score


@dataclass
class NoteScores:
    precision: float
    recall: float
    f1: float
    n_ref: int
    n_est: int


def _arrays(notes: list[NoteEvent]):
    iv = np.array([[n.onset_s, max(n.offset_s, n.onset_s + 0.01)] for n in notes]).reshape(-1, 2)
    hz = np.array([440.0 * 2 ** ((n.pitch_midi - 69) / 12) for n in notes])
    return iv, hz


def note_f1(ref: list[NoteEvent], est: list[NoteEvent], onset_tol: float = 0.05) -> NoteScores:
    import mir_eval

    if not ref or not est:
        return NoteScores(0.0, 0.0, 0.0, len(ref), len(est))
    ri, rh = _arrays(ref)
    ei, eh = _arrays(est)
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ri, rh, ei, eh, onset_tolerance=onset_tol, pitch_tolerance=50.0, offset_ratio=None
    )
    return NoteScores(p, r, f, len(ref), len(est))


def match_notes(ref: list[NoteEvent], est: list[NoteEvent], onset_tol: float = 0.05) -> list[tuple[int, int]]:
    """Greedy one-to-one matching (same pitch, onset within tolerance). Returns (ref_i, est_j)."""
    used: set[int] = set()
    out: list[tuple[int, int]] = []
    for i, r in enumerate(ref):
        best, bj = onset_tol + 1e-9, -1
        for j, e in enumerate(est):
            if j in used or e.pitch_midi != r.pitch_midi:
                continue
            d = abs(e.onset_s - r.onset_s)
            if d < best:
                best, bj = d, j
        if bj >= 0:
            used.add(bj)
            out.append((i, bj))
    return out


def tab_accuracy(
    ref_notes: list[NoteEvent],
    ref_tab: list[tuple[int, int]],
    est_notes: list[NoteEvent],
    est_score: Score,
) -> dict[str, float]:
    """Fraction of pitch-matched notes whose (string, fret) equals the reference tab (TDR)."""
    est_pos: dict[str, tuple[int, int]] = {}
    for m in est_score.measures:
        for s in m.slots:
            for n in s.notes:
                if n.note_id and not n.tie_from_prev:
                    est_pos[n.note_id] = (n.string, n.fret)
    pairs = match_notes(ref_notes, est_notes)
    if not pairs:
        return {"tab_acc": 0.0, "matched": 0}
    ok = sum(1 for i, j in pairs if est_pos.get(est_notes[j].id) == ref_tab[i])
    return {"tab_acc": ok / len(pairs), "matched": len(pairs)}


def score_beat_positions(score: Score) -> dict[str, float]:
    """note_id -> position in quarter-note beats from the start of the score (first slot of a note)."""
    from taber_ir.export.common import parse_ts, slot_units

    pos: dict[str, float] = {}
    origin_units = 0
    for m in score.measures:
        n, d = parse_ts(m.time_signature)
        u = origin_units
        for s in m.slots:
            for note in s.notes:
                if note.note_id and not note.tie_from_prev:
                    pos[note.note_id] = u / 24.0
            u += slot_units(s)
        origin_units += n * 96 // d
    return pos


def rhythm_accuracy(
    ref_notes: list[NoteEvent],
    ref_start_beats: list[float],
    est_notes: list[NoteEvent],
    est_score: Score,
    tol_beats: float = 1 / 48,
) -> float:
    """Share of pitch-matched notes whose beat position is right, up to one global offset.

    The reference tab and the estimated score may place beat 0 differently (pickup, bar
    alignment), so the median offset between matched notes is removed first.
    """
    est_pos = score_beat_positions(est_score)
    pairs = [(i, j) for i, j in match_notes(ref_notes, est_notes) if est_notes[j].id in est_pos]
    if not pairs:
        return 0.0
    diffs = np.array([est_pos[est_notes[j].id] - ref_start_beats[i] for i, j in pairs])
    off = float(np.median(diffs))
    return float(np.mean(np.abs(diffs - off) <= tol_beats))

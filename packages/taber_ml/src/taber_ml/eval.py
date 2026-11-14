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
    est_pos = _est_positions(est_score)
    pairs = match_notes(ref_notes, est_notes)
    if not pairs:
        return {"tab_acc": 0.0, "matched": 0}
    ok = sum(1 for i, j in pairs if est_pos.get(est_notes[j].id) == ref_tab[i])
    return {"tab_acc": ok / len(pairs), "matched": len(pairs)}


def _est_positions(score: Score) -> dict[str, tuple[int, int]]:
    pos: dict[str, tuple[int, int]] = {}
    for m in score.measures:
        for s in m.slots:
            for n in s.notes:
                if n.note_id and not n.tie_from_prev:
                    pos[n.note_id] = (n.string, n.fret)
    return pos


def _pair_by_time(ref_t: list[float], ref_tol: list[float], est_t: list[float], ok) -> list[tuple[int, int]]:
    """One-to-one pairs (closest first) whose onsets are within the ref note's tolerance and ok(i, j)."""
    cand = sorted(
        (abs(e - r), i, j)
        for i, (r, tol) in enumerate(zip(ref_t, ref_tol))
        for j, e in enumerate(est_t)
        if abs(e - r) <= tol and ok(i, j)
    )
    used_r: set[int] = set()
    used_e: set[int] = set()
    out = []
    for _d, i, j in cand:
        if i not in used_r and j not in used_e:
            used_r.add(i)
            used_e.add(j)
            out.append((i, j))
    return out


def truth_report(truth, est_notes: list[NoteEvent], est_score: Score,
                 tol_detected: float = 0.05, tol_grid: float = 0.12) -> dict:
    """Compare a fresh analysis with a user-corrected take (taber_ir.truth.TruthNote list).

    Every reference note ends up in exactly one bucket, so the counts say where the errors are:
    ``correct`` (pitch + string + fret), ``wrong_position`` (pitch right, other string/fret),
    ``wrong_pitch`` (a note was found at that time but with another pitch; ``octave`` counts the
    12-semitone ones) and ``missed``. Estimated notes left over are ``extra``.
    """
    ref_t = [n.onset_s for n in truth]
    tol = [tol_detected if n.timing == "detected" else tol_grid for n in truth]
    est_t = [n.onset_s for n in est_notes]
    same = _pair_by_time(ref_t, tol, est_t, lambda i, j: est_notes[j].pitch_midi == truth[i].pitch_midi)
    pr, pe = {i for i, _ in same}, {j for _, j in same}
    rest_r = [i for i in range(len(truth)) if i not in pr]
    rest_e = [j for j in range(len(est_notes)) if j not in pe]
    near = _pair_by_time([ref_t[i] for i in rest_r], [tol[i] for i in rest_r], [est_t[j] for j in rest_e], lambda i, j: True)
    wrong_pitch = [(rest_r[a], rest_e[b]) for a, b in near]
    pos = _est_positions(est_score)
    correct = sum(1 for i, j in same if pos.get(est_notes[j].id) == (truth[i].string, truth[i].fret))
    n_ref, n_est, n_match = len(truth), len(est_notes), len(same)
    p = n_match / n_est if n_est else 0.0
    r = n_match / n_ref if n_ref else 0.0
    beats = score_beat_positions(est_score)
    rb = [(truth[i].beat, beats[est_notes[j].id]) for i, j in same if est_notes[j].id in beats]
    rhythm = 0.0
    if rb:
        d = np.array([e - t for t, e in rb])
        rhythm = float(np.mean(np.abs(d - np.median(d)) <= 1 / 48))
    return {
        "n_ref": n_ref, "n_est": n_est,
        "precision": p, "recall": r, "note_f1": 2 * p * r / (p + r) if p + r else 0.0,
        "tab_acc": correct / n_match if n_match else 0.0,  # TDR: string+fret right among pitch-matched notes
        "all_right": correct / n_ref if n_ref else 0.0,  # pitch, string and fret right, over every reference note
        "rhythm_acc": rhythm,
        "correct": correct, "wrong_position": n_match - correct,
        "wrong_pitch": len(wrong_pitch),
        "octave": sum(1 for i, j in wrong_pitch if abs(est_notes[j].pitch_midi - truth[i].pitch_midi) % 12 == 0),
        "missed": n_ref - n_match - len(wrong_pitch),
        "extra": n_est - n_match - len(wrong_pitch),
    }


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

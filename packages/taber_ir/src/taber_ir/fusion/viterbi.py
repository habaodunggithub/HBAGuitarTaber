"""String/fret assignment by Viterbi over the whole note sequence (docs §6.2, ADR-006).

A state is (string, fret, hand position). The hand position is the fret under the index
finger: a fretted note at fret f allows positions f-3..f (finger 4..1), an open string leaves
the hand wherever it was. Moving the hand costs per fret (fading for slow passages), so
open strings no longer act as free "teleports" between distant positions.

Chords (notes starting within 30 ms) are one group whose state is a combination of
distinct-string positions. Pinned notes (user-locked, or outside a ranged re-fingering)
have exactly one string/fret state.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field, fields

import numpy as np

from ..models import NoteEvent, Tuning
from .candidates import candidates
from .video import video_scores

SAME_STRING_TECHS = {"hammer_on", "pull_off", "slide_legato", "slide_shift"}
NEEDS_FRETTED = {"bend", "prebend", "release", "whammy"}
MAX_STATES_PER_GROUP = 600
GROUP_WINDOW_S = 0.03
MAX_CHORD_SPAN = 5
FINGER_COST = {1: 0.0, 2: 0.04, 3: 0.10, 4: 0.20}  # preference for the stronger fingers


@dataclass
class FingeringWeights:
    w_audio: float = 1.0  # -log P_audio(string)
    w_video: float = 2.0  # -strength * log P_video(string, fret): fingertips seen on the fretboard
    open_cost: float = 1.0  # open strings are rarer in electric lead playing
    low_fret: float = 0.01  # per fret below 5 (1..4): lead lines mostly live at 5-15
    high_fret: float = 0.44  # per fret above 12
    very_high_fret: float = 0.39  # per fret above 17
    move: float = 0.77  # per fret of hand movement
    string_skip: float = 0.42  # per string skipped (jump > 1)
    technique: float = 8.0  # violating a same-string technique constraint
    bend_open: float = 50.0  # bending an open string
    chord_span: float = 1.0
    finger: float = 1.24  # scales FINGER_COST
    time_scale_s: float = 1.8  # movement cost fades for slow passages

    @classmethod
    def from_dict(cls, d: dict[str, float] | None) -> FingeringWeights:
        w = cls()
        for f in fields(cls):
            if d and f.name in d:
                setattr(w, f.name, float(d[f.name]))
        return w


@dataclass
class Fingering:
    string: int
    fret: int
    position: int  # hand position (fret under the index finger)
    seen_finger: int | None = None  # the finger the video saw on this position, if confident

    @property
    def finger(self) -> int:
        if self.fret == 0:
            return 0
        if self.seen_finger:
            return self.seen_finger
        return min(max(self.fret - self.position + 1, 1), 4)


@dataclass
class _Group:
    idx: list[int]
    onset: float
    assigns: list[tuple[tuple[int, int], ...]] = field(default_factory=list)
    pos: list[int] = field(default_factory=list)
    emission: list[float] = field(default_factory=list)
    smean: np.ndarray | None = None
    posa: np.ndarray | None = None
    fretv: np.ndarray | None = None  # fret of the single note (mono) else -1


def group_notes(notes: list[NoteEvent]) -> list[list[int]]:
    """Group notes whose onsets are within GROUP_WINDOW_S of the group's first note."""
    groups: list[list[int]] = []
    for i, n in enumerate(notes):
        if groups and n.onset_s - notes[groups[-1][0]].onset_s <= GROUP_WINDOW_S:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


def _fret_prior(f: int, w: FingeringWeights) -> float:
    if f == 0:
        return w.open_cost
    c = 0.0
    if f < 5:
        c += w.low_fret * (5 - f)
    if f > 12:
        c += w.high_fret * (f - 12)
    if f > 17:
        c += w.very_high_fret * (f - 17)
    return c


def _note_emission(note: NoteEvent, s: int, f: int, w: FingeringWeights) -> float:
    c = _fret_prior(f, w)
    if note.string_probs and 1 <= s <= len(note.string_probs):
        c += -w.w_audio * math.log(max(note.string_probs[s - 1], 1e-3))
    if f == 0 and any(t.type in NEEDS_FRETTED for t in note.techniques):
        c += w.bend_open
    return c


def _nearest_playable(pitch: int, tuning: Tuning, max_fret: int) -> list[tuple[int, int]]:
    from ..tuning import num_strings, open_pitch

    best: tuple[int, int, int] | None = None
    for s in range(1, num_strings(tuning) + 1):
        base = open_pitch(tuning, s) + tuning.capo
        f = min(max(pitch - base, 0), max_fret - tuning.capo)
        err = abs(base + f - pitch)
        if best is None or err < best[0]:
            best = (err, s, f)
    assert best is not None
    return [(best[1], best[2])]


def _positions_for(fret: int, max_pos: int) -> list[int]:
    return list(range(max(1, fret - 3), min(fret, max_pos) + 1)) or [max(1, fret)]


def _build_group(
    gi: list[int],
    notes: list[NoteEvent],
    tuning: Tuning,
    max_fret: int,
    w: FingeringWeights,
    pinned: dict[str, tuple[int, int]],
) -> _Group:
    g = _Group(idx=gi, onset=notes[gi[0]].onset_s)
    max_pos = max(max_fret - tuning.capo - 3, 5)
    cand_lists: list[list[tuple[int, int]]] = []
    for i in gi:
        n = notes[i]
        if n.id in pinned:
            cand_lists.append([pinned[n.id]])
            continue
        cl = candidates(n.pitch_midi, tuning, max_fret) or _nearest_playable(n.pitch_midi, tuning, max_fret)
        cand_lists.append(cl)

    if len(gi) == 1:
        n = notes[gi[0]]
        vid = video_scores(n, cand_lists[0], tuning.capo, len(tuning.open_pitches)) if w.w_video > 0 else {}
        for s, f in cand_lists[0]:
            base = _note_emission(n, s, f, w)
            if (s, f) in vid:
                prob, strength, _finger = vid[(s, f)]
                base += -w.w_video * strength * math.log(max(prob, 1e-3))
            plist = list(range(1, max_pos + 1)) if f == 0 else _positions_for(f, max_pos)
            for p in plist:
                fc = 0.0 if f == 0 else w.finger * FINGER_COST[min(max(f - p + 1, 1), 4)]
                g.assigns.append(((s, f),))
                g.pos.append(p)
                g.emission.append(base + fc)
    else:
        cand_lists = [sorted(cl, key=lambda sf: _fret_prior(sf[1], w))[:4] for cl in cand_lists]
        for combo in itertools.product(*cand_lists):
            strings = [sf[0] for sf in combo]
            if len(set(strings)) != len(strings):
                continue
            fretted = [sf[1] for sf in combo if sf[1] > 0]
            span = (max(fretted) - min(fretted)) if fretted else 0
            if span > MAX_CHORD_SPAN:
                continue
            cost = sum(_note_emission(notes[i], sf[0], sf[1], w) for i, sf in zip(gi, combo))
            cost += w.chord_span * span
            pos = min(max(1, (max(fretted) - 3) if fretted else 1), min(fretted) if fretted else 99)
            g.assigns.append(tuple(combo))
            g.pos.append(max(pos, 1))
            g.emission.append(cost)
        if not g.assigns:  # impossible on distinct strings: best per note, heavily penalised
            combo = tuple(cl[0] for cl in cand_lists)
            g.assigns.append(combo)
            g.pos.append(1)
            g.emission.append(1e3)
    if len(g.assigns) > MAX_STATES_PER_GROUP:
        order = sorted(range(len(g.assigns)), key=lambda k: g.emission[k])[:MAX_STATES_PER_GROUP]
        g.assigns = [g.assigns[k] for k in order]
        g.pos = [g.pos[k] for k in order]
        g.emission = [g.emission[k] for k in order]
    g.smean = np.array([sum(s for s, _ in a) / len(a) for a in g.assigns])
    g.posa = np.array(g.pos, dtype=float)
    g.fretv = np.array([a[0][1] if len(a) == 1 else -1 for a in g.assigns], dtype=float)
    return g


def _transition_matrix(prev: _Group, cur: _Group, notes: list[NoteEvent], w: FingeringWeights) -> np.ndarray:
    dt = max(cur.onset - prev.onset, 0.0)
    fade = 1.0 / (1.0 + (dt / w.time_scale_s) ** 2)
    move = w.move * fade * np.abs(cur.posa[None, :] - prev.posa[:, None])  # type: ignore[index]
    skip = w.string_skip * np.maximum(0.0, np.abs(cur.smean[None, :] - prev.smean[:, None]) - 1.0)  # type: ignore[index]
    cost = move + skip
    if len(prev.idx) == 1 and len(cur.idx) == 1:
        tech = {t.type for i in cur.idx for t in notes[i].techniques}
        if tech & SAME_STRING_TECHS:
            diff_string = np.abs(cur.smean[None, :] - prev.smean[:, None]) > 0.5  # type: ignore[index]
            cost = cost + w.technique * diff_string
        if tech & {"hammer_on", "pull_off"}:
            far = np.abs(cur.fretv[None, :] - prev.fretv[:, None]) > 5  # type: ignore[index]
            cost = cost + (w.technique / 2) * far
    return cost


def assign_fingering_ex(
    notes: list[NoteEvent],
    tuning: Tuning,
    max_fret: int = 22,
    weights: dict[str, float] | FingeringWeights | None = None,
    pinned: dict[str, tuple[int, int]] | None = None,
) -> dict[str, Fingering]:
    """Return {note_id: Fingering} minimising the total cost over the sequence.

    ``notes`` must be sorted by onset. ``pinned`` fixes some notes to a given (string, fret).
    """
    if not notes:
        return {}
    w = weights if isinstance(weights, FingeringWeights) else FingeringWeights.from_dict(weights)
    pinned = pinned or {}
    groups = [_build_group(gi, notes, tuning, max_fret, w, pinned) for gi in group_notes(notes)]

    cost = [np.array(groups[0].emission)]
    back: list[np.ndarray] = [np.full(len(groups[0].assigns), -1)]
    for t in range(1, len(groups)):
        prev, cur = groups[t - 1], groups[t]
        total = cost[t - 1][:, None] + _transition_matrix(prev, cur, notes, w)
        arg = np.argmin(total, axis=0)
        best = total[arg, np.arange(total.shape[1])]
        cost.append(best + np.array(cur.emission))
        back.append(arg)

    j = int(np.argmin(cost[-1]))
    chosen = [0] * len(groups)
    for t in range(len(groups) - 1, -1, -1):
        chosen[t] = j
        j = int(back[t][j])

    out: dict[str, Fingering] = {}
    for g, k in zip(groups, chosen):
        for i, (s, f) in zip(g.idx, g.assigns[k]):
            seen = None
            if notes[i].video_evidence and f > 0:
                vs = video_scores(notes[i], [(s, f)], tuning.capo, len(tuning.open_pitches)).get((s, f))
                if vs and vs[1] >= 0.5:
                    seen = vs[2]
            out[notes[i].id] = Fingering(s, f, g.pos[k], seen)
    return out


def assign_fingering(
    notes: list[NoteEvent],
    tuning: Tuning,
    max_fret: int = 22,
    weights: dict[str, float] | FingeringWeights | None = None,
    pinned: dict[str, tuple[int, int]] | None = None,
) -> dict[str, tuple[int, int]]:
    """Like assign_fingering_ex but returns only {note_id: (string, fret)}."""
    ex = assign_fingering_ex(notes, tuning, max_fret, weights, pinned)
    return {k: (v.string, v.fret) for k, v in ex.items()}

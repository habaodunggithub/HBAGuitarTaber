"""Assembly phase: Analysis + AssemblyParams -> Score (docs §4.3, ADR-009).

Pure and deterministic. Runs on CPU in well under a second for a normal solo, so it
backs the editor's "re-assemble" operations (capo / tuning / tempo / re-fingering).
"""

from __future__ import annotations

import math

from .fusion import assign_fingering_ex, group_notes
from .models import (
    Analysis,
    AssemblyParams,
    Measure,
    NoteEvent,
    Score,
    ScoreNote,
    Slot,
    SyncPoint,
)
from .rhythm import UNITS_PER_BEAT, build_beat_map, build_events, quantize_onsets, tile
from .rhythm.quantize import Event
from .tuning import sounding_pitch

WHOLE = 4 * UNITS_PER_BEAT
EARLY_DOWNBEAT_TOLERANCE_BEATS = 0.15


def _pins_from_previous(
    previous: Score | None,
    notes: list[NoteEvent],
    params: AssemblyParams,
    range_s: tuple[float, float] | None,
) -> tuple[dict[str, tuple[int, int]], dict[str, ScoreNote]]:
    """Fingerings that must be kept: user-locked notes, plus (for a ranged re-fingering)
    everything outside the range. Pins that no longer sound the right pitch are dropped."""
    if previous is None:
        return {}, {}
    by_id = {n.id: n for n in notes}
    prev_notes: dict[str, ScoreNote] = {}
    for m in previous.measures:
        for slot in m.slots:
            for sn in slot.notes:
                if sn.note_id and not sn.tie_from_prev:
                    prev_notes[sn.note_id] = sn
    pinned: dict[str, tuple[int, int]] = {}
    locked_info: dict[str, ScoreNote] = {}
    for nid, sn in prev_notes.items():
        ev = by_id.get(nid)
        if ev is None:
            continue
        in_range = range_s is not None and range_s[0] <= ev.onset_s <= range_s[1]
        keep = sn.locked or (range_s is not None and not in_range)
        if not keep:
            continue
        try:
            if sounding_pitch(params.tuning, sn.string, sn.fret) != ev.pitch_midi:
                continue
        except ValueError:
            continue
        pinned[nid] = (sn.string, sn.fret)
        if sn.locked:
            locked_info[nid] = sn
    return pinned, locked_info


def _score_note(
    ev: NoteEvent,
    sf: tuple[int, int],
    finger: str,
    locked_info: dict[str, ScoreNote],
) -> ScoreNote:
    prev = locked_info.get(ev.id)
    if prev is not None:  # keep the user's edits
        return ScoreNote(
            note_id=ev.id,
            pitch_midi=ev.pitch_midi,
            string=sf[0],
            fret=sf[1],
            finger=prev.finger or finger,  # type: ignore[arg-type]
            techniques=[t.model_copy() for t in prev.techniques],
            locked=True,
        )
    return ScoreNote(
        note_id=ev.id,
        pitch_midi=ev.pitch_midi,
        string=sf[0],
        fret=sf[1],
        finger=finger,  # type: ignore[arg-type]
        techniques=[t.model_copy() for t in ev.techniques],
    )


def _tile_piece(a: int, b: int):
    res = tile(a, b)
    if res is not None:
        return res
    for s in range(a + 3, b - 2):  # split into two tileable halves
        left, right = tile(a, s), tile(s, b)
        if left is not None and right is not None:
            return left + right
    raise ValueError(f"cannot tile {b - a} units")  # prevented by quantize constraints


def assemble(
    analysis: Analysis,
    params: AssemblyParams | None = None,
    previous: Score | None = None,
    range_s: tuple[float, float] | None = None,
    title: str = "Untitled",
    analysis_id: str = "",
) -> Score:
    params = params or AssemblyParams()
    notes = sorted(analysis.notes, key=lambda n: (n.onset_s, n.pitch_midi))
    score = Score(title=title, analysis_id=analysis_id, assembly_params=params)
    if not notes:
        return score

    # ── Stage 6: strings / frets / fingers ──
    pinned, locked_info = _pins_from_previous(previous, notes, params, range_s)
    ex = assign_fingering_ex(
        notes, params.tuning, params.max_fret, params.fingering_weights or None, pinned
    )
    fing = {k: (v.string, v.fret) for k, v in ex.items()}
    finger_of = {k: str(v.finger) for k, v in ex.items()}

    # ── Stage 7: rhythm ──
    beat_map, downbeat_pos, (ts_num, ts_den), _mode = build_beat_map(analysis, params)
    measure_beats = ts_num * 4 / ts_den
    measure_u = ts_num * WHOLE // ts_den

    groups = group_notes(notes)
    g_pos = [beat_map.pos(notes[g[0]].onset_s) for g in groups]
    g_raw = [
        (beat_map.pos(max(notes[i].offset_s for i in g)) - beat_map.pos(notes[g[0]].onset_s))
        * UNITS_PER_BEAT
        for g in groups
    ]
    first_measure = math.floor(
        (g_pos[0] - downbeat_pos + EARLY_DOWNBEAT_TOLERANCE_BEATS) / measure_beats
    )
    origin_beat = downbeat_pos + first_measure * measure_beats

    onset_u = quantize_onsets([p - origin_beat for p in g_pos])
    events = build_events(onset_u, g_raw, measure_u)
    total_end = events[-1].end
    n_measures = max(1, math.ceil(total_end / measure_u))

    # ── Stage 8: build measures ──
    def t_of(unit: int) -> float:
        return beat_map.time(origin_beat + unit / UNITS_PER_BEAT)

    for m in range(n_measures):
        m0, m1 = m * measure_u, (m + 1) * measure_u
        pieces: list[tuple[int, int, Event | None, bool]] = []
        for ev in events:
            if ev.end <= m0 or ev.start >= m1:
                continue
            pieces.append((max(ev.start, m0) - m0, min(ev.end, m1) - m0, ev, ev.start < m0))
        pieces.sort(key=lambda p: p[0])
        filled: list[tuple[int, int, Event | None, bool]] = []
        cursor = 0
        for a, b, ev, cont in pieces:
            if a > cursor:
                filled.append((cursor, a, None, False))
            filled.append((a, b, ev, cont))
            cursor = b
        if cursor < measure_u:
            filled.append((cursor, measure_u, None, False))

        slots: list[Slot] = []
        for a, b, ev, cont in filled:
            tokens = _tile_piece(a, b)
            pos = a
            for k, (size, dur, dotted, tup) in enumerate(tokens):
                snotes: list[ScoreNote] = []
                if ev is not None and ev.group is not None:
                    for i in groups[ev.group]:
                        sn = _score_note(notes[i], fing[notes[i].id], finger_of[notes[i].id], locked_info)
                        if k > 0 or cont:
                            sn = sn.model_copy(update={"tie_from_prev": True, "techniques": []})
                        snotes.append(sn)
                slots.append(
                    Slot(
                        duration=dur,
                        dotted=dotted,
                        tuplet=tup,
                        notes=snotes,
                        start_s=round(t_of(m0 + pos), 4),
                    )
                )
                pos += size
        t0, t1 = t_of(m0), t_of(m1)
        tempo = round(60.0 * measure_beats / (t1 - t0), 1) if t1 > t0 else 120.0
        score.measures.append(
            Measure(index=m, time_signature=f"{ts_num}/{ts_den}", tempo_bpm=tempo, slots=slots)
        )
        score.sync_points.append(SyncPoint(measure_index=m, time_s=round(t0, 4)))
    return score


def iter_score_notes(score: Score):
    """Yield (measure, slot, note) for every ScoreNote."""
    for m in score.measures:
        for s in m.slots:
            for n in s.notes:
                yield m, s, n

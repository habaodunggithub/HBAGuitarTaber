from __future__ import annotations

import pytest
from taber_ir import AssemblyParams, assemble, iter_score_notes, open_pitch, preset, sounding_pitch
from taber_ir.fusion import candidates
from taber_ir.models import STANDARD_OPEN_PITCHES, Tuning
from taber_ir.rhythm.quantize import tile
from taber_ir.testing import TabNote, analysis_from_tab, check_measures_full

STD = Tuning()


# ── string convention ──
def test_open_pitch_convention():
    assert open_pitch(STD, 1) == 64  # high E
    assert open_pitch(STD, 6) == 40  # low E
    assert [open_pitch(STD, s) for s in range(1, 7)] == STANDARD_OPEN_PITCHES
    with pytest.raises(ValueError):
        open_pitch(STD, 0)
    with pytest.raises(ValueError):
        open_pitch(STD, 7)


def test_sounding_pitch_with_capo():
    t = Tuning(capo=2)
    assert sounding_pitch(t, 1, 0) == 66


def test_presets():
    assert open_pitch(preset("drop_d"), 6) == 38
    assert open_pitch(preset("half step down"), 1) == 63


# ── candidates ──
def test_candidates_e4():
    c = candidates(64, STD, 24)
    assert c == [(1, 0), (2, 5), (3, 9), (4, 14), (5, 19), (6, 24)]
    assert candidates(64, STD, 22) == [(1, 0), (2, 5), (3, 9), (4, 14), (5, 19)]


def test_candidates_capo_and_limit():
    c = candidates(64, Tuning(capo=2), 22)
    assert (1, 0) not in c  # pitch below capo'd open string 1 (66)
    assert all(0 <= f <= 22 - 2 for _, f in c)
    assert all(sounding_pitch(Tuning(capo=2), s, f) == 64 for s, f in c)


# ── tiling ──
def test_tile_basic():
    assert [t[1] for t in tile(0, 24)] == ["1/4"]
    assert [t[1] for t in tile(0, 96)] == ["1/1"]
    toks = tile(8, 24)  # two triplet eighths
    assert toks is not None and all(t[3] == (3, 2) for t in toks) and sum(t[0] for t in toks) == 16


@pytest.mark.parametrize("length", [3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 20, 30, 45])
def test_tile_sums(length):
    toks = tile(0, length)
    assert toks is not None and sum(t[0] for t in toks) == length


def test_tile_impossible_lengths():
    for length in (1, 2, 5):
        assert tile(0, length) is None


# ── assemble: invariants ──
def test_scale_run_exact_roundtrip():
    # A minor pentatonic ascending, 8th notes @120, string/fret known
    seq = [(6, 5), (6, 8), (5, 5), (5, 7), (4, 5), (4, 7), (3, 5), (3, 7)]
    tab = [TabNote(s, f, i * 0.5, 0.5) for i, (s, f) in enumerate(seq)]
    a = analysis_from_tab(tab, bpm=120)
    score = assemble(a, AssemblyParams())
    check_measures_full(score)
    notes = [n for _, _, n in iter_score_notes(score)]
    assert len(notes) == 8
    # rhythm: all eighths
    durs = [s.duration for m in score.measures for s in m.slots if s.notes]
    assert durs == ["1/8"] * 8
    # fingering reproduces the (box) shape: pitches right, strings plausible
    for n in notes:
        assert sounding_pitch(STD, n.string, n.fret) == n.pitch_midi
    # Viterbi keeps the run in one position (frets 5-8) instead of jumping
    assert max(n.fret for n in notes) - min(n.fret for n in notes) <= 4


def test_rhythm_sixteenths_and_triplets_and_rests():
    tab = [
        TabNote(1, 5, 0.0, 0.25),
        TabNote(1, 7, 0.25, 0.25),
        TabNote(1, 8, 0.5, 0.25),
        TabNote(1, 10, 0.75, 0.25),
        # triplet eighths in beat 2
        TabNote(2, 5, 1.0, 1 / 3),
        TabNote(2, 6, 1 + 1 / 3, 1 / 3),
        TabNote(2, 7, 1 + 2 / 3, 1 / 3),
        # rest on beat 3, note on beat 4
        TabNote(3, 9, 3.0, 1.0),
    ]
    a = analysis_from_tab(tab, bpm=100, n_beats=6)
    score = assemble(a, AssemblyParams())
    check_measures_full(score)
    slots = [s for m in score.measures for s in m.slots]
    assert [s.duration for s in slots[:4]] == ["1/16"] * 4
    trip = slots[4:7]
    assert all(s.tuplet == (3, 2) and s.duration == "1/8" for s in trip)
    # rest slot exists before the last note
    assert any(not s.notes for s in slots[7:])


def test_notes_spanning_barline_are_tied():
    tab = [TabNote(2, 5, 0.0, 3.0), TabNote(2, 7, 3.0, 2.0)]  # second note crosses bar 1->2
    a = analysis_from_tab(tab, bpm=120, n_beats=10)
    score = assemble(a, AssemblyParams())
    check_measures_full(score)
    assert len(score.measures) >= 2
    first_of_m2 = score.measures[1].slots[0]
    assert first_of_m2.notes and first_of_m2.notes[0].tie_from_prev


def test_jittered_performance_still_quantizes():
    seq = [(1, 5 + (i % 4)) for i in range(16)]
    tab = [TabNote(s, f, i * 0.5, 0.5) for i, (s, f) in enumerate(seq)]
    a = analysis_from_tab(tab, bpm=110, jitter_s=0.018, seed=3)
    score = assemble(a, AssemblyParams())
    check_measures_full(score)
    durs = [s.duration for m in score.measures for s in m.slots if s.notes]
    assert durs == ["1/8"] * 16


def test_deterministic():
    tab = [TabNote(1, (i * 3) % 12, i * 0.25, 0.25) for i in range(32)]
    a = analysis_from_tab(tab, bpm=120, jitter_s=0.01)
    s1 = assemble(a, AssemblyParams()).model_dump_json()
    s2 = assemble(a, AssemblyParams()).model_dump_json()
    assert s1 == s2


# ── reassemble semantics ──
def test_capo_changes_frets_but_keeps_pitch():
    tab = [TabNote(1, 7, 0, 1), TabNote(1, 9, 1, 1), TabNote(2, 8, 2, 1)]
    a = analysis_from_tab(tab, bpm=120)
    s0 = assemble(a, AssemblyParams())
    s1 = assemble(a, AssemblyParams(tuning=Tuning(capo=2)))
    p0 = [n.pitch_midi for _, _, n in iter_score_notes(s0)]
    p1 = [n.pitch_midi for _, _, n in iter_score_notes(s1)]
    assert p0 == p1
    for _, _, n in iter_score_notes(s1):
        assert sounding_pitch(Tuning(capo=2), n.string, n.fret) == n.pitch_midi


def test_locked_note_survives_reassemble():
    tab = [TabNote(1, 5, i * 0.5, 0.5) for i in range(8)]  # E4... all on string 1
    a = analysis_from_tab(tab, bpm=120)
    s0 = assemble(a, AssemblyParams())
    # user moves note #3 to string 2 (same pitch) and locks it
    for _, _, n in iter_score_notes(s0):
        if n.note_id == "n3":
            n.string, n.fret, n.locked = 2, 10, True
    s1 = assemble(a, AssemblyParams(tempo_hint_bpm=100, timing="grid_from_hint"), previous=s0)
    got = {n.note_id: (n.string, n.fret, n.locked) for _, _, n in iter_score_notes(s1)}
    assert got["n3"] == (2, 10, True)


def test_ranged_refingering_keeps_outside_notes():
    tab = [TabNote(1, 5, i * 0.5, 0.5) for i in range(16)]
    a = analysis_from_tab(tab, bpm=120)
    s0 = assemble(a, AssemblyParams())
    before = {n.note_id: (n.string, n.fret) for _, _, n in iter_score_notes(s0)}
    # change the weights so the optimum changes, but only re-finger notes in 2s..4s
    w = {"open_cost": 5.0, "high_fret": 0.0, "move": 0.0}
    s1 = assemble(
        a, AssemblyParams(fingering_weights=w), previous=s0, range_s=(a.notes[4].onset_s, a.notes[8].onset_s)
    )
    after = {n.note_id: (n.string, n.fret) for _, _, n in iter_score_notes(s1)}
    for ev in a.notes:
        if not (a.notes[4].onset_s <= ev.onset_s <= a.notes[8].onset_s):
            assert after[ev.id] == before[ev.id]


def test_user_tapped_and_free_modes_run():
    tab = [TabNote(2, 5 + i % 3, i * 0.5, 0.5) for i in range(12)]
    a = analysis_from_tab(tab, bpm=96, with_beats=False)
    for mode in ("free", "grid_from_hint", "auto"):
        sc = assemble(a, AssemblyParams(timing=mode, tempo_hint_bpm=96))  # type: ignore[arg-type]
        check_measures_full(sc)
    taps = [0.5 + k * 60 / 96 for k in range(10)]
    sc = assemble(a, AssemblyParams(timing="user_tapped", user_beats_s=taps))
    check_measures_full(sc)
    durs = [s.duration for m in sc.measures for s in m.slots if s.notes]
    assert durs == ["1/8"] * 12


def test_free_mode_estimates_tempo():
    tab = [TabNote(2, 5 + i % 4, i * 0.5, 0.5) for i in range(24)]
    a = analysis_from_tab(tab, bpm=96, with_beats=False)
    sc = assemble(a, AssemblyParams(timing="free"))
    tempos = {round(m.tempo_bpm) for m in sc.measures}
    assert any(abs(t - 96) <= 3 or abs(t - 192) <= 6 or abs(t - 48) <= 2 for t in tempos), tempos


def test_empty_analysis():
    from taber_ir.models import Analysis

    sc = assemble(Analysis(), AssemblyParams())
    assert sc.measures == []


def test_chord_group_uses_distinct_strings():
    tab = [TabNote(3, 5, 0, 1), TabNote(2, 5, 0, 1), TabNote(1, 5, 0, 1)]  # triad shape
    a = analysis_from_tab(tab, bpm=120)
    sc = assemble(a, AssemblyParams())
    check_measures_full(sc)
    ns = [n for _, _, n in iter_score_notes(sc)]
    assert len({n.string for n in ns}) == 3
    assert len(sc.measures[0].slots[0].notes) == 3


def test_score_json_roundtrip():
    tab = [TabNote(2, 5, 0, 1), TabNote(2, 7, 1, 1)]
    sc = assemble(analysis_from_tab(tab), AssemblyParams())
    from taber_ir.models import Score

    assert Score.model_validate_json(sc.model_dump_json()) == sc

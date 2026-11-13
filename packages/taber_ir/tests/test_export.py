from __future__ import annotations

import io
import random
from xml.etree import ElementTree as ET

import guitarpro as gp
import mido
import pytest
from taber_ir import AssemblyParams, assemble, iter_score_notes
from taber_ir.export import export, score_to_alphatex, score_to_ascii
from taber_ir.models import Tuning
from taber_ir.testing import TabNote, analysis_from_tab, check_measures_full


def lick():
    # bar 1: 8ths with hammer-on / bend / vibrato ; bar 2: triplets, rest, tied note across bar
    return [
        TabNote(2, 5, 0.0, 0.5),
        TabNote(2, 7, 0.5, 0.5, ("hammer_on",)),
        TabNote(2, 8, 1.0, 0.5, ("slide_legato",)),
        TabNote(2, 10, 1.5, 0.5),
        TabNote(1, 7, 2.0, 1.0, ("bend",)),
        TabNote(1, 7, 3.0, 1.0, ("vibrato",)),
        TabNote(3, 5, 4.0, 1 / 3),
        TabNote(3, 6, 4 + 1 / 3, 1 / 3),
        TabNote(3, 7, 4 + 2 / 3, 1 / 3),
        TabNote(4, 7, 6.0, 3.0),
    ]


def make_score(tuning: Tuning | None = None):
    a = analysis_from_tab(lick(), bpm=100, n_beats=12, tuning=tuning)
    for n in a.notes:  # technique values (analysis_from_tab only sets type)
        for t in n.techniques:
            if t.type == "bend":
                t.value = 1.0
    return assemble(a, AssemblyParams(tuning=tuning or Tuning()))


def test_ascii_has_all_strings_and_frets():
    txt = score_to_ascii(make_score())
    lines = [ln for ln in txt.splitlines() if "|" in ln]
    assert len(lines) % 6 == 0 and len(lines) >= 6
    body = txt
    # technique marks are rendered (exact frets depend on the chosen fingering)
    assert any(c in body for c in "hp") and "/" in body
    assert "b-" in body or "b" in body.split("\n", 1)[1]
    assert "~" in body


def test_alphatex_structure():
    tex = score_to_alphatex(make_score())
    assert "\\tuning e4 b3 g3 d3 a2 e2" in tex
    assert "{h}" in tex and "{sl}" in tex
    assert "{b (0 4 4)}" in tex
    assert "{tu 3}" in tex
    assert tex.count("|") == len(make_score().measures)
    assert "-." in tex  # tie


def test_alphatex_capo_and_tuning_names():
    tex = score_to_alphatex(make_score(Tuning(name="Drop D", open_pitches=[64, 59, 55, 50, 45, 38], capo=2)))
    assert "\\tuning e4 b3 g3 d3 a2 d2" in tex
    assert "\\capo 2" in tex


def test_gp5_roundtrip():
    score = make_score()
    data = export(score, "gp5")
    song = gp.parse(io.BytesIO(data))
    track = song.tracks[0]
    assert [s.value for s in track.strings] == [64, 59, 55, 50, 45, 40]
    assert len(track.measures) == len(score.measures)
    got = []
    for gm in track.measures:
        for b in gm.voices[0].beats:
            for n in b.notes:
                got.append((n.string, n.value, n.type == gp.NoteType.tie))
    want = [(n.string, n.fret, n.tie_from_prev) for _, _, n in iter_score_notes(score)]
    assert got == want
    # effects survived
    effects = [n.effect for gm in track.measures for b in gm.voices[0].beats for n in b.notes]
    assert any(e.hammer for e in effects)
    assert any(e.slides for e in effects)
    assert any(e.bend is not None for e in effects)
    assert any(e.vibrato for e in effects)
    # durations
    durs = [(b.duration.value, b.duration.isDotted, b.duration.tuplet.enters) for gm in track.measures for b in gm.voices[0].beats]
    assert (8, False, 3) in durs


def test_gp5_measure_lengths_match_time_signature():
    song = gp.parse(io.BytesIO(export(make_score(), "gp5")))
    for gm in song.tracks[0].measures:
        total = sum(b.duration.time for b in gm.voices[0].beats)
        assert total == gm.header.length


def test_midi_notes_and_tempo():
    score = make_score()
    mid = mido.MidiFile(file=io.BytesIO(export(score, "midi")))
    notes_on = [m for t in mid.tracks for m in t if m.type == "note_on" and m.velocity > 0]
    expected = [n for _, _, n in iter_score_notes(score) if not n.tie_from_prev]
    assert [m.note for m in notes_on] == [n.pitch_midi for n in expected]
    tempos = [m for t in mid.tracks for m in t if m.type == "set_tempo"]
    assert tempos and abs(mido.tempo2bpm(tempos[0].tempo) - score.measures[0].tempo_bpm) < 1
    # equal note_on and note_off counts
    offs = [m for t in mid.tracks for m in t if m.type == "note_off"]
    assert len(offs) == len(notes_on)


def test_musicxml_wellformed_and_matches():
    score = make_score()
    xml = export(score, "musicxml").decode()
    root = ET.fromstring(xml)
    assert root.tag == "score-partwise"
    assert len(root.findall("./part/measure")) == len(score.measures)
    frets = [int(f.text) for f in root.iter("fret")]
    assert frets == [n.fret for _, _, n in iter_score_notes(score)]
    # measure durations add up (divisions = 24 per quarter)
    for m in root.findall("./part/measure"):
        total = sum(int(n.find("duration").text) for n in m.findall("note") if n.find("chord") is None)
        assert total == 96


def test_all_formats_nonempty():
    score = make_score()
    for fmt in ("ascii", "alphatex", "gp5", "midi", "musicxml"):
        assert len(export(score, fmt)) > 50


# ── fuzz: every measure is always exactly full ──
@pytest.mark.parametrize("seed", range(12))
def test_fuzz_measures_always_full(seed):
    rnd = random.Random(seed)
    bpm = rnd.choice([60, 90, 120, 150, 180])
    grid = [0.25, 1 / 3, 0.5, 0.75, 1.0, 1.5]
    t, tab = 0.0, []
    for _ in range(rnd.randint(8, 60)):
        t += rnd.choice([g for g in grid if g >= 0.25])
        tab.append(TabNote(rnd.randint(1, 6), rnd.randint(0, 15), t, rnd.choice([0.25, 0.5, 1.0])))
    ts = rnd.choice(["4/4", "3/4", "6/8", "5/4", "7/8"])
    a = analysis_from_tab(tab, bpm=bpm, jitter_s=rnd.choice([0.0, 0.015, 0.03]), seed=seed, time_signature=ts)
    for mode in ("auto", "free", "grid_from_hint"):
        sc = assemble(a, AssemblyParams(timing=mode, tempo_hint_bpm=bpm))  # type: ignore[arg-type]
        check_measures_full(sc)
        gp.parse(io.BytesIO(export(sc, "gp5")))  # always writable & readable
        ET.fromstring(export(sc, "musicxml").decode())


def test_alphatex_one_beat_effect_group_per_beat():
    """A dotted / tuplet beat with a whammy must not get two `{...}` groups: alphaTab rejects the whole sheet."""
    import re

    tab = [
        TabNote(3, 5, 0.0, 0.75, (("whammy", -1.0),)),  # dotted eighth + whammy
        TabNote(3, 7, 0.75, 0.25),
        TabNote(2, 5, 1.0, 1 / 3, (("whammy", -1.0),)),  # triplet + whammy
        TabNote(2, 7, 4 / 3, 1 / 3),
        TabNote(2, 8, 5 / 3, 1 / 3),
    ]
    tex = score_to_alphatex(assemble(analysis_from_tab(tab, bpm=100), AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=100)))
    assert "tbe" in tex
    # the old exporter wrote `{d} {tbe ...}` / `{tu 3} {tbe ...}`: a beat group followed by a second group
    assert not re.search(r"\{(?:d|tu \d+)\}\s*\{", tex), tex
    assert re.search(r"\{d tbe|\{tu 3 tbe", tex), tex

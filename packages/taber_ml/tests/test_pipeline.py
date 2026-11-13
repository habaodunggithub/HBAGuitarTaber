from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from taber_ir import assemble
from taber_ir.models import AnalysisOptions, AssemblyParams, Tuning
from taber_ir.testing import TabNote, analysis_from_tab
from taber_ml.audio.ingest import IngestError, load_audio
from taber_ml.eval import match_notes, note_f1, rhythm_accuracy
from taber_ml.io.local_dir import LocalDirIO, load_analysis
from taber_ml.pipeline import Canceled, JobSpec, run_analysis
from taber_ml.synth import render

SR = 44100


def pent_lick() -> tuple[list[TabNote], float]:
    seq = [(2, 8), (2, 10), (1, 5), (1, 8), (1, 10), (1, 8), (1, 5), (2, 8)]
    return [TabNote(s, f, i * 0.5, 0.5) for i, (s, f) in enumerate(seq)], 100.0


def technique_lick() -> tuple[list[TabNote], float]:
    return [
        TabNote(2, 8, 0.0, 1.0, (("bend", 1.0),)),
        TabNote(2, 8, 1.0, 1.0, ("vibrato",)),
        TabNote(1, 5, 2.0, 0.5),
        TabNote(1, 8, 2.5, 0.5),
        TabNote(3, 5, 3.0, 0.5),
        TabNote(3, 7, 3.5, 0.5, ("slide_legato",)),
        TabNote(1, 5, 4.0, 1.5, (("whammy", -1.0),)),
        TabNote(1, 8, 5.5, 0.5),
    ], 110.0


def write_audio(tmp: Path, tab, bpm, tone="distortion_light", name="take.wav") -> tuple[Path, object]:
    ref = analysis_from_tab(tab, bpm=bpm)
    path = tmp / name
    sf.write(path, render(ref.notes, tone=tone), SR)
    return path, ref


def analyze(path: Path, **kw):
    kw.setdefault("separate_source", "off")  # these tests are about transcription, not separation
    spec = JobSpec(options=AnalysisOptions(**kw), inputs={"wet": str(path)}, tracker="pyin")
    io = LocalDirIO(spec.inputs)
    return run_analysis(spec, io), io


@pytest.mark.parametrize("tone", ["clean", "distortion_light"])
def test_transcribes_notes_and_rhythm(tmp_path, tone):
    tab, bpm = pent_lick()
    path, ref = write_audio(tmp_path, tab, bpm, tone)
    an, _ = analyze(path)
    f = note_f1(ref.notes, an.notes)
    assert f.f1 >= 0.95, f
    score = assemble(an, AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=bpm))
    order = sorted(tab, key=lambda n: (n.start, n.string))
    assert rhythm_accuracy(ref.notes, [n.start for n in order], an.notes, score) >= 0.95


def test_no_false_techniques_on_plain_notes(tmp_path):
    tab, bpm = pent_lick()
    path, _ = write_audio(tmp_path, tab, bpm)
    an, _ = analyze(path)
    assert [n.techniques for n in an.notes] == [[] for _ in an.notes]


def test_techniques_detected(tmp_path):
    tab, bpm = technique_lick()
    path, ref = write_audio(tmp_path, tab, bpm)
    an, _ = analyze(path)
    by_pitch_onset = {i: {t.type for t in n.techniques} for i, n in enumerate(an.notes)}
    assert "bend" in by_pitch_onset[0]
    assert "vibrato" in by_pitch_onset[1]
    assert any("slide_legato" in v or "slide_shift" in v for v in by_pitch_onset.values())
    assert "whammy" in by_pitch_onset[6]
    # the bent note keeps the FRETTED pitch (G4 = 67), not the bent target
    assert an.notes[0].pitch_midi == 67
    bend = next(t for t in an.notes[0].techniques if t.type == "bend")
    assert 0.5 <= bend.value <= 1.25


def test_dip_tuning_offset_is_estimated(tmp_path):
    tab, bpm = pent_lick()
    ref = analysis_from_tab(tab, bpm=bpm)
    for n in ref.notes:
        n.pitch_cents = -30.0  # guitar tuned 30 cents flat
    path = tmp_path / "flat.wav"
    sf.write(path, render(ref.notes), SR)
    an, _ = analyze(path)
    assert abs(an.tuning_offset_cents + 30) <= 12
    assert [n.pitch_midi for n in an.notes] == [n.pitch_midi for n in ref.notes]


def test_di_and_wet_pair(tmp_path):
    tab, bpm = pent_lick()
    ref = analysis_from_tab(tab, bpm=bpm)
    wet, di = tmp_path / "wet.wav", tmp_path / "di.wav"
    sf.write(wet, render(ref.notes, tone="high_gain"), SR)
    sf.write(di, render(ref.notes, tone="clean"), SR)
    spec = JobSpec(inputs={"wet": str(wet), "di": str(di)}, tracker="pyin")
    an = run_analysis(spec, LocalDirIO(spec.inputs))
    assert note_f1(ref.notes, an.notes).f1 >= 0.95
    assert an.meta["inputs"] == ["di", "wet"]


def test_progress_and_cancel(tmp_path):
    tab, bpm = pent_lick()
    path, _ = write_audio(tmp_path, tab, bpm)
    seen: list[str] = []
    spec = JobSpec(inputs={"wet": str(path)}, tracker="pyin")
    io = LocalDirIO(spec.inputs, on_progress=lambda s, p, m: seen.append(s))
    run_analysis(spec, io)
    assert seen[:7] == ["ingest", "separation", "beats", "f0", "segment", "video", "quality"] and seen[-1] == "done"

    class Cancel(LocalDirIO):
        def is_canceled(self):
            return True

    with pytest.raises(Canceled):
        run_analysis(spec, Cancel(spec.inputs))


def test_analysis_roundtrip_and_reassemble(tmp_path):
    tab, bpm = pent_lick()
    path, _ = write_audio(tmp_path, tab, bpm)
    spec = JobSpec(inputs={"wet": str(path)}, tracker="pyin")
    io = LocalDirIO(spec.inputs, out_dir=tmp_path / "out")
    an = run_analysis(spec, io)
    an2 = load_analysis(tmp_path / "out" / "analysis.json.gz")
    assert an2 == an
    # re-assembling with another tuning/capo needs no model and keeps the pitches
    s1 = assemble(an2, AssemblyParams(tuning=Tuning(capo=3)))
    p0 = [n.pitch_midi for m in assemble(an2).measures for s in m.slots for n in s.notes]
    p1 = [n.pitch_midi for m in s1.measures for s in m.slots for n in s.notes]
    assert p0 == p1


def test_silence_and_garbage_inputs(tmp_path):
    silent = tmp_path / "silent.wav"
    sf.write(silent, np.zeros(SR * 2, dtype=np.float32), SR)
    an, _ = analyze(silent)
    assert an.notes == [] and any("notes" in w for w in an.quality.warnings)

    with pytest.raises(IngestError):
        load_audio(tmp_path / "missing.wav")
    junk = tmp_path / "junk.mp3"
    junk.write_bytes(b"not audio at all")
    with pytest.raises(IngestError):
        load_audio(junk)


def test_clipping_is_reported(tmp_path):
    tab, bpm = pent_lick()
    path, ref = write_audio(tmp_path, tab, bpm)
    y, sr = sf.read(path)
    sf.write(path, np.clip(y * 8, -1, 1), sr)
    an, _ = analyze(path)
    assert an.quality.clipping and any("clip" in w for w in an.quality.warnings)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_decodes_mp3_via_ffmpeg(tmp_path):
    tab, bpm = pent_lick()
    wav, ref = write_audio(tmp_path, tab, bpm, "clean")
    mp3 = tmp_path / "take.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-b:a", "192k", str(mp3)], check=True)
    an, _ = analyze(mp3)
    assert note_f1(ref.notes, an.notes).f1 >= 0.9


def test_cli_end_to_end(tmp_path):
    from taber_ml.cli import main

    tab, bpm = pent_lick()
    path, _ = write_audio(tmp_path, tab, bpm)
    out = tmp_path / "out"
    rc = main(["transcribe", str(path), "-o", str(out), "--tracker", "pyin", "--tempo", str(bpm), "-q"])
    assert rc == 0
    for name in ("analysis.json.gz", "score.json", "take.gp5", "take.txt", "take.mid", "take.alphatex", "take.musicxml"):
        assert (out / name).stat().st_size > 20, name
    # instant re-assemble with a capo
    out2 = tmp_path / "out2"
    assert main(["assemble", str(out / "analysis.json.gz"), "-o", str(out2), "--capo", "2"]) == 0
    assert "\\capo 2" in (out2 / "analysis.alphatex").read_text()
    assert main(["transcribe", str(tmp_path / "nope.wav"), "-o", str(out), "-q"]) == 2


def test_match_notes_is_one_to_one():
    ref = analysis_from_tab([TabNote(1, 5, 0, 1), TabNote(1, 5, 1, 1)]).notes
    est = [ref[0].model_copy(update={"id": "a"})]
    pairs = match_notes(ref, est)
    assert pairs == [(0, 0)]


def _random_solo(seconds: float, seed: int = 1):
    pent = [(1, 5), (1, 8), (2, 5), (2, 8), (3, 5), (3, 7), (4, 5), (4, 7), (5, 5), (5, 7), (6, 5), (6, 8)]
    rng = np.random.default_rng(seed)
    tab, t = [], 0.0
    while t < seconds * 2:  # 120 bpm: 2 beats per second
        s, f = pent[rng.integers(len(pent))]
        d = float(rng.choice([0.25, 0.5, 0.5, 1.0]))
        tab.append(TabNote(s, f, t, d))
        t += d
    return tab


def test_long_audio_does_not_degrade_with_time(tmp_path):
    """pesto-pitch 2.0.1 lost accuracy (octave errors) on long single calls: regression guard."""
    pytest.importorskip("pesto")
    from taber_ml.audio.f0 import PestoTracker

    tab = _random_solo(45)
    ref = analysis_from_tab(tab, bpm=120)
    path = tmp_path / "long.wav"
    sf.write(path, render(ref.notes, tone="distortion_light"), SR)
    spec = JobSpec(inputs={"wet": str(path)}, tracker="pesto")
    an = run_analysis(spec, LocalDirIO(spec.inputs))
    assert an.meta["pitch_tracker"] == PestoTracker.name
    late_ref = [n for n in ref.notes if n.onset_s > 30]
    late_est = [n for n in an.notes if n.onset_s > 30]
    assert note_f1(late_ref, late_est).f1 >= 0.95  # the last third used to fall below 0.9


def test_repeated_and_fast_notes(tmp_path):
    """Same-pitch repeats and 16ths must be separated by the re-pick logic, not by silence gaps."""
    tab = [TabNote(2, 5, i * 0.25, 0.25) for i in range(6)] + [TabNote(1, 8, 1.5 + i * 0.25, 0.25) for i in range(4)]
    ref = analysis_from_tab(tab, bpm=120)
    path = tmp_path / "rep.wav"
    sf.write(path, render(ref.notes, tone="distortion_light"), SR)
    an, _ = analyze(path)
    assert note_f1(ref.notes, an.notes).f1 >= 0.9


def test_batch_two_workers_resume_and_error_isolation(tmp_path):
    """One process per GPU slot (CPU here); a bad file must not stop the others; reruns skip finished files."""
    from taber_ml.batch import BatchConfig, find_inputs, parse_gpus, run_batch

    src = tmp_path / "in"
    src.mkdir()
    tab, bpm = pent_lick()
    ref = analysis_from_tab(tab, bpm=bpm)
    for name in ("a", "b"):
        sf.write(src / f"{name}.wav", render(ref.notes, tone="clean"), SR)
    sf.write(src / "a.di.wav", render(ref.notes, tone="clean"), SR)  # DI of a: not a separate job
    sf.write(src / "silent.wav", np.zeros(SR, dtype=np.float32), SR)  # processes fine, 0 notes
    (src / "broken.mp3").write_bytes(b"not audio")  # fails, isolated

    files = find_inputs(src)
    assert [f.name for f in files] == ["a.wav", "b.wav", "broken.mp3", "silent.wav"]
    out = tmp_path / "out"
    cfg = BatchConfig(out_dir=str(out), tracker="pyin", formats="gp5,ascii")
    rows = {r["file"]: r for r in run_batch(files, cfg, gpus=[None, None])}
    assert rows["a.wav"]["status"] == rows["b.wav"]["status"] == "ok" and rows["a.wav"]["notes"] == len(ref.notes)
    assert rows["broken.mp3"]["status"] == "error" and (out / "broken" / "error.txt").exists()
    assert (out / "a" / "a.gp5").stat().st_size > 100 and (out / "summary.csv").exists()
    # resume: finished files are skipped
    again = {r["file"]: r["status"] for r in run_batch(files, cfg, gpus=[None])}
    assert again["a.wav"] == again["b.wav"] == "skipped" and again["broken.mp3"] == "error"
    assert parse_gpus("0,1") == [0, 1] and parse_gpus("cpu,cpu") == [None, None]


def test_reports_detected_key(tmp_path):
    tab, bpm = pent_lick()  # G A A C D C A G: A minor pentatonic
    path, _ref = write_audio(tmp_path, tab, bpm, "clean")
    an, _ = analyze(path)
    k = an.quality.key
    assert k is not None and k["mode"] in ("major", "minor")
    assert k["tonic"] in (7, 9, 0, 2)  # a pitch class the lick actually plays
    assert k["scale_prior"] is False  # second pass is off unless SegmentParams enables it

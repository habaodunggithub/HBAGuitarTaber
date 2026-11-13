"""Source separation (Stage 1). Decisions are tested with a fake separator; one test runs real Demucs."""
from __future__ import annotations

import numpy as np
import pytest
import soundfile as sf
from taber_ir.models import AnalysisOptions
from taber_ir.testing import TabNote, analysis_from_tab
from taber_ml.audio import separation as S
from taber_ml.io.local_dir import LocalDirIO
from taber_ml.pipeline import JobSpec, run_analysis
from taber_ml.synth import mix_with_backing, render, render_backing

SR = 44100


def stems_with(guitar_db: float, band_db: float, n: int = SR) -> tuple[dict[str, np.ndarray], np.ndarray]:
    rng = np.random.default_rng(0)
    unit = lambda: rng.standard_normal((2, n)).astype(np.float32)  # noqa: E731
    g = unit() * 10 ** (guitar_db / 20)
    stems = {"guitar": g, "drums": unit() * 10 ** (band_db / 20), "bass": unit() * 10 ** (band_db / 20),
             "other": unit() * 1e-4, "vocals": unit() * 1e-4, "piano": unit() * 1e-4}
    return stems, sum(stems.values())


def test_band_present_keeps_the_guitar_stem():
    stems, mix = stems_with(0, 0)
    mono, info = S.choose_stem(stems, mix)
    assert info.used and info.stem == "guitar" and info.warning is None
    assert np.allclose(mono, stems["guitar"].mean(axis=0))


def test_solo_take_keeps_the_original():
    stems, mix = stems_with(0, -30)
    mono, info = S.choose_stem(stems, mix)
    assert mono is None and not info.used and info.stem == "original" and info.backing_db < S.SOLO_BACKING_DB


def test_empty_guitar_stem_keeps_the_original_and_warns():
    stems, mix = stems_with(-60, 0)
    mono, info = S.choose_stem(stems, mix)
    assert mono is None and not info.used and info.warning


class FakeSeparator:
    """Returns the stems of the clean guitar it was built with (as if Demucs were perfect)."""

    def __init__(self, guitar: np.ndarray, band_db: float):
        self.guitar, self.band_db, self.calls = guitar, band_db, 0

    def stems(self, mix):
        self.calls += 1
        n = mix.shape[1]
        g = np.zeros((2, n), np.float32)
        m = min(self.guitar.shape[1], n)
        g[:, :m] = self.guitar[:, :m]
        rest = mix - g
        tiny = np.zeros_like(mix)
        return {"guitar": g, "drums": rest * 0.5, "bass": rest * 0.5, "other": tiny, "vocals": tiny, "piano": tiny}


@pytest.fixture()
def take(tmp_path, monkeypatch):
    monkeypatch.setenv("TABER_CACHE_DIR", str(tmp_path / "cache"))
    tab = [TabNote(s, f, i * 0.5, 0.5) for i, (s, f) in enumerate([(2, 8), (2, 10), (1, 5), (1, 8), (1, 10), (1, 8), (1, 5), (2, 8)])]
    ref = analysis_from_tab(tab, bpm=100)
    gtr = render(ref.notes, tone="distortion_light")
    band = render_backing(len(gtr) / SR, 100)
    mix = mix_with_backing(gtr, band, 6.0)
    p = tmp_path / "mix.wav"
    sf.write(p, mix, SR)
    scale = 0.8 / max(np.max(np.abs(gtr + band)), 1e-9)  # roughly what mix_with_backing did to the guitar
    return p, ref, np.stack([gtr * scale] * 2)


def test_separate_file_uses_stem_and_caches(take):
    p, _ref, g = take
    sep = FakeSeparator(g, 6.0)
    audio, info = S.separate_file(p, sep)
    assert audio is not None and info.used and info.stem == "guitar" and not info.cached
    audio2, info2 = S.separate_file(p, sep)
    assert sep.calls == 1 and info2.cached and np.allclose(audio.y, audio2.y)  # second time from the cache


def test_force_uses_stem_even_for_a_solo(tmp_path, monkeypatch):
    monkeypatch.setenv("TABER_CACHE_DIR", str(tmp_path / "cache"))
    y = render(analysis_from_tab([TabNote(1, 5, 0, 2)]).notes)
    p = tmp_path / "solo.wav"
    sf.write(p, y, SR)
    sep = FakeSeparator(np.stack([y, y]), -60)
    assert S.separate_file(p, sep)[0] is None  # auto: solo -> original
    audio, info = S.separate_file(p, sep, force=True)
    assert audio is not None and info.used and sep.calls == 1


def analyse(path, monkeypatch, separator, **opts):
    from taber_ml.models import ModelRegistry

    models = ModelRegistry()
    monkeypatch.setattr(ModelRegistry, "get_separator", lambda self: separator)
    stages: list[str] = []
    spec = JobSpec(options=AnalysisOptions(**opts), inputs={"wet": str(path)}, tracker="pyin")
    an = run_analysis(spec, LocalDirIO(spec.inputs, on_progress=lambda s, *_: stages.append(s)), models)
    return an, stages


def test_pipeline_reads_notes_from_the_separated_guitar(take, monkeypatch):
    from taber_ml.eval import note_f1

    p, ref, g = take
    an_off, _ = analyse(p, monkeypatch, FakeSeparator(g, 6), separate_source="off")
    an_on, stages = analyse(p, monkeypatch, FakeSeparator(g, 6), separate_source="auto")
    assert stages[:2] == ["ingest", "separation"]
    assert an_on.quality.separation["used"] is True and an_on.quality.separation["stem"] == "guitar"
    assert an_off.quality.separation == {"used": False, "stem": "original", "reason": "Backing-track separation is off"}
    f_on, f_off = note_f1(ref.notes, an_on.notes).f1, note_f1(ref.notes, an_off.notes).f1
    assert f_on >= 0.9 and f_on > f_off  # the band 6 dB louder hurts; the clean stem does not


def test_pipeline_skips_separation_with_a_di_track(take, tmp_path, monkeypatch):
    p, _ref, g = take
    di = tmp_path / "di.wav"
    sf.write(di, g[0], SR)
    sep = FakeSeparator(g, 6)
    from taber_ml.models import ModelRegistry

    monkeypatch.setattr(ModelRegistry, "get_separator", lambda self: sep)
    spec = JobSpec(inputs={"wet": str(p), "di": str(di)}, tracker="pyin")
    an = run_analysis(spec, LocalDirIO(spec.inputs))
    assert sep.calls == 0 and "DI" in an.quality.separation["reason"]


def test_missing_demucs_is_reported_not_fatal(take, monkeypatch):
    from taber_ml.models import ModelRegistry

    def boom(self):
        raise ImportError("no demucs")

    monkeypatch.setattr(ModelRegistry, "get_separator", boom)
    p, _ref, _g = take
    spec = JobSpec(options=AnalysisOptions(separate_source="on"), inputs={"wet": str(p)}, tracker="pyin")
    an = run_analysis(spec, LocalDirIO(spec.inputs))
    # the analysis still completes (a loud band may leave few or no notes) and says why
    assert any("Demucs" in w for w in an.quality.warnings)
    assert an.quality.separation["used"] is False


def test_real_demucs_on_a_band_mix(take):
    """Real model: our additive synth guitar is not recognised as a guitar by Demucs, so the
    documented fallback must kick in (keep the original, warn). Real guitar is covered by
    ml/eval/separation_study.py on GuitarSet."""
    pytest.importorskip("demucs")
    p, _ref, _g = take
    audio, info = S.separate_file(p, S.DemucsSeparator())
    assert set(info.stems_db) == {"drums", "bass", "other", "vocals", "guitar", "piano"}
    if info.stems_db["guitar"] < S.EMPTY_GUITAR_DB:
        assert audio is None and info.warning
    else:
        assert audio is not None and info.used


def test_cache_is_keyed_by_the_decision_rule_version(take, monkeypatch):
    """A cached decision made by an older rule must not be reused after the rule changes."""
    p, _ref, g = take
    sep = FakeSeparator(g, 6.0)
    S.separate_file(p, sep)
    monkeypatch.setattr(S, "DECISION_VERSION", S.DECISION_VERSION + 1)
    _audio, info = S.separate_file(p, sep)
    assert sep.calls == 2 and not info.cached

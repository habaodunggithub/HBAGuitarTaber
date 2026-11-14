"""`taber` command line (docs §11): transcribe | analyze | assemble | synth | eval."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import soundfile as sf
from taber_ir import assemble, preset
from taber_ir.export import FORMATS, export
from taber_ir.models import AnalysisOptions, AssemblyParams, Score, Tuning
from taber_ir.testing import TabNote, analysis_from_tab

from .io.local_dir import LocalDirIO, load_analysis
from .models import ModelRegistry
from .pipeline import JobSpec, run_analysis


# ───────────────────────────── shared options ─────────────────────────────
def _add_assembly_args(p: argparse.ArgumentParser) -> None:
    g = p.add_argument_group("assembly (re-runnable instantly, no model needed)")
    g.add_argument("--tuning", default="standard", help="standard | drop_d | half_step_down | whole_step_down | open_g | dadgad")
    g.add_argument("--capo", type=int, default=0)
    g.add_argument("--max-fret", type=int, default=22)
    g.add_argument("--timing", choices=["auto", "grid_from_hint", "user_tapped", "free"], default="auto")
    g.add_argument("--tempo", type=float, default=None, help="tempo hint in BPM (use with --timing grid_from_hint)")
    g.add_argument("--time-sig", default=None, help="e.g. 4/4, 3/4, 6/8")
    g.add_argument("--title", default=None)
    g.add_argument("--formats", default="gp5,ascii,midi,alphatex,musicxml", help=f"comma list of {sorted(FORMATS)}")


def _params(a: argparse.Namespace) -> AssemblyParams:
    t = preset(a.tuning)
    t.capo = a.capo
    timing = a.timing
    if a.tempo and timing == "auto":
        timing = "grid_from_hint"
    return AssemblyParams(
        tuning=t, max_fret=a.max_fret, timing=timing, tempo_hint_bpm=a.tempo, time_signature=a.time_sig
    )


def _write_outputs(score: Score, out: Path, stem: str, formats: str) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    written = []
    (out / "score.json").write_text(score.model_dump_json(indent=1), encoding="utf-8")
    written.append(out / "score.json")
    for fmt in [f.strip() for f in formats.split(",") if f.strip()]:
        _, ext = FORMATS[fmt]
        path = out / f"{stem}.{ext}"
        path.write_bytes(export(score, fmt))
        written.append(path)
    return written


def _spec(a: argparse.Namespace, wet: str | None, di: str | None) -> tuple[JobSpec, dict[str, str]]:
    inputs: dict[str, str] = {}
    if wet:
        inputs["wet"] = wet
    if di:
        inputs["di"] = di
    opts = AnalysisOptions(
        segmenter=a.segmenter, tone=a.tone, separate_source=a.separate, detect_techniques=not a.no_techniques
    )
    return JobSpec(options=opts, inputs=inputs, tempo_hint_bpm=a.tempo, tracker=a.tracker), inputs


def _add_analysis_args(p: argparse.ArgumentParser) -> None:
    g = p.add_argument_group("analysis (needs the models)")
    g.add_argument("--di", default=None, help="clean DI track of the same take (used for note detection)")
    g.add_argument("--segmenter", choices=["auto", "f0_first", "basic_pitch"], default="auto")
    g.add_argument("--tracker", choices=["auto", "pyin", "pesto", "crepe"], default="auto")
    g.add_argument("--tone", choices=["clean", "distortion_light", "high_gain"], default="distortion_light")
    g.add_argument("--separate", choices=["auto", "on", "off"], default="auto")
    g.add_argument("--no-techniques", action="store_true")


# ───────────────────────────── commands ─────────────────────────────
def cmd_transcribe(a: argparse.Namespace) -> int:
    out = Path(a.out)
    t0 = time.perf_counter()
    spec, inputs = _spec(a, a.input, a.di)
    io = LocalDirIO(inputs, out_dir=out, verbose=not a.quiet)
    analysis = run_analysis(spec, io, ModelRegistry())
    params = _params(a)
    title = a.title or Path(a.input).stem
    score = assemble(analysis, params, title=title)
    files = _write_outputs(score, out, Path(a.input).stem, a.formats)
    n = sum(len(s.notes) for m in score.measures for s in m.slots)
    print(f"{n} notes, {len(score.measures)} measures in {time.perf_counter() - t0:.1f}s")
    for w in analysis.quality.warnings:
        print(f"! {w}")
    for f in files:
        print(f"  {f}")
    return 0


def cmd_analyze(a: argparse.Namespace) -> int:
    spec, inputs = _spec(a, a.input, a.di)
    out = Path(a.out)
    io = LocalDirIO(inputs, out_dir=out, verbose=not a.quiet)
    run_analysis(spec, io, ModelRegistry())
    print(out / "analysis.json.gz")
    return 0


def cmd_assemble(a: argparse.Namespace) -> int:
    analysis = load_analysis(a.analysis)
    t0 = time.perf_counter()
    score = assemble(analysis, _params(a), title=a.title or Path(a.analysis).name.split(".")[0])
    dt = time.perf_counter() - t0
    files = _write_outputs(score, Path(a.out), Path(a.analysis).name.split(".")[0], a.formats)
    print(f"assembled in {dt * 1000:.0f} ms")
    for f in files:
        print(f"  {f}")
    return 0


def _load_tab(path: Path) -> tuple[dict, list[TabNote], Tuning]:
    d = json.loads(path.read_text(encoding="utf-8"))
    tuning = Tuning(**d["tuning"]) if isinstance(d.get("tuning"), dict) else preset(d.get("tuning", "standard"))
    tab = []
    for n in d["notes"]:
        techs = tuple(t if isinstance(t, str) else (t["type"], t.get("value")) for t in n.get("techniques", []))
        tab.append(TabNote(n["string"], n["fret"], n["start"], n["dur"], techs))
    return d, tab, tuning


def cmd_synth(a: argparse.Namespace) -> int:
    from .synth import render

    d, tab, tuning = _load_tab(Path(a.tab))
    ref = analysis_from_tab(
        tab, bpm=d.get("bpm", 120), tuning=tuning, time_signature=d.get("time_signature", "4/4"),
        lead_in_s=d.get("lead_in_s", 0.5),
    )
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = Path(a.tab).name.removesuffix(".tab.json").removesuffix(".json")
    wet = render(ref.notes, tone=a.tone, seed=a.seed)
    di = render(ref.notes, tone="clean", seed=a.seed)
    sf.write(out / f"{stem}.wav", wet, 44100)
    sf.write(out / f"{stem}.di.wav", di, 44100)
    if a.backing is not None:
        from .synth import mix_with_backing, render_backing

        band = render_backing(len(wet) / 44100, d.get("bpm", 120), seed=a.seed, lead_in_s=d.get("lead_in_s", 0.5))
        sf.write(out / f"{stem}.mix.wav", mix_with_backing(wet, band, a.backing), 44100)
        print(f"wrote {stem}.mix.wav (backing {a.backing:+.0f} dB vs guitar)")
    (out / f"{stem}.tab.json").write_text(Path(a.tab).read_text(encoding="utf-8"), encoding="utf-8")
    print(f"wrote {stem}.wav (tone={a.tone}) and {stem}.di.wav in {out}")
    return 0


def cmd_eval(a: argparse.Namespace) -> int:
    from .eval import note_f1, rhythm_accuracy, tab_accuracy

    root = Path(a.dir)
    rows = []
    models = ModelRegistry()
    for tabfile in sorted(root.glob("*.tab.json")):
        stem = tabfile.name.removesuffix(".tab.json")
        wet, di = root / f"{stem}.wav", root / f"{stem}.di.wav"
        d, tab, tuning = _load_tab(tabfile)
        ref = analysis_from_tab(
            tab, bpm=d.get("bpm", 120), tuning=tuning, time_signature=d.get("time_signature", "4/4"),
            lead_in_s=d.get("lead_in_s", 0.5),
        )
        order = sorted(tab, key=lambda x: (x.start, x.string))
        ref_tab = [(n.string, n.fret) for n in order]
        ref_beats = [n.start for n in order]
        mix = root / f"{stem}.mix.wav"
        for variant, inputs in (("wet", {"wet": str(wet)}), ("di", {"di": str(di)}), ("mix", {"wet": str(mix)})):
            if not Path(next(iter(inputs.values()))).exists():
                continue
            if a.only and variant != a.only:
                continue
            spec = JobSpec(options=AnalysisOptions(separate_source=a.separate), inputs=inputs, tracker=a.tracker,
                           tempo_hint_bpm=d.get("bpm") if a.use_tempo else None)
            io = LocalDirIO(inputs)
            t0 = time.perf_counter()
            an = run_analysis(spec, io, models)
            t_an = time.perf_counter() - t0
            timing = "grid_from_hint" if a.use_tempo else a.timing
            score = assemble(an, AssemblyParams(tuning=tuning, timing=timing, tempo_hint_bpm=d.get("bpm") if a.use_tempo else None))
            ns = note_f1(ref.notes, an.notes)
            ta = tab_accuracy(ref.notes, ref_tab, an.notes, score)
            ra = rhythm_accuracy(ref.notes, ref_beats, an.notes, score)
            rows.append({
                "name": stem, "input": variant, "n_ref": ns.n_ref, "n_est": ns.n_est,
                "note_f1": round(ns.f1, 3), "precision": round(ns.precision, 3), "recall": round(ns.recall, 3),
                "tab_acc": round(ta["tab_acc"], 3), "rhythm_acc": round(ra, 3), "analysis_s": round(t_an, 2),
                "separated": (an.quality.separation or {}).get("stem", "-"),
            })
    if not rows:
        print("no *.tab.json found (with matching .wav)", file=sys.stderr)
        return 1
    _print_table(rows)
    mean = lambda k: sum(r[k] for r in rows) / len(rows)  # noqa: E731
    print(f"\nmean note_f1={mean('note_f1'):.3f}  tab_acc={mean('tab_acc'):.3f}  rhythm_acc={mean('rhythm_acc'):.3f}")
    _write_csv(rows, a.csv)
    return 0


def _print_table(rows: list[dict]) -> None:
    cols = list(rows[0])
    widths = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
    print("  ".join(c.ljust(widths[c]) for c in cols))
    for r in rows:
        print("  ".join(str(r[c]).ljust(widths[c]) for c in cols))


def _write_csv(rows: list[dict], path: str | None) -> None:
    if path:
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)


def cmd_truth_eval(a: argparse.Namespace) -> int:
    """Measure the pipeline on takes you checked in the editor (data/truth/<id>/truth.json)."""
    from taber_ir.truth import TruthTake

    from .eval import truth_report

    root = Path(a.dir)
    folders = sorted(p.parent for p in root.glob("*/truth.json"))
    if not folders:
        print(f"no */truth.json under {root} (mark a checked tab in the editor first)", file=sys.stderr)
        return 1
    models = None if a.stored else ModelRegistry()
    rows, totals = [], {}
    for d in folders:
        take = TruthTake.model_validate_json((d / "truth.json").read_text(encoding="utf-8"))
        if a.stored:
            an = load_analysis(d / "analysis.json.gz")
        else:
            inputs = {r: str(d / f) for r, f in take.inputs.items() if r in ("wet", "di")}
            o = dict(take.analysis_options)
            if a.segmenter:
                o["segmenter"] = a.segmenter
            if a.strings:
                o["string_model"] = a.strings
            if "video" in take.inputs and o.get("use_video") and not a.no_video:
                inputs["video"] = str(d / take.inputs["video"])
            else:
                o["use_video"], o["video_calibration"] = False, None
            opts = AnalysisOptions(**o)
            an = run_analysis(JobSpec(options=opts, inputs=inputs, tracker=a.tracker), LocalDirIO(inputs), models)
        use_tempo = a.use_tempo and take.tempo_bpm
        params = AssemblyParams(tuning=take.tuning, timing="grid_from_hint" if use_tempo else "auto",
                                tempo_hint_bpm=take.tempo_bpm if use_tempo else None)
        score = assemble(an, params)
        rep = truth_report(take.notes, an.notes, score)
        for k in ("n_ref", "n_est", "correct", "wrong_position", "wrong_pitch", "octave", "missed", "extra"):
            totals[k] = totals.get(k, 0) + rep[k]
        rows.append({"take": (take.title or d.name)[:28], **{
            k: (round(v, 3) if isinstance(v, float) else v) for k, v in rep.items()}})
    _print_table(rows)
    t = totals
    print(f"\n{len(rows)} take(s), {t['n_ref']} reference notes:")
    print(f"  right pitch+string+fret {t['correct'] / t['n_ref']:.1%}   right pitch, wrong place {t['wrong_position'] / t['n_ref']:.1%}")
    print(f"  wrong pitch {t['wrong_pitch'] / t['n_ref']:.1%} (octave {t['octave']})   missed {t['missed'] / t['n_ref']:.1%}"
          f"   extra notes {t['extra']} ({t['extra'] / t['n_ref']:.1%} of the reference count)")
    _write_csv(rows, a.csv)
    return 0


def cmd_worker(a: argparse.Namespace) -> int:
    import logging
    import os

    from .worker import PullWorker

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    token = a.token or os.environ.get("TABER_WORKER_TOKEN")
    if not token and a.token_file and Path(a.token_file).exists():
        token = Path(a.token_file).read_text().strip()
    if not token:
        print("error: worker token missing (--token, TABER_WORKER_TOKEN or --token-file)", file=sys.stderr)
        return 2
    w = PullWorker(
        a.api, token, worker_id=a.id, location=a.location, cache_dir=a.cache_dir, poll_s=a.poll,
        idle_exit_s=a.idle_exit, tracker=a.tracker,
    )
    try:
        if a.once:
            ran = w.run_once()
            print("ran a job" if ran else "no job available")
        else:
            w.run_forever()
    except KeyboardInterrupt:
        pass
    return 0


def cmd_batch(a: argparse.Namespace) -> int:
    from .batch import BatchConfig, find_inputs, parse_gpus, run_batch

    files = find_inputs(a.input)
    if not files:
        print(f"error: no audio files under {a.input}", file=sys.stderr)
        return 2
    cfg = BatchConfig(
        out_dir=a.out, tracker=a.tracker, formats=a.formats,
        options=AnalysisOptions(tone=a.tone, separate_source=a.separate, detect_techniques=not a.no_techniques).model_dump(),
        params=_params(a).model_dump(mode="json"), skip_done=not a.redo,
    )
    gpus = parse_gpus(a.gpus)
    print(f"{len(files)} file(s), workers: {['cpu' if g is None else f'cuda:{g}' for g in gpus]}")
    rows = run_batch(files, cfg, gpus)
    bad = [r for r in rows if r["status"] == "error"]
    print(f"done: {len(rows) - len(bad)} ok, {len(bad)} failed -> {Path(a.out) / 'summary.csv'}")
    return 1 if bad else 0


# ───────────────────────────── entry ─────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="taber", description="Audio -> guitar tab")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("transcribe", help="audio -> analysis -> score -> files")
    p.add_argument("input", help="audio file (wet / amp-sim tone, or the only track you have)")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("-q", "--quiet", action="store_true")
    _add_analysis_args(p)
    _add_assembly_args(p)
    p.set_defaults(fn=cmd_transcribe)

    p = sub.add_parser("analyze", help="audio -> analysis.json.gz only")
    p.add_argument("input")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("-q", "--quiet", action="store_true")
    p.add_argument("--tempo", type=float, default=None)
    _add_analysis_args(p)
    p.set_defaults(fn=cmd_analyze)

    p = sub.add_parser("assemble", help="analysis.json.gz -> score + files (instant, CPU)")
    p.add_argument("analysis")
    p.add_argument("-o", "--out", required=True)
    _add_assembly_args(p)
    p.set_defaults(fn=cmd_assemble)

    p = sub.add_parser("synth", help="render a ground-truth tab json to wav (wet + DI)")
    p.add_argument("tab")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--tone", choices=["clean", "distortion_light", "high_gain"], default="distortion_light")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--backing", type=float, default=None, metavar="DB",
                   help="also write NAME.mix.wav: guitar + drums/bass/pad at this level vs the guitar (e.g. 0)")
    p.set_defaults(fn=cmd_synth)

    p = sub.add_parser("batch", help="transcribe a whole folder, one worker per GPU (Kaggle T4 x2)")
    p.add_argument("input", help="folder (or file) of audio; name.di.wav is the DI take of name.wav")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--gpus", default=None, help="CUDA indices, e.g. 0,1 (default: all visible); 'cpu' for CPU")
    p.add_argument("--redo", action="store_true", help="recompute files that already have an analysis")
    _add_analysis_args(p)
    _add_assembly_args(p)
    p.set_defaults(fn=cmd_batch)

    p = sub.add_parser("worker", help="pull jobs from the API (laptop, Kaggle, ...)")
    p.add_argument("--api", default="http://127.0.0.1:8000")
    p.add_argument("--token", default=None)
    p.add_argument("--token-file", default="data/worker_token")
    p.add_argument("--id", default=None)
    p.add_argument("--location", choices=["local", "kaggle"], default="local")
    p.add_argument("--cache-dir", default="~/.cache/taber/inputs")
    p.add_argument("--poll", type=float, default=3.0)
    p.add_argument("--idle-exit", type=float, default=None, help="quit after N seconds without a job")
    p.add_argument("--tracker", choices=["auto", "pyin", "pesto", "crepe"], default="auto")
    p.add_argument("--once", action="store_true")
    p.set_defaults(fn=cmd_worker)

    p = sub.add_parser("eval", help="evaluate on a directory of *.tab.json + *.wav [+ *.di.wav]")
    p.add_argument("dir")
    p.add_argument("--csv", default=None)
    p.add_argument("--only", choices=["wet", "di", "mix"], default=None)
    p.add_argument("--separate", choices=["auto", "on", "off"], default="auto", help="source separation mode")
    p.add_argument("--tracker", choices=["auto", "pyin", "pesto", "crepe"], default="auto")
    p.add_argument("--timing", choices=["auto", "grid_from_hint", "user_tapped", "free"], default="auto")
    p.add_argument("--use-tempo", action="store_true", help="give the true tempo as a hint")
    p.set_defaults(fn=cmd_eval)

    p = sub.add_parser("truth-eval", help="evaluate on your checked takes (data/truth): where are the errors?")
    p.add_argument("dir", nargs="?", default="data/truth")
    p.add_argument("--stored", action="store_true", help="score the analysis saved with each take (no re-run)")
    p.add_argument("--segmenter", choices=["auto", "f0_first", "basic_pitch"], default=None)
    p.add_argument("--strings", choices=["auto", "on", "off"], default=None, help="string classifier")
    p.add_argument("--tracker", choices=["auto", "pyin", "pesto", "crepe"], default="auto")
    p.add_argument("--no-video", action="store_true")
    p.add_argument("--use-tempo", action="store_true", help="give the tempo of the checked tab as a hint")
    p.add_argument("--csv", default=None)
    p.set_defaults(fn=cmd_truth_eval)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    try:
        return a.fn(a)
    except (FileNotFoundError, ValueError, KeyError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

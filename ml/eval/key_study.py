"""Does a key-detection pass + scale prior improve note accuracy? (GuitarSet solos)

    uv run python ml/eval/key_study.py ~/.cache/taber/datasets/guitarset [--trials 40]

Pass 1 = the current segmenter. From its notes a scale is chosen, then pass 2 re-segments with
SegmentParams.scale_snap / scale_prune_* (tuned on players 00-03, every third take). Players 04-05
are reported for: current pipeline, detected key (diatonic), top-7 observed pitch classes, and the
annotated key (upper bound for a diatonic prior).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from guitarset_eval import TEST, TRAIN, cached_inputs  # noqa: E402
from taber_ir import assemble  # noqa: E402
from taber_ir.fusion.viterbi import FingeringWeights  # noqa: E402
from taber_ir.models import Analysis, AssemblyParams  # noqa: E402
from taber_ml.audio.f0 import get_tracker  # noqa: E402
from taber_ml.audio.key import detect_key, observed_scale, parse_key  # noqa: E402
from taber_ml.audio.segment import F0FirstSegmenter, SegmentParams  # noqa: E402
from taber_ml.datasets.guitarset import takes  # noqa: E402
from taber_ml.eval import note_f1, tab_accuracy  # noqa: E402


def run(data, p: SegmentParams, scales, with_tab: bool = True) -> dict[str, float]:
    seg = F0FirstSegmenter(p)
    f1s, tdrs = [], []
    for (take, audio, f0, (ref, ref_tab), _first), sc in zip(data, scales):
        notes = seg.segment(audio, f0, scale=sc).notes
        f1s.append(note_f1(ref, notes).f1)
        if with_tab and notes:
            ap = AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=take.bpm, fingering_weights=asdict(FingeringWeights()))
            tdrs.append(tab_accuracy(ref, ref_tab, notes, assemble(Analysis(notes=notes), ap))["tab_acc"])
    return {"f1": float(np.mean(f1s)), "tdr": float(np.mean(tdrs)) if tdrs else float("nan")}


SCALES = {
    "detected": lambda take, first: (k.scale if (k := detect_key(first)) else None),
    "observed7": lambda take, first: observed_scale(first),
    "annotated": lambda take, first: parse_key(take.key()).scale,
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--trials", type=int, default=40)
    ap.add_argument("--out", default="ml/eval/key_study.json")
    a = ap.parse_args()
    tracker = get_tracker("pesto")
    base = SegmentParams()
    first = F0FirstSegmenter(base)

    def load(pl):
        rows = []
        for t in takes(a.root, "solo", pl):
            audio, f0 = cached_inputs(t, tracker)
            rows.append((t, audio, f0, t.reference(), first.segment(audio, f0).notes))
        return rows
    train, test = load(TRAIN), load(TEST)
    subset = train[::3]
    scales = {k: ([fn(r[0], r[4]) for r in subset], [fn(r[0], r[4]) for r in test]) for k, fn in SCALES.items()}

    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    out: dict = {"test": {"current (no scale)": run(test, base, [None] * len(test))}}
    print(f"test  {'current (no scale)':12s} {out['test']['current (no scale)']}", flush=True)
    for name in ("detected", "observed7"):
        sc_tr, _ = scales[name]
        def obj(trial, sc_tr=sc_tr):
            p = replace(base,
                        scale_snap=trial.suggest_float("scale_snap", 0.0, 0.7),
                        scale_prune_conf=trial.suggest_float("scale_prune_conf", 0.0, 0.9),
                        scale_prune_s=trial.suggest_float("scale_prune_s", 0.0, 0.4))
            return run(subset, p, sc_tr, with_tab=False)["f1"]
        st = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=0))
        st.enqueue_trial({"scale_snap": 0.0, "scale_prune_conf": 0.0, "scale_prune_s": 0.0})
        st.optimize(obj, n_trials=a.trials)
        tuned = replace(base, **st.best_params)
        out[f"params_{name}"] = st.best_params
        print(f"{name}: best {({k: round(v, 3) for k, v in st.best_params.items()})} train-subset F1 {st.best_value:.4f} "
              f"(no prior {st.trials[0].value:.4f})", flush=True)
        out["test"][name] = run(test, tuned, scales[name][1])
        print(f"test  {name:12s} {out['test'][name]}", flush=True)
        if name == "detected":
            out["test"]["annotated"] = run(test, tuned, scales["annotated"][1])
            print(f"test  {'annotated':12s} {out['test']['annotated']}", flush=True)
    Path(a.out).write_text(json.dumps(out, indent=1))
    print("wrote", a.out)


if __name__ == "__main__":
    main()

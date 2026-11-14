"""Where do note-detection errors come from, and does a learned onset model (Basic Pitch) fix them?

    uv run python ml/eval/onset_study.py --guitarset ~/.cache/taber/datasets/guitarset --idmt ~/.cache/taber/datasets/idmt
    uv run python ml/eval/onset_study.py ... --tune 120          # Optuna on GuitarSet players 00-03

Every reference note lands in one bucket (taber_ml.eval.truth_report): right pitch, wrong pitch
(octave), missed; leftover detections are extra notes. TDR = right string+fret among right-pitch notes.

Test sets:
- GuitarSet players 04-05 (acoustic, mic). Basic Pitch was trained on a random 80% of GuitarSet
  tracks, so its numbers here are optimistic.
- IDMT-SMT-Guitar dataset2 licks (electric: Strat, Les Paul, Aristides). Neither Basic Pitch nor
  this project ever trained or tuned on it: the fair test. Evaluation only (CC BY-NC-ND).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np
from taber_ir import assemble
from taber_ir.models import Analysis
from taber_ir.truth import TruthNote
from taber_ml.audio.f0 import get_tracker
from taber_ml.audio.onsets import BasicPitchOnsets
from taber_ml.audio.segment import F0FirstSegmenter, SegmentParams
from taber_ml.datasets import guitarset, idmt
from taber_ml.eval import truth_report

sys.path.insert(0, str(Path(__file__).parent))
from guitarset_eval import cached_inputs  # noqa: E402

BP_KNOBS = {  # name: (low, high) searched by --tune
    "bp_repick": (0.2, 0.9), "bp_repick_gap_s": (0.03, 0.12), "bp_onset_snap": (0.2, 0.9),
    "bp_keep_short": (0.3, 1.0), "bp_min_note_s": (0.02, 0.08), "bp_keep_conf": (0.3, 1.0),
    "bp_drop": (0.0, 0.4), "bp_add": (0.5, 1.1), "bp_flat_semitones": (0.15, 0.6),
}  # only the bp_* knobs: the shared ones stay as tuned for f0-only mode (used when onnxruntime is missing)


def truth_of(ref, tab):
    return [TruthNote(onset_s=n.onset_s, offset_s=n.offset_s, pitch_midi=n.pitch_midi, string=s, fret=f, beat=0.0)
            for n, (s, f) in zip(ref, tab)]


def load(rows_src, tracker, bp):
    rows = []
    for t in rows_src:
        audio, f0 = cached_inputs(t, tracker)
        ref, tab = t.reference()[:2]
        rows.append((audio, f0, truth_of(ref, tab), bp.run(audio.y, audio.sr)))
    return rows


def latency(rows_notes) -> float:
    """Median (detected - labelled) onset of same-pitch pairs within 150 ms: a constant offset between
    the method's onset convention and the dataset's. IDMT labels sit ~30 ms before GuitarSet-style ones."""
    d = []
    for truth, notes in rows_notes:
        on = np.array([n.onset_s for n in notes])
        pitch = np.array([n.pitch_midi for n in notes])
        for r in truth:
            k = np.flatnonzero((pitch == r.pitch_midi) & (np.abs(on - r.onset_s) < 0.15))
            if len(k):
                d.append(on[k][np.argmin(np.abs(on[k] - r.onset_s))] - r.onset_s)
    return float(np.median(d)) if d else 0.0


def run(rows, params: SegmentParams, onset_model: bool, positions: bool = True, align: bool = False) -> tuple[list[dict], float]:
    seg = F0FirstSegmenter(params, onset_model=onset_model)
    found = [(truth, seg.segment(audio, f0, posteriors=post).notes) for audio, f0, truth, post in rows]
    shift = latency(found) if align else 0.0
    reps = []
    for truth, notes in found:
        notes = [n.model_copy(update={"onset_s": n.onset_s - shift, "offset_s": n.offset_s - shift}) for n in notes] if shift else notes
        score = assemble(Analysis(notes=notes)) if positions else assemble(Analysis(notes=[]))
        reps.append(truth_report(truth, notes, score))
    return reps, shift


def summarize(name: str, reps: list[dict]) -> dict:
    tot = {k: sum(r[k] for r in reps) for k in ("n_ref", "n_est", "correct", "wrong_position", "wrong_pitch", "octave", "missed", "extra")}
    f1 = float(np.mean([r["note_f1"] for r in reps]))
    tdr = float(np.mean([r["tab_acc"] for r in reps]))
    n = tot["n_ref"]
    print(f"  {name:<20} F1 {f1:.3f}  TDR {tdr:.3f} | missed {tot['missed'] / n:6.1%}  wrong pitch {tot['wrong_pitch'] / n:5.1%}"
          f" (octave {tot['octave']})  extra {tot['extra'] / n:5.1%}  all right {tot['correct'] / n:5.1%}", flush=True)
    return {"f1": f1, "tdr": tdr, "all_right": tot["correct"] / n, **tot}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--guitarset", default="~/.cache/taber/datasets/guitarset")
    ap.add_argument("--idmt", default="~/.cache/taber/datasets/idmt")
    ap.add_argument("--tune", type=int, default=0, help="Optuna trials for the Basic Pitch knobs (GuitarSet 00-03)")
    ap.add_argument("--params", default=None, help="JSON of SegmentParams overrides to evaluate")
    ap.add_argument("--out", default="ml/eval/onset_study.json")
    a = ap.parse_args()
    tracker, bp = get_tracker("pesto"), BasicPitchOnsets()

    tests = {
        "GuitarSet 04-05 (seen by Basic Pitch)": load(guitarset.takes(a.guitarset, "solo", ["04", "05"]), tracker, bp),
        "IDMT licks (electric, unseen)": load(idmt.takes(a.idmt), tracker, bp),
    }
    params = SegmentParams()
    result: dict = {}
    if a.params:
        params = SegmentParams(**{**asdict(params), **json.loads(Path(a.params).read_text())})
    if a.tune:
        import optuna

        optuna.logging.set_verbosity(optuna.logging.WARNING)
        train = load([t for i, t in enumerate(guitarset.takes(a.guitarset, "solo", ["00", "01", "02", "03"])) if i % 2 == 0], tracker, bp)
        print(f"tuning on {len(train)} GuitarSet takes (players 00-03)", flush=True)

        def obj(trial):
            p = SegmentParams(**{**asdict(params), **{k: trial.suggest_float(k, lo, hi) for k, (lo, hi) in BP_KNOBS.items()}})
            return float(np.mean([r["note_f1"] for r in run(train, p, True, positions=False)[0]]))

        st = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=0))
        st.enqueue_trial({k: getattr(params, k) for k in BP_KNOBS})
        st.optimize(obj, n_trials=a.tune, show_progress_bar=False)
        print(f"best train F1 {st.best_value:.3f}: {json.dumps({k: round(v, 3) for k, v in st.best_params.items()})}", flush=True)
        result["tuned_params"] = st.best_params
        tuned = SegmentParams(**{**asdict(params), **st.best_params})
    variants = [("f0_first", SegmentParams(), False), ("f0 + basic_pitch", params, True)]
    if a.tune:
        variants.append(("+ basic_pitch tuned", tuned, True))
    for name, rows in tests.items():
        print(f"{name}: {len(rows)} takes, {sum(len(r[2]) for r in rows)} notes")
        result[name] = {}
        for vname, vp, om in variants:
            for align in (False, True):
                reps, shift = run(rows, vp, om, align=align)
                label = f"{vname}{f' (latency {shift * 1000:+.0f} ms removed)' if align else ''}"
                result[name][label] = {**summarize(label, reps), "latency_s": shift}
    Path(a.out).write_text(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()

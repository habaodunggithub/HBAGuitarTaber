"""Note F1 and tablature accuracy on real guitar (GuitarSet solo takes), plus parameter tuning.

    uv run python ml/eval/guitarset_eval.py ~/.cache/taber/datasets/guitarset            # baseline report
    uv run python ml/eval/guitarset_eval.py ROOT --tune-segment 150 --tune-fingering 200  # Optuna

Train on players 00-03, report on held-out players 04-05 (never tuned on). Pitch tracks are computed
once per take and cached (~/.cache/taber/f0/), so tuning only re-runs the CPU stages.
"""

from __future__ import annotations

import argparse
import json
import pickle
from dataclasses import asdict, fields
from pathlib import Path

import numpy as np
from taber_ir import assemble
from taber_ir.fusion.viterbi import FingeringWeights
from taber_ir.models import Analysis, AssemblyParams, Score
from taber_ml.audio.f0 import F0Result, get_tracker
from taber_ml.audio.ingest import load_audio
from taber_ml.audio.segment import F0FirstSegmenter, SegmentParams
from taber_ml.datasets.guitarset import Take, takes
from taber_ml.eval import note_f1, tab_accuracy

TRAIN, TEST = ["00", "01", "02", "03"], ["04", "05"]
CACHE = Path("~/.cache/taber/f0").expanduser()


def cached_inputs(take: Take, tracker):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / f"{take.name}_{tracker.name}.pkl"
    audio = load_audio(take.audio)
    if p.exists():
        f0 = pickle.loads(p.read_bytes())
    else:
        f0 = tracker.track(audio.y, audio.sr)
        p.write_bytes(pickle.dumps(F0Result(f0.times, f0.midi, f0.conf, f0.hop_s, f0.name)))
    return audio, f0


def segment_all(data, seg_params: SegmentParams):
    seg = F0FirstSegmenter(seg_params)
    return [seg.segment(audio, f0, detect_techniques=True).notes for _t, audio, f0, _r in data]


def evaluate(data, seg_params: SegmentParams, weights: FingeringWeights | None, notes_cache=None) -> dict[str, float]:
    all_notes = notes_cache if notes_cache is not None else segment_all(data, seg_params)
    f1s, tdrs = [], []
    for (take, _audio, _f0, (ref, ref_tab)), notes in zip(data, all_notes):
        f1s.append(note_f1(ref, notes).f1)
        if weights is not None and notes:
            params = AssemblyParams(timing="grid_from_hint", tempo_hint_bpm=take.bpm, fingering_weights=asdict(weights))
            score: Score = assemble(Analysis(notes=notes), params)
            tdrs.append(tab_accuracy(ref, ref_tab, notes, score)["tab_acc"])
    return {"f1": float(np.mean(f1s)), "tdr": float(np.mean(tdrs)) if tdrs else float("nan")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--tracker", default="pesto")
    ap.add_argument("--tune-segment", type=int, default=0, help="Optuna trials for SegmentParams (objective: note F1)")
    ap.add_argument("--tune-fingering", type=int, default=0, help="Optuna trials for FingeringWeights (objective: tab accuracy)")
    ap.add_argument("--out", default="ml/eval/tuned.json")
    a = ap.parse_args()

    tracker = get_tracker(a.tracker)
    def load(players):
        rows = []
        for t in takes(a.root, "solo", players):
            audio, f0 = cached_inputs(t, tracker)
            rows.append((t, audio, f0, t.reference()))
        return rows
    train, test = load(TRAIN), load(TEST)
    print(f"{len(train)} train takes (players {TRAIN}), {len(test)} test takes (players {TEST})", flush=True)

    seg_p, w = SegmentParams(), FingeringWeights()
    base_tr, base_te = evaluate(train, seg_p, w), evaluate(test, seg_p, w)
    print(f"baseline   train F1={base_tr['f1']:.3f} TDR={base_tr['tdr']:.3f} | test F1={base_te['f1']:.3f} TDR={base_te['tdr']:.3f}", flush=True)
    result = {"baseline": {"train": base_tr, "test": base_te}}

    if a.tune_segment or a.tune_fingering:
        import optuna

        optuna.logging.set_verbosity(optuna.logging.WARNING)
    seg_subset = [r for i, r in enumerate(train) if i % 3 == 0]  # 40 takes, all four players
    if a.tune_segment:
        def obj(trial):
            p = SegmentParams(
                jump_semitones=trial.suggest_float("jump_semitones", 0.4, 1.2),
                confirm_frames_s=trial.suggest_float("confirm_frames_s", 0.008, 0.04),
                max_gap_s=trial.suggest_float("max_gap_s", 0.01, 0.08),
                min_note_s=trial.suggest_float("min_note_s", 0.025, 0.09),
                repick_height=trial.suggest_float("repick_height", 0.2, 0.9),
                repick_min_gap_s=trial.suggest_float("repick_min_gap_s", 0.04, 0.12),
                min_conf=trial.suggest_float("min_conf", 0.05, 0.6),
                silence_db=trial.suggest_float("silence_db", 25, 60),
                onset_search_before_s=trial.suggest_float("onset_search_before_s", 0.02, 0.12),
            )
            return evaluate(seg_subset, p, None)["f1"]
        st = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=0))
        st.enqueue_trial({f.name: getattr(seg_p, f.name) for f in fields(SegmentParams) if f.name in (
            "jump_semitones", "confirm_frames_s", "max_gap_s", "min_note_s", "repick_height", "repick_min_gap_s",
            "min_conf", "silence_db", "onset_search_before_s")})
        st.optimize(obj, n_trials=a.tune_segment, show_progress_bar=False)
        seg_p = SegmentParams(**{**asdict(SegmentParams()), **st.best_params})
        result["segment"] = st.best_params
        print(f"segment tuned: train F1={st.best_value:.3f}", flush=True)

    if a.tune_fingering:
        fixed_notes = segment_all(train, seg_p)  # notes do not depend on the fingering weights

        def obj(trial):
            ww = FingeringWeights(
                open_cost=trial.suggest_float("open_cost", 0.0, 2.0),
                low_fret=trial.suggest_float("low_fret", 0.0, 0.4),
                high_fret=trial.suggest_float("high_fret", 0.0, 0.5),
                very_high_fret=trial.suggest_float("very_high_fret", 0.0, 1.0),
                move=trial.suggest_float("move", 0.05, 1.5),
                string_skip=trial.suggest_float("string_skip", 0.0, 1.5),
                finger=trial.suggest_float("finger", 0.0, 3.0),
                time_scale_s=trial.suggest_float("time_scale_s", 0.1, 2.0),
            )
            return evaluate(train, seg_p, ww, fixed_notes)["tdr"]
        st = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=0))
        st.enqueue_trial({k: getattr(w, k) for k in ("open_cost", "low_fret", "high_fret", "very_high_fret", "move", "string_skip", "finger", "time_scale_s")})
        st.optimize(obj, n_trials=a.tune_fingering, show_progress_bar=False)
        w = FingeringWeights(**{**asdict(FingeringWeights()), **st.best_params})
        result["fingering"] = st.best_params
        print(f"fingering tuned: train TDR={st.best_value:.3f}", flush=True)

    if a.tune_segment or a.tune_fingering:
        tr, te = evaluate(train, seg_p, w), evaluate(test, seg_p, w)
        print(f"tuned      train F1={tr['f1']:.3f} TDR={tr['tdr']:.3f} | test F1={te['f1']:.3f} TDR={te['tdr']:.3f}")
        result["tuned"] = {"train": tr, "test": te}
        Path(a.out).write_text(json.dumps(result, indent=1))
        print("wrote", a.out)


if __name__ == "__main__":
    main()

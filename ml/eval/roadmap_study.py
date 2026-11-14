"""Before / after the improvement roadmap, end to end (notes + strings), on test data only.

    uv run python ml/eval/roadmap_study.py [--weights string_cnn.pt] [--params tuned.json] [--w-audio 0.5]

``before`` = f0-first segmentation + hand-movement prior (pipeline 0.1).
``+ onsets`` = Basic Pitch onsets with the tuned SegmentParams.
``+ strings`` = also the string classifier in the Viterbi (pipeline 0.2).

Headline metric: ``all right`` = reference notes whose pitch, string and fret all came out right,
over every reference note (missed notes count as wrong). Test sets: GuitarSet player 05 (acoustic;
Basic Pitch saw part of it in training) and IDMT-SMT-Guitar licks (electric; unseen by every model).
IDMT is also reported with each method's constant onset latency removed (its labels mark the attack
~30 ms earlier than GuitarSet's).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from taber_ir import assemble
from taber_ir.fusion.viterbi import FingeringWeights
from taber_ir.models import Analysis, AssemblyParams
from taber_ml import strings
from taber_ml.audio.f0 import get_tracker
from taber_ml.audio.onsets import BasicPitchOnsets
from taber_ml.audio.segment import F0FirstSegmenter, SegmentParams
from taber_ml.datasets import guitarset, idmt
from taber_ml.eval import truth_report

sys.path.insert(0, str(Path(__file__).parent))
from guitarset_eval import cached_inputs  # noqa: E402
from onset_study import latency, summarize, truth_of  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--guitarset", default="~/.cache/taber/datasets/guitarset")
    ap.add_argument("--idmt", default="~/.cache/taber/datasets/idmt")
    ap.add_argument("--weights", default=str(strings.WEIGHTS))
    ap.add_argument("--params", default=None, help="JSON of SegmentParams overrides (default: the package defaults)")
    ap.add_argument("--w-audio", type=float, default=None, help="Viterbi weight of the classifier (default: package default)")
    ap.add_argument("--out", default="ml/eval/roadmap_study.json")
    a = ap.parse_args()
    tracker, bp, clf = get_tracker("pesto"), BasicPitchOnsets(), strings.StringClassifier(Path(a.weights))
    old_seg = SegmentParams(**{**asdict(SegmentParams()), **{k: v for k, v in json.loads(
        (Path(__file__).parent / "tuned.json").read_text()).get("segment", {}).items()}})
    new_seg = SegmentParams(**{**asdict(SegmentParams()), **(json.loads(Path(a.params).read_text()) if a.params else {})})
    w_old = asdict(FingeringWeights())
    w_old["w_audio"] = 0.0
    w_new = asdict(FingeringWeights())
    if a.w_audio is not None:
        w_new["w_audio"] = a.w_audio

    sets = {"GuitarSet 05 (acoustic)": guitarset.takes(a.guitarset, "solo", ["05"]),
            "IDMT licks (electric, unseen)": idmt.takes(a.idmt)}
    out: dict = {"w_audio": w_new["w_audio"], "segment_params": asdict(new_seg)}
    for name, ts in sets.items():
        rows = []
        for t in ts:
            audio, f0 = cached_inputs(t, tracker)
            rows.append((audio, f0, truth_of(*t.reference()[:2]), bp.run(audio.y, audio.sr)))
        print(f"{name}: {len(rows)} takes, {sum(len(r[2]) for r in rows)} notes", flush=True)
        variants = {
            "before (0.1)": (F0FirstSegmenter(old_seg), w_old, False),
            "+ onsets": (F0FirstSegmenter(new_seg, onset_model=True), w_old, False),
            "+ onsets + strings (0.2)": (F0FirstSegmenter(new_seg, onset_model=True), w_new, True),
        }
        out[name] = {}
        for vname, (seg, w, use_clf) in variants.items():
            found = []
            for audio, f0, truth, post in rows:
                notes = seg.segment(audio, f0, posteriors=post if seg.onset_model else None).notes
                if use_clf and notes:
                    P = clf.predict(audio.y, audio.sr, [n.onset_s for n in notes], [n.pitch_midi for n in notes])
                    notes = [n.model_copy(update={"string_probs": [float(x) for x in p]}) for n, p in zip(notes, P)]
                found.append((truth, notes))
            for align in ((False, True) if name.startswith("IDMT") else (False,)):
                shift = latency(found) if align else 0.0
                reps = []
                for truth, notes in found:
                    ns = [n.model_copy(update={"onset_s": n.onset_s - shift, "offset_s": n.offset_s - shift}) for n in notes]
                    reps.append(truth_report(truth, ns, assemble(Analysis(notes=ns), AssemblyParams(fingering_weights=w))))
                label = vname + (f" [latency {shift * 1000:+.0f} ms removed]" if align else "")
                out[name][label] = summarize(label, reps)
    Path(a.out).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

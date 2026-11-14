"""Does the string classifier pick better strings than the hand-movement prior alone?

    uv run python ml/eval/string_study.py [--weights path.pt]

Isolated from note detection: the reference notes themselves go through the Viterbi, so the only
thing measured is the string/fret choice. ``classifier`` = argmax of P(string) over playable strings;
``viterbi w=0`` = today's prior only; ``w>0`` adds -w*log P(string).

- GuitarSet player 04: validation (picks the Viterbi weight w_audio). Never trained on.
- GuitarSet player 05 and IDMT-SMT-Guitar licks (electric): test. Never trained or tuned on.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import numpy as np
from taber_ir import assemble
from taber_ir.fusion.viterbi import FingeringWeights
from taber_ir.models import Analysis, AssemblyParams, Tuning
from taber_ir.tuning import open_pitch
from taber_ml import strings
from taber_ml.audio.ingest import load_audio
from taber_ml.datasets import guitarset, idmt
from taber_ml.eval import tab_accuracy

WEIGHTS = [0.0, 0.25, 0.3, 0.5, 1.0, 2.0]


def evaluate(clf, ts, label: str) -> dict:
    opens = np.array([open_pitch(Tuning(), s) for s in range(1, 7)])
    hits = n = 0
    tdr = {w: [] for w in WEIGHTS}
    for t in ts:
        ref, tab = t.reference()[:2]
        if not ref:
            continue
        audio = load_audio(t.audio)
        P = clf.predict(audio.y, audio.sr, [r.onset_s for r in ref], [r.pitch_midi for r in ref])
        frets = np.array([r.pitch_midi for r in ref])[:, None] - opens[None, :]
        P = np.where((frets >= 0) & (frets <= 22), P, 0)
        hits += int(np.sum(P.argmax(1) + 1 == np.array([s for s, _f in tab])))
        n += len(ref)
        notes = [r.model_copy(update={"string_probs": [float(x) for x in p]}) for r, p in zip(ref, P)]
        for w in WEIGHTS:
            fw = asdict(FingeringWeights())
            fw["w_audio"] = w
            score = assemble(Analysis(notes=notes), AssemblyParams(fingering_weights=fw))
            tdr[w].append(tab_accuracy(ref, tab, notes, score)["tab_acc"])
    res = {"notes": n, "classifier_acc": hits / n, **{f"viterbi_w{w:g}": float(np.mean(v)) for w, v in tdr.items()}}
    print(f"{label:<34} {n:5d} notes | classifier alone {res['classifier_acc']:.3f} | Viterbi "
          + "  ".join(f"w={w:g}: {res[f'viterbi_w{w:g}']:.3f}" for w in WEIGHTS), flush=True)
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(strings.WEIGHTS))
    ap.add_argument("--guitarset", default="~/.cache/taber/datasets/guitarset")
    ap.add_argument("--idmt", default="~/.cache/taber/datasets/idmt")
    ap.add_argument("--out", default="ml/eval/string_study.json")
    a = ap.parse_args()
    clf = strings.StringClassifier(Path(a.weights))
    w = Path(a.weights).resolve()
    out = {"weights": str(w.relative_to(Path.cwd().resolve())) if w.is_relative_to(Path.cwd().resolve()) else w.name,
           "version": clf.version}
    out["GuitarSet 04 (validation)"] = evaluate(clf, guitarset.takes(a.guitarset, "solo", ["04"]), "GuitarSet 04 (validation)")
    out["GuitarSet 05 (test)"] = evaluate(clf, guitarset.takes(a.guitarset, "solo", ["05"]), "GuitarSet 05 (test)")
    out["IDMT licks (electric, test)"] = evaluate(clf, idmt.takes(a.idmt), "IDMT licks (electric, test)")
    Path(a.out).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

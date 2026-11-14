"""Beat tracking on guitar alone: librosa vs Beat This!.

    uv run python ml/eval/beat_study.py

- GuitarSet solo takes, all players (guitar only, no drums: the hard case). Beat This! was trained on
  GuitarSet among 16 datasets, so its numbers here are optimistic.
- The project's synthetic licks with a drum/bass backing (ml/eval/synthetic/*.mix.wav): unseen.

``grid`` = share of takes where the tracker trusted its own result (a grid is produced; otherwise the
app falls back to a typed or tapped tempo). ``F`` = mir_eval beat F-measure (+-70 ms) over every take
(0 when no grid). ``tempo`` = estimated tempo within 4% of the truth, or of half/double it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from taber_ml.audio.beats import BeatThisTracker, LibrosaBeatTracker
from taber_ml.audio.ingest import load_audio
from taber_ml.datasets import guitarset


def gs_beats(t) -> tuple[np.ndarray, float]:
    j = json.loads(t.jams.read_text())
    b = next(a for a in j["annotations"] if a["namespace"] == "beat_position")
    return np.array([d["time"] for d in b["data"]]), t.bpm


def synth_items(root: Path):
    for tab in sorted(root.glob("*.tab.json")):
        d = json.loads(tab.read_text())
        stem = tab.name.removesuffix(".tab.json")
        bpm, lead = d.get("bpm", 120), d.get("lead_in_s", 0.5)
        for kind in ("mix", ""):
            wav = root / (f"{stem}.{kind}.wav" if kind else f"{stem}.wav")
            if wav.exists():
                last = max(n["start"] + n["dur"] for n in d["notes"])
                beats = lead + np.arange(int(np.ceil(last)) + 1) * 60 / bpm
                yield f"{stem}{'.' + kind if kind else ''}", wav, beats, bpm


def score(tracker, items) -> dict:
    import mir_eval

    F, grid, tempo_ok = [], [], []
    for _name, wav, ref, bpm in items:
        g = tracker.track(load_audio(wav), None)
        est = np.array(g.beats_s)
        grid.append(bool(len(est)))
        F.append(mir_eval.beat.f_measure(ref, est) if len(est) else 0.0)  # no trim_beats: the licks are only seconds long
        t = g.tempo_bpm or 0
        tempo_ok.append(any(abs(t - bpm * k) <= 0.04 * bpm * k for k in (0.5, 1, 2)))
    return {"takes": len(F), "grid": float(np.mean(grid)), "F": float(np.mean(F)), "tempo": float(np.mean(tempo_ok))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--guitarset", default="~/.cache/taber/datasets/guitarset")
    ap.add_argument("--synthetic", default="ml/eval/synthetic")
    ap.add_argument("--out", default="ml/eval/beat_study.json")
    a = ap.parse_args()
    gs = [(t.name, t.audio, *gs_beats(t)) for t in guitarset.takes(a.guitarset, "solo")]
    sets = {"GuitarSet solos (seen by Beat This!)": gs, "synthetic licks (unseen)": list(synth_items(Path(a.synthetic)))}
    out = {}
    for tracker in (LibrosaBeatTracker(), BeatThisTracker()):
        for name, items in sets.items():
            r = score(tracker, items)
            out[f"{tracker.name} / {name}"] = r
            print(f"{tracker.name:<10} {name:<38} {r['takes']:4d} takes | grid {r['grid']:.0%}  F {r['F']:.3f}  tempo {r['tempo']:.0%}", flush=True)
    Path(a.out).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

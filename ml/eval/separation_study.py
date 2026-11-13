"""Does Demucs separation help transcription when a band plays behind the guitar?

Real guitar (GuitarSet solo takes, CC BY 4.0) + a synthetic band (drums, bass, chord pad) at several levels.
For each mix: transcribe the original, and the result of each stem-selection rule, and score note F1
against GuitarSet's per-note annotations.

    uv run python ml/eval/separation_study.py ~/.cache/taber/datasets/guitarset --takes 12

GuitarSet layout expected: <root>/ann/*.jams and <root>/audio/*_mic.wav (unzip annotation.zip and
audio_mono-mic.zip from https://zenodo.org/records/3371780).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr
from taber_ir.models import NoteEvent
from taber_ml.audio.f0 import get_tracker
from taber_ml.audio.ingest import load_audio
from taber_ml.audio.segment import F0FirstSegmenter
from taber_ml.audio.separation import RULES, DemucsSeparator, _as_audio, load_stereo, select_stems
from taber_ml.eval import note_f1
from taber_ml.synth import mix_with_backing, render_backing


def guitarset_notes(jams_path: Path) -> list[NoteEvent]:
    """All annotated notes (every string) of a GuitarSet take."""
    j = json.loads(jams_path.read_text())
    notes = []
    for ann in j["annotations"]:
        if ann["namespace"] != "note_midi":
            continue
        for obs in ann["data"]:
            notes.append((obs["time"], obs["time"] + obs["duration"], int(round(obs["value"]))))
    notes.sort()
    return [NoteEvent(id=f"r{i}", onset_s=a, offset_s=b, pitch_midi=p) for i, (a, b, p) in enumerate(notes)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("--takes", type=int, default=12)
    ap.add_argument("--levels", default="-6,0,6", help="backing level vs guitar, dB")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--distort", type=float, default=0.0, help="drive the real guitar through tanh(g*x) + cab filter (electric-ish)")
    a = ap.parse_args()

    solos = sorted(a.root.glob("ann/*_solo.jams"))
    random.Random(a.seed).shuffle(solos)
    solos = solos[: a.takes]
    levels = [float(x) for x in a.levels.split(",")]
    sep, trk, seg = DemucsSeparator(), get_tracker("pesto"), F0FirstSegmenter()
    variants = ["original", *RULES]
    scores: dict[tuple[str, float], list[float]] = {(v, lv): [] for v in variants for lv in ["clean", *levels]}

    def f1(audio, ref):
        return note_f1(ref, seg.segment(audio, trk.track(audio.y, audio.sr)).notes).f1

    tmp = Path(tempfile.mkdtemp())
    for jp in solos:
        wav = a.root / "audio" / jp.name.replace(".jams", "_mic.wav")
        if a.distort > 0:
            print(f"(distortion drive {a.distort})", flush=True)
        ref = guitarset_notes(jp)
        bpm = float(re.search(r"-(\d+)-", jp.name).group(1))
        gtr, sr = sf.read(wav, dtype="float32")
        gtr = soxr.resample(gtr, sr, 44100) if sr != 44100 else gtr
        if a.distort > 0:  # emulate a lightly driven amp: soft clip + cabinet low-pass
            from scipy.signal import butter, sosfilt

            g = gtr / (np.max(np.abs(gtr)) or 1.0)
            gtr = sosfilt(butter(4, 5200, fs=44100, output="sos"), np.tanh(a.distort * g) / np.tanh(a.distort)).astype(np.float32)
            wav = tmp / f"{jp.stem}_dist.wav"
            sf.write(wav, gtr, 44100)
        scores[("original", "clean")].append(f1(load_audio(wav), ref))  # after optional distortion
        for lv in levels:
            band = render_backing(len(gtr) / 44100, bpm, seed=a.seed, lead_in_s=0.0)
            p = tmp / f"{jp.stem}_{lv}.wav"
            sf.write(p, mix_with_backing(gtr, band, lv), 44100)
            scores[("original", lv)].append(f1(load_audio(p), ref))
            stems = sep.stems(load_stereo(p))
            for rule in RULES:
                keep = select_stems(stems, rule)
                audio = _as_audio(soxr.resample(sum(stems[k] for k in keep).mean(0), 44100, 22050).astype(np.float32))
                scores[(rule, lv)].append(f1(audio, ref))
        print(f"{jp.stem}: done", flush=True)

    print(f"\nnote F1 over {len(solos)} real GuitarSet solo takes (mean)")
    header = f"{'variant':18s} " + " ".join(f"{('clean' if lv == 'clean' else f'{lv:+.0f} dB'):>8s}" for lv in ["clean", *levels])
    print(header)
    for v in variants:
        cells = []
        for lv in ["clean", *levels]:
            xs = scores[(v, lv)]
            cells.append(f"{np.mean(xs):8.3f}" if xs else f"{'':8s}")
        print(f"{v:18s} " + " ".join(cells))


if __name__ == "__main__":
    main()

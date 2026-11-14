"""Train the string classifier (taber_ml/strings.py) on GuitarSet.

    uv run python ml/train/string_classifier.py --root ~/.cache/taber/datasets/guitarset

Split: players 00-03 train, player 04 validates (early stopping, and later the Viterbi weight),
player 05 and IDMT-SMT-Guitar are never touched here (ml/eval/string_study.py reports on them).

GuitarSet is an acoustic guitar recorded with a mic; the user plays electric. Every take is also
rendered through a crude amp chain (waveshaper drive + cabinet low-pass + EQ tilt) so the network
learns string cues that survive distortion. Patches are cached per take and variant.
"""

from __future__ import annotations

import argparse
import json
import time
import zlib
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt
from taber_ir.models import Tuning
from taber_ir.tuning import open_pitch
from taber_ml import strings
from taber_ml.audio.ingest import load_audio
from taber_ml.datasets.guitarset import takes

CACHE = Path("~/.cache/taber/strings").expanduser()
VARIANTS = ["clean", "drive", "drive_hard", "eq"]
TRAIN, VAL = ["00", "01", "02", "03"], ["04"]


def augment(y: np.ndarray, sr: int, variant: str, rng: np.random.Generator) -> np.ndarray:
    y = y / (np.max(np.abs(y)) + 1e-9)
    if variant == "clean":
        return y
    if variant == "eq":
        lo = sosfilt(butter(2, rng.uniform(1500, 6000), "lowpass", fs=sr, output="sos"), y)
        hi = sosfilt(butter(2, rng.uniform(150, 600), "highpass", fs=sr, output="sos"), y)
        mix = rng.uniform(0.2, 0.8)
        return mix * lo + (1 - mix) * hi
    g = rng.uniform(3, 10) if variant == "drive" else rng.uniform(15, 40)
    y = sosfilt(butter(2, 100, "highpass", fs=sr, output="sos"), y)  # amp input coupling
    y = np.tanh(g * y) / np.tanh(g)
    cab = rng.uniform(3500, 6500)  # 4x12-ish cabinet roll-off
    y = sosfilt(butter(4, cab, "lowpass", fs=sr, output="sos"), y)
    return y + rng.normal(0, 10 ** (rng.uniform(-70, -50) / 20), len(y))


def take_features(t, variant: str) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{t.name}_{variant}.npz"
    if f.exists():
        return dict(np.load(f))
    audio = load_audio(t.audio)
    rng = np.random.default_rng(zlib.crc32(f"{t.name}/{variant}".encode()))
    y = augment(audio.y, audio.sr, variant, rng)
    ref, tab = t.reference()
    X = strings.patches(strings.cqt_db(y, audio.sr), [n.onset_s for n in ref], [n.pitch_midi for n in ref])
    d = {"X": X.astype(np.float16), "pitch": np.array([n.pitch_midi for n in ref], np.float32),
         "string": np.array([s for s, _f in tab], np.int64)}
    np.savez(f, **d)
    return d


def stack(ts, variants):
    parts = [take_features(t, v) for t in ts for v in variants]
    return (np.concatenate([p["X"] for p in parts]).astype(np.float32), np.concatenate([p["pitch"] for p in parts]),
            np.concatenate([p["string"] for p in parts]))


def playable_mask(pitch: np.ndarray, max_fret: int = 22) -> np.ndarray:
    tun = Tuning()
    opens = np.array([open_pitch(tun, s) for s in range(1, 7)])
    fret = pitch[:, None] - opens[None, :]
    return (fret >= 0) & (fret <= max_fret)


def main() -> None:
    import torch
    from torch import nn

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="~/.cache/taber/datasets/guitarset")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--comp", action="store_true", help="also train on the comping takes (chords)")
    ap.add_argument("--out", default=str(strings.WEIGHTS))
    a = ap.parse_args()
    torch.manual_seed(0)
    np.random.seed(0)

    tr_takes = takes(a.root, "solo", TRAIN) + (takes(a.root, "comp", TRAIN) if a.comp else [])
    va_takes = takes(a.root, "solo", VAL)
    t0 = time.perf_counter()
    Xtr, Ptr, Str = stack(tr_takes, VARIANTS)
    Xva, Pva, Sva = stack(va_takes, ["clean", "drive"])
    print(f"features: train {len(Xtr)} patches, val {len(Xva)} ({time.perf_counter() - t0:.0f}s)", flush=True)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    net = strings.build_net().to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=a.epochs * (len(Xtr) // 256 + 1))
    Mtr, Mva = playable_mask(Ptr), playable_mask(Pva)
    tX, tP, tS, tM = (torch.from_numpy(v) for v in (Xtr, Ptr, Str - 1, Mtr))
    vX, vP, vS, vM = (torch.from_numpy(v).to(dev) for v in (Xva, Pva, Sva - 1, Mva))
    ce = nn.CrossEntropyLoss()

    def masked(logits, m):
        return logits.masked_fill(~m, -1e4)

    best, best_state = 0.0, None
    for ep in range(a.epochs):
        net.train()
        perm = torch.randperm(len(tX))
        tot = 0.0
        for b in range(0, len(perm), 256):
            i = perm[b : b + 256]
            x = tX[i].to(dev)
            # SpecAugment-style: blank a random band of partials (never the fundamental's rows)
            f0 = np.random.randint(10, x.shape[2] - 8)
            x[:, :, f0 : f0 + np.random.randint(0, 8)] = 0
            loss = ce(masked(net(x, tP[i].to(dev)), tM[i].to(dev)), tS[i].to(dev))
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += float(loss) * len(i)
        net.eval()
        with torch.no_grad():
            pred = torch.cat([masked(net(vX[b : b + 1024], vP[b : b + 1024]), vM[b : b + 1024]).argmax(1)
                              for b in range(0, len(vX), 1024)])
            acc = float((pred == vS).float().mean())
        if acc > best:
            best, best_state = acc, {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}
        print(f"epoch {ep + 1:2d}  loss {tot / len(tX):.3f}  val string acc {acc:.3f}", flush=True)

    meta = {"version": time.strftime("%Y%m%d"), "train_players": TRAIN, "val_players": VAL, "val_string_acc": round(best, 4),
            "variants": VARIANTS, "comp": a.comp, "data": "GuitarSet (CC BY 4.0)"}
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": best_state, **meta}, a.out)
    print(f"saved {a.out}: best val string accuracy {best:.3f}")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()

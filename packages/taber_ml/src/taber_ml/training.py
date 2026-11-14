"""Train the string classifier (taber_ml/strings.py) on GuitarSet: ``taber train-strings``.

    taber train-strings --root ~/.cache/taber/datasets/guitarset                          # base (laptop)
    taber train-strings --root /kaggle/tmp/guitarset --download --size large --seeds 2   # Kaggle T4 x2

Split: players 00-03 train, player 04 validates (best epoch, and later the Viterbi weight). Player 05
and IDMT-SMT-Guitar are never touched here (ml/eval/string_study.py reports on them).

GuitarSet is an acoustic guitar. Every take is also rendered through a crude amp chain (waveshaper
drive + cabinet low-pass + EQ) so the network learns string cues that survive distortion; the large
model also trains on the pickup recording of every take (``--sources mic,mix``), closer to an electric.

Seeds train in separate processes, one per GPU (Kaggle gives two), and are saved together as an
ensemble whose probabilities are averaged at inference. Patches are cached per take, source and
variant, so a second run (or the other seeds) skips the CQTs.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import zlib
from pathlib import Path

import numpy as np

from . import strings

TRAIN, VAL = ["00", "01", "02", "03"], ["04"]
VARIANTS = {
    "base": ["clean", "drive", "drive_hard", "eq"],
    "large": ["clean", "eq", "drive", "drive_b", "drive_hard", "drive_hard_b"],
}
EPOCHS = {"base": 40, "large": 60}


def augment(y: np.ndarray, sr: int, variant: str, rng: np.random.Generator) -> np.ndarray:
    from scipy.signal import butter, sosfilt

    y = y / (np.max(np.abs(y)) + 1e-9)
    kind = variant.split("_b")[0]  # drive_b = another random amp setting of the same kind
    if kind == "clean":
        return y
    if kind == "eq":
        lo = sosfilt(butter(2, rng.uniform(1500, 6000), "lowpass", fs=sr, output="sos"), y)
        hi = sosfilt(butter(2, rng.uniform(150, 600), "highpass", fs=sr, output="sos"), y)
        mix = rng.uniform(0.2, 0.8)
        return mix * lo + (1 - mix) * hi
    g = rng.uniform(3, 10) if kind == "drive" else rng.uniform(15, 40)
    y = sosfilt(butter(2, 100, "highpass", fs=sr, output="sos"), y)  # amp input coupling
    y = np.tanh(g * y) / np.tanh(g)
    y = sosfilt(butter(4, rng.uniform(3500, 6500), "lowpass", fs=sr, output="sos"), y)  # cabinet roll-off
    return y + rng.normal(0, 10 ** (rng.uniform(-70, -50) / 20), len(y))


def take_features(t, source: str, variant: str, size: strings.Size, cache: Path) -> dict:
    from .audio.ingest import load_audio

    cache.mkdir(parents=True, exist_ok=True)
    tag = "" if size.name == "base" else f"_{size.name}"
    f = cache / f"{t.name}{'' if source == 'mic' else '_' + source}_{variant}{tag}.npz"
    if f.exists():
        return dict(np.load(f))
    audio = load_audio(t.audio)
    rng = np.random.default_rng(zlib.crc32(f"{t.name}/{source}/{variant}".encode()))
    y = augment(audio.y, audio.sr, variant, rng)
    ref, tab = t.reference()
    X = strings.patches(strings.cqt_db(y, audio.sr), [n.onset_s for n in ref], [n.pitch_midi for n in ref], size)
    d = {"X": X.astype(np.float16), "pitch": np.array([n.pitch_midi for n in ref], np.float32),
         "string": np.array([s for s, _f in tab], np.int64)}
    np.savez(f, **d)
    return d


def dataset(root: str, players: list[str], kinds: list[str], sources: list[str], variants: list[str],
            size: strings.Size, cache: Path):
    from .datasets.guitarset import takes

    parts = []
    for src in sources:
        for kind in kinds:
            for t in takes(root, kind, players, source=src):
                for v in variants:
                    parts.append(take_features(t, src, v, size, cache))
    if not parts:
        raise ValueError(f"no GuitarSet takes under {root} for players {players} (sources {sources})")
    return (np.concatenate([p["X"] for p in parts]).astype(np.float32), np.concatenate([p["pitch"] for p in parts]),
            np.concatenate([p["string"] for p in parts]))


def playable_mask(pitch: np.ndarray, max_fret: int = 22) -> np.ndarray:
    from taber_ir.models import Tuning
    from taber_ir.tuning import open_pitch

    opens = np.array([open_pitch(Tuning(), s) for s in range(1, 7)])
    fret = pitch[:, None] - opens[None, :]
    return (fret >= 0) & (fret <= max_fret)


def train_one(a: argparse.Namespace, seed: int, out: Path) -> float:
    """One network, one seed; the best epoch on player 04 is saved to ``out``. Returns its accuracy."""
    import torch
    from torch import nn

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    size = strings.SIZES[a.size]
    cache = Path(a.cache).expanduser()
    kinds = ["solo", "comp"] if a.comp else ["solo"]
    Xtr, Ptr, Str = dataset(a.root, TRAIN, kinds, a.sources, VARIANTS[a.size], size, cache)
    Xva, Pva, Sva = dataset(a.root, VAL, ["solo"], ["mic"], ["clean", "drive"], size, cache)
    print(f"[seed {seed}] train {len(Xtr)} patches, val {len(Xva)}", flush=True)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    net = strings.build_net(size).to(dev)
    epochs = a.epochs or EPOCHS[a.size]
    bs = 256
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-3 if a.size == "base" else 5e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=epochs * (len(Xtr) // bs + 1))
    Mtr, Mva = playable_mask(Ptr), playable_mask(Pva)
    tX, tP, tS, tM = (torch.from_numpy(v) for v in (Xtr, Ptr, Str - 1, Mtr))
    vX, vP, vS, vM = (torch.from_numpy(v).to(dev) for v in (Xva, Pva, Sva - 1, Mva))
    ce = nn.CrossEntropyLoss()  # no label smoothing: it would push mass onto the masked (unplayable) strings

    def masked(logits, m):
        return logits.masked_fill(~m, -1e4)

    best, best_state = -1.0, None
    for ep in range(epochs):
        net.train()
        perm = torch.from_numpy(rng.permutation(len(tX)))
        tot = 0.0
        for b in range(0, len(perm), bs):
            i = perm[b : b + bs]
            x = tX[i].to(dev)
            f0 = int(rng.integers(10, x.shape[2] - 8))  # blank a random band of partials (never the fundamental)
            x[:, :, f0 : f0 + int(rng.integers(0, 8))] = 0
            if a.size == "large":  # and a few frames of the decay
                t0 = int(rng.integers(size.pre_frames + 8, x.shape[1] - 4))
                x[:, t0 : t0 + int(rng.integers(0, 6)), :] = 0
            loss = ce(masked(net(x, tP[i].to(dev)), tM[i].to(dev)), tS[i].to(dev))
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item() * len(i)
        net.eval()
        with torch.no_grad():
            pred = torch.cat([masked(net(vX[b : b + 1024], vP[b : b + 1024]), vM[b : b + 1024]).argmax(1)
                              for b in range(0, len(vX), 1024)])
            acc = float((pred == vS).float().mean())
        if acc > best:
            best, best_state = acc, {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}
        print(f"[seed {seed}] epoch {ep + 1:2d}  loss {tot / len(tX):.3f}  val string acc {acc:.3f}", flush=True)
    torch.save({"state_dict": best_state, "size": a.size, "val_string_acc": best, "seed": seed}, out)
    return best


def merge(parts: list[Path], out: Path, meta: dict) -> dict:
    import torch

    cks = [torch.load(p, map_location="cpu", weights_only=True) for p in parts]
    info = {**meta, "seeds": [c["seed"] for c in cks], "val_string_acc_per_seed": [round(c["val_string_acc"], 4) for c in cks]}
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dicts": [c["state_dict"] for c in cks], **info}, out)
    return info


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="taber train-strings", description="train the string classifier on GuitarSet")
    ap.add_argument("--root", default="~/.cache/taber/datasets/guitarset")
    ap.add_argument("--download", action="store_true", help="fetch GuitarSet from Zenodo first (CC BY 4.0)")
    ap.add_argument("--size", choices=sorted(strings.SIZES), default="base")
    ap.add_argument("--seeds", type=int, default=1, help="ensemble members (one per GPU at a time)")
    ap.add_argument("--epochs", type=int, default=0, help="0 = the size's default")
    ap.add_argument("--comp", action="store_true", help="also train on the comping takes (chords)")
    ap.add_argument("--sources", default=None, help="mic,mix (default: mic for base, mic,mix for large)")
    ap.add_argument("--cache", default="~/.cache/taber/strings")
    ap.add_argument("--out", default=None, help="checkpoint (default: the package weights for this size)")
    ap.add_argument("--gpus", default=None, help="CUDA indices for the seeds, e.g. 0,1 (default: all visible)")
    ap.add_argument("--seed-index", type=int, default=None, help=argparse.SUPPRESS)  # internal: one child process
    a = ap.parse_args(argv)
    a.sources = (a.sources or ("mic,mix" if a.size == "large" else "mic")).split(",")
    out = Path(a.out or (strings.WEIGHTS_LARGE if a.size == "large" else strings.WEIGHTS)).expanduser()

    if a.seed_index is not None:  # child: train one seed, write <out>.seed<k>
        train_one(a, a.seed_index, out.with_name(f"{out.name}.seed{a.seed_index}"))
        return 0

    if a.download:
        from .datasets.guitarset import download

        parts = ("annotation.zip", "audio_mono-mic.zip") + (("audio_mono-pickup_mix.zip",) if "mix" in a.sources else ())
        download(a.root, parts)
    t0 = time.time()
    if a.seeds == 1:
        acc = train_one(a, 0, out.with_name(out.name + ".seed0"))
        print(f"seed 0: best val {acc:.3f}")
    else:
        # build the feature cache once, then one child process per seed, each pinned to one GPU
        size = strings.SIZES[a.size]
        kinds = ["solo", "comp"] if a.comp else ["solo"]
        dataset(a.root, TRAIN, kinds, a.sources, VARIANTS[a.size], size, Path(a.cache).expanduser())
        dataset(a.root, VAL, ["solo"], ["mic"], ["clean", "drive"], size, Path(a.cache).expanduser())
        try:
            import torch

            visible = list(range(torch.cuda.device_count()))
        except ImportError:
            visible = []
        gpus = [int(g) for g in a.gpus.split(",")] if a.gpus else (visible or [None])
        base_args = [arg for arg in (argv if argv is not None else sys.argv[1:]) if arg != "--download"]
        pending = list(range(a.seeds))
        while pending:
            procs = []
            for g in gpus:
                if not pending:
                    break
                k = pending.pop(0)
                env = dict(os.environ)
                if g is not None:
                    env["CUDA_VISIBLE_DEVICES"] = str(g)
                cmd = [sys.executable, "-m", "taber_ml.training", *base_args, "--seed-index", str(k)]
                print(f"+ seed {k} on {'cuda:' + str(g) if g is not None else 'cpu'}", flush=True)
                procs.append(subprocess.Popen(cmd, env=env))
            for p in procs:
                if p.wait() != 0:
                    raise SystemExit(f"a seed failed (exit {p.returncode})")
    seeds = sorted(out.parent.glob(out.name + ".seed*"))
    meta = {"version": time.strftime("%Y%m%d"), "size": a.size, "train_players": TRAIN, "val_players": VAL,
            "sources": a.sources, "variants": VARIANTS[a.size], "comp": a.comp, "data": "GuitarSet (CC BY 4.0)",
            "train_minutes": round((time.time() - t0) / 60, 1)}
    info = merge(seeds, out, meta)
    for s in seeds:
        s.unlink()
    print(f"saved {out.name}: {json.dumps(info)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

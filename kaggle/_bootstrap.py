"""Shared by the Kaggle scripts: install the project from the `taber-wheels` dataset.

The wheels hold only our two packages (taber-ir, taber-ml), with the Basic Pitch onset model and the
string classifier inside taber-ml. Everything else (pesto-pitch, torchcrepe, demucs, beat-this,
onnxruntime...) comes from PyPI, so the notebook needs Internet ON. PESTO and CREPE ship their weights
inside the pip packages; Demucs downloads htdemucs_6s (~80 MB) and Beat This! its final0 checkpoint
(~78 MB) on first use.
"""
import glob
import os
import subprocess
import sys

INPUT = "/kaggle/input"


def find_input(slug: str, pattern: str = "*") -> str:
    """Where an attached dataset is mounted. Kaggle has used /kaggle/input/<slug> and nested layouts
    (e.g. /kaggle/input/datasets/<owner>/<slug>), so search instead of assuming one."""
    for d in [f"{INPUT}/{slug}", *sorted(glob.glob(f"{INPUT}/**/{slug}", recursive=True))]:
        if os.path.isdir(d) and glob.glob(f"{d}/**/{pattern}", recursive=True):
            return d
    return f"{INPUT}/{slug}"


MODELS = ("pesto-pitch", "torchcrepe", "demucs", "beat-this", "mediapipe", "opencv-python-headless")


def install(extras: tuple[str, ...] = MODELS) -> None:
    """Our two wheels plus ``extras`` from PyPI (the analysis models; training needs none of them)."""
    found = sorted(glob.glob(f"{INPUT}/**/taber_ml-*.whl", recursive=True))
    if not found:
        print("contents of /kaggle/input:", [p for p in glob.glob(f"{INPUT}/**", recursive=True)][:50], flush=True)
        sys.exit("no taber wheels under /kaggle/input: attach the 'taber-wheels' dataset to this notebook")
    wheels_dir = os.path.dirname(found[-1])
    # do not touch Kaggle's torch/numpy: they satisfy our unpinned requirements
    cmd = [sys.executable, "-m", "pip", "install", "--quiet", "--find-links", wheels_dir, "taber-ir", "taber-ml", *extras]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def gpus() -> list[int]:
    import torch

    return list(range(torch.cuda.device_count()))


def on_kaggle() -> bool:
    return os.path.isdir("/kaggle/working")

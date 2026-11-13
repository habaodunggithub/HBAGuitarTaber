"""Shared by the Kaggle scripts: install the project from the `taber-wheels` dataset.

The wheels hold only our two packages (taber-ir, taber-ml). Everything else (pesto-pitch,
torchcrepe, demucs...) comes from PyPI, so the notebook needs Internet ON. PESTO and CREPE ship their
weights inside the pip packages; Demucs downloads htdemucs_6s (~80 MB) on first use.
"""
import glob
import os
import subprocess
import sys

WHEELS = "/kaggle/input/taber-wheels"


def install() -> None:
    wheels = sorted(glob.glob(f"{WHEELS}/*.whl"))
    if not wheels:
        sys.exit(f"no wheels in {WHEELS}: attach the 'taber-wheels' dataset to this notebook")
    # do not touch Kaggle's torch/numpy: they satisfy our unpinned requirements
    cmd = [sys.executable, "-m", "pip", "install", "--quiet", "--find-links", WHEELS,
           "taber-ir", "taber-ml", "pesto-pitch", "torchcrepe", "demucs", "mediapipe", "opencv-python-headless"]
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def gpus() -> list[int]:
    import torch

    return list(range(torch.cuda.device_count()))


def on_kaggle() -> bool:
    return os.path.isdir("/kaggle/working")

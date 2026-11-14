"""Train the large string classifier on Kaggle (T4 x2): one ensemble member per GPU.

Downloads GuitarSet (CC BY 4.0) from Zenodo: annotations, the microphone audio and the pickup audio
(~1.4 GB, needs Internet ON). Trains on players 00-03, picks each member's best epoch on player 04.
Output: /kaggle/working/string_cnn_large.pt and train_log.txt. Fetch them with
    kaggle kernels output YOUR_KAGGLE_USERNAME/taber-train-strings -p kaggle_out/
then measure on the laptop before installing (see kaggle/README.md):
    uv run python ml/eval/string_study.py --weights kaggle_out/string_cnn_large.pt
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bootstrap  # noqa: E402

_bootstrap.install(extras=())  # training needs only taber-ml (and Kaggle's torch)

seeds = os.environ.get("TABER_SEEDS", "2")
cmd = ["taber", "train-strings", "--download", "--root", "/tmp/guitarset", "--cache", "/tmp/strings",
       "--size", "large", "--seeds", seeds, "--out", "/kaggle/working/string_cnn_large.pt"]
print("+", " ".join(cmd), flush=True)
with open("/kaggle/working/train_log.txt", "w") as log:
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        print(line, end="", flush=True)
        log.write(line)
sys.exit(p.wait())

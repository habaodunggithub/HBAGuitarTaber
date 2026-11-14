"""Transcribe every recording in the attached `taber-takes` dataset, one worker per GPU (T4 x2).

Files:  name.wav [+ name.di.wav]  ->  /kaggle/working/out/name/{analysis.json.gz, score.json, name.gp5, ...}
Results are written file by file, so if the session is killed re-run the notebook: finished files are skipped.
Download with `kaggle kernels output <user>/taber-batch -p ./out` and feed analysis.json.gz to `taber assemble`.
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bootstrap  # noqa: E402

_bootstrap.install()

SRC = os.environ.get("TABER_TAKES") or _bootstrap.find_input("taber-takes", "*.wav")
OUT = "/kaggle/working/out"
gpus = ",".join(str(g) for g in _bootstrap.gpus()) or "cpu"
cmd = ["taber", "batch", SRC, "-o", OUT, "--gpus", gpus, "--tone", os.environ.get("TABER_TONE", "distortion_light")]
print("+", " ".join(cmd), flush=True)
sys.exit(subprocess.run(cmd).returncode)

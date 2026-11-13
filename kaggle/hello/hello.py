"""Kaggle environment check: run this first after any change to the notebook image or the wheels.

Prints Python / torch / GPU info, installs taber from the `taber-wheels` dataset, then transcribes a
synthetic solo on every GPU and writes a report to /kaggle/working/hello_report.json.
"""
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bootstrap  # noqa: E402

OUT = "/kaggle/working" if _bootstrap.on_kaggle() else "./hello_out"
os.makedirs(OUT, exist_ok=True)
report: dict = {"python": platform.python_version(), "platform": platform.platform()}

try:
    urllib.request.urlopen("https://pypi.org/simple/pip/", timeout=10)
    report["internet"] = True
except Exception as e:  # noqa: BLE001
    sys.exit(f"Internet is OFF for this notebook ({e}). Turn it on in the notebook settings.")

_bootstrap.install()

import torch  # noqa: E402

report["torch"] = torch.__version__
report["cuda"] = torch.cuda.is_available()
report["gpus"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]
report["ffmpeg"] = bool(shutil.which("ffmpeg"))
print(json.dumps(report, indent=1), flush=True)

# a tiny ground-truth solo, rendered and transcribed on every GPU
tab = {"bpm": 100, "notes": [
    {"string": s, "fret": f, "start": i * 0.5, "dur": 0.5}
    for i, (s, f) in enumerate([(2, 8), (2, 10), (1, 5), (1, 8), (1, 10), (1, 8), (1, 5), (2, 8)] * 4)]}
work = os.path.join(OUT, "hello_work")
os.makedirs(work, exist_ok=True)
tab_path = os.path.join(work, "hello.tab.json")
json.dump(tab, open(tab_path, "w"))
subprocess.run(["taber", "synth", tab_path, "-o", work], check=True)

report["runs"] = []
for g in _bootstrap.gpus() or [None]:
    env = dict(os.environ, CUDA_VISIBLE_DEVICES="" if g is None else str(g))
    t0 = time.time()
    r = subprocess.run(["taber", "eval", work, "--only", "wet", "--tracker", "auto"], env=env, capture_output=True, text=True)
    print(r.stdout[-1500:], r.stderr[-500:], flush=True)
    report["runs"].append({"gpu": g, "seconds": round(time.time() - t0, 1), "ok": r.returncode == 0,
                           "last_line": (r.stdout.strip().splitlines() or [""])[-1]})
json.dump(report, open(os.path.join(OUT, "hello_report.json"), "w"), indent=1)
print(json.dumps(report, indent=1))
sys.exit(0 if all(x["ok"] for x in report["runs"]) else 1)

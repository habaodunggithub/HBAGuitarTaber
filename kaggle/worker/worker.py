"""Pull worker on Kaggle: one process per GPU polls your laptop's API and runs the analysis jobs.

Needs two Kaggle Secrets (Add-ons -> Secrets, attached to this notebook):
  TABER_API_URL        public URL of the tunnel that exposes ONLY /api/v1/worker/*  (https://...)
  TABER_WORKER_TOKEN   the content of data/worker_token on the laptop
Exits by itself after IDLE_EXIT seconds without a job: Kaggle bills session time, not utilisation.
"""
import os
import signal
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _bootstrap  # noqa: E402


def secret(name: str) -> str:
    try:
        from kaggle_secrets import UserSecretsClient

        return UserSecretsClient().get_secret(name)
    except Exception:  # noqa: BLE001 - not on Kaggle, or secret not attached: fall back to the environment
        v = os.environ.get(name)
        if not v:
            sys.exit(f"secret {name} is missing: attach it to the notebook (Add-ons -> Secrets)")
        return v


API = secret("TABER_API_URL").rstrip("/")
TOKEN = secret("TABER_WORKER_TOKEN")
IDLE_EXIT = os.environ.get("IDLE_EXIT", "600")

_bootstrap.install()
procs = []
for g in _bootstrap.gpus() or [None]:
    env = dict(os.environ, CUDA_VISIBLE_DEVICES="" if g is None else str(g), TABER_WORKER_TOKEN=TOKEN)
    cmd = ["taber", "worker", "--api", API, "--location", "kaggle", "--id", f"kaggle-gpu{g}",
           "--idle-exit", IDLE_EXIT, "--cache-dir", "/kaggle/working/cache"]
    print("+", " ".join(cmd), flush=True)  # the token goes through the environment, never the command line
    procs.append(subprocess.Popen(cmd, env=env))


def stop(*_):
    for p in procs:
        p.terminate()


signal.signal(signal.SIGTERM, stop)
sys.exit(max(p.wait() for p in procs))

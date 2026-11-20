"""Desktop launcher: run the API or the worker as a child of the desktop app (docs/adr/ADR-011-desktop-app.md).

    python launch.py api                 -> app.main:run()          (same as `taber-api`)
    python launch.py worker [ARGS...]    -> taber_ml.cli worker ... (same as `taber worker`)
    python launch.py check               -> JSON: what this runtime can do (after an install)
    python launch.py fetch-models        -> download the model files the packages need, JSON lines of progress

Not part of the pipeline: it only calls the existing entry points. What it adds is a watchdog: when the desktop
app that started it disappears (crash, kill -9, power button), the child exits too instead of holding the port
and the SQLite file. The parent's pid comes in TABER_DESKTOP_PARENT_PID.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time


def _parent_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:  # exists, owned by someone else (cannot happen for our parent, but be safe)
        return True
    return True


def _watch_parent(pid: int) -> None:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        synchronize, infinite = 0x00100000, 0xFFFFFFFF
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        handle = k32.OpenProcess(synchronize, False, pid)
        if not handle:
            return  # cannot watch: the app's own shutdown still stops us
        k32.WaitForSingleObject(handle, infinite)  # returns when the parent exits; the handle pins its pid
    else:
        first_ppid = os.getppid()
        while _parent_alive(pid) and os.getppid() == first_ppid:
            time.sleep(1.0)
    try:  # the app read our stderr: with it gone, writing raises BrokenPipeError
        print("desktop app is gone, exiting", file=sys.stderr, flush=True)
    except Exception:  # noqa: BLE001
        pass
    finally:
        os._exit(3)


def check() -> int:
    import app.main  # noqa: F401  - an install that cannot import the API is broken
    import taber_ml.pipeline  # noqa: F401

    info: dict = {"python": sys.version.split()[0], "torch": None, "cuda": False, "gpu": None, "gpuNote": None}
    try:
        import torch

        info["torch"] = torch.__version__
    except ImportError:
        pass
    else:
        from taber_ml.device import cuda_status

        ok, why = cuda_status()  # runs a test kernel: a GPU this build cannot drive reports False
        info["cuda"], info["gpu"] = ok, why if ok else None
        if not ok and torch.cuda.is_available():
            info["gpuNote"] = why
    print(json.dumps(info), flush=True)
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    parent = os.environ.get("TABER_DESKTOP_PARENT_PID")
    if parent and parent.isdigit():
        threading.Thread(target=_watch_parent, args=(int(parent),), daemon=True, name="parent-watch").start()
    role, rest = argv[0], argv[1:]
    if role == "api":
        from app.main import run

        run()
        return 0
    if role == "worker":
        from taber_ml.cli import main as cli

        return cli(["worker", *rest])
    if role == "check":
        return check()
    if role == "fetch-models":
        import socket

        from taber_ml.weights import fetch_all

        socket.setdefaulttimeout(60)
        return fetch_all()
    print(f"unknown role {role!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

"""Model files downloaded on first use: Demucs (separation), Beat This! (beats), MediaPipe (hands).

The libraries download them themselves through urllib with no timeout, so on a slow or stalled link a
first analysis could wait forever with nothing on screen. Here every file is fetched with a read timeout,
retries that resume where the last attempt stopped (HTTP Range), a size and hash check, and a progress
callback, into the exact place the library looks for it, so the library never goes to the network.

``python -m taber_ml.weights`` (or the desktop app's ``launch.py fetch-models``) fetches what the
installed packages need ahead of time.
"""

from __future__ import annotations

import hashlib
import http.client
import importlib.util
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("taber.weights")

Progress = Callable[[int, int], None]  # (bytes done, bytes total)


class WeightsError(RuntimeError):
    pass


def _torch_checkpoints() -> Path:
    """torch.hub's checkpoint folder, resolved the way torch does it, without importing torch."""
    home = os.environ.get("TORCH_HOME") or os.path.join(os.environ.get("XDG_CACHE_HOME", "~/.cache"), "torch")
    return Path(home).expanduser() / "hub" / "checkpoints"


def _taber_models() -> Path:
    return Path(os.environ.get("TABER_CACHE_DIR", "~/.cache/taber")).expanduser() / "models"


@dataclass(frozen=True)
class Weight:
    key: str
    label: str  # shown while it downloads
    url: str
    size: int  # expected bytes: progress has a total before the server answers, and a short file is caught
    sha256_prefix: str | None  # Demucs names its files after the hash; the others publish none
    folder: Callable[[], Path]
    filename: str
    needs: tuple[str, ...]  # import names: the file is only useful when these are installed

    @property
    def path(self) -> Path:
        return self.folder() / self.filename

    def installed(self) -> bool:
        return all(importlib.util.find_spec(m) is not None for m in self.needs)


WEIGHTS: dict[str, Weight] = {
    w.key: w
    for w in (
        # htdemucs_6s = one model, signature 5c90dfd2 (demucs/remote/htdemucs_6s.yaml, files.txt)
        Weight("demucs", "backing-track separation model",
               "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th",
               54_996_327, "34c22ccb", _torch_checkpoints, "5c90dfd2-34c22ccb.th", ("demucs", "torch")),
        # beat_this.inference.load_checkpoint("final0") caches it under this name
        Weight("beat_this", "beat model",
               "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt",
               81_058_141, None, _torch_checkpoints, "beat_this-final0.ckpt", ("beat_this", "torch")),
        Weight("hands", "hand model",
               "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
               7_819_105, None, _taber_models, "hand_landmarker.task", ("mediapipe",)),
    )
}

READ_TIMEOUT_S = 30.0  # a read that waits this long counts as a stalled link: retry
ATTEMPTS = 8
REPORT_EVERY_S = 0.5


def _hash_prefix(path: Path, n: int) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:n]


def download(url: str, dest: Path, size: int, progress: Progress | None = None, sha256_prefix: str | None = None,
             attempts: int = ATTEMPTS, timeout: float = READ_TIMEOUT_S) -> Path:
    """``url`` -> ``dest`` through ``dest.part``, resuming across attempts. Raises WeightsError."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    last_err: Exception | None = None
    last_report = 0.0
    total = size
    for attempt in range(attempts):
        have = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": "HBA-Guitar-Taber"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                if have and r.status != 206:  # the server ignored the range: start over
                    have = 0
                length = r.headers.get("Content-Length")
                if length and length.isdigit():
                    total = have + int(length)
                with open(part, "ab" if have else "wb") as f:
                    done = have
                    while chunk := r.read(1 << 16):
                        f.write(chunk)
                        done += len(chunk)
                        now = time.monotonic()
                        if progress and now - last_report >= REPORT_EVERY_S:
                            last_report = now
                            progress(done, max(total, done))
            if part.stat().st_size >= total:
                break
            last_err = WeightsError(f"the connection closed after {part.stat().st_size} of {total} bytes")
        except urllib.error.HTTPError as e:
            if e.code == 416:  # nothing left to send: what we have is the whole file, or garbage
                whole = (e.headers.get("Content-Range") or "").rpartition("/")[2]
                if whole.isdigit() and int(whole) == have:
                    total = have
                    break
                part.unlink(missing_ok=True)
            elif 400 <= e.code < 500 and e.code not in (408, 429):
                raise WeightsError(f"{url} answered {e.code}") from e
            last_err = e
        except (OSError, http.client.HTTPException) as e:  # URLError, timeouts, resets
            last_err = e
        wait = min(2.0 ** attempt, 30.0)
        log.warning("download of %s interrupted (%s), retrying in %.0fs", dest.name, last_err, wait)
        time.sleep(wait)
    else:
        raise WeightsError(f"could not download {dest.name}: {last_err}")
    if progress:
        progress(part.stat().st_size, part.stat().st_size)
    if sha256_prefix and _hash_prefix(part, len(sha256_prefix)) != sha256_prefix:
        part.unlink(missing_ok=True)
        raise WeightsError(f"{dest.name} arrived damaged (hash mismatch); it will be downloaded again next time")
    part.replace(dest)
    return dest


def ensure(key: str, progress: Progress | None = None) -> Path:
    """The local path of model file ``key``, downloaded first when missing. Raises WeightsError."""
    w = WEIGHTS[key]
    if w.path.exists():
        return w.path
    log.info("downloading the %s (%s)", w.label, w.url)
    return download(w.url, w.path, w.size, progress, w.sha256_prefix)


def missing() -> list[Weight]:
    """The files the installed packages will want and that are not here yet."""
    return [w for w in WEIGHTS.values() if w.installed() and not w.path.exists()]


def mb(n: int) -> str:
    return f"{n / 1e6:.0f} MB" if n >= 1e6 else f"{n / 1e3:.0f} kB"


def fetch_all(out=sys.stdout) -> int:
    """Fetch every missing file, one JSON line per progress tick. 0 when all are here, 1 if some failed."""
    failed = 0
    for w in missing():
        def tick(done: int, total: int, w: Weight = w) -> None:
            print(json.dumps({"model": w.label, "done": done, "total": total}), file=out, flush=True)

        try:
            ensure(w.key, tick)
        except WeightsError as e:
            failed += 1
            print(json.dumps({"model": w.label, "error": str(e)}), file=out, flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    raise SystemExit(fetch_all())

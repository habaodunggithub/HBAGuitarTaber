"""Pull worker (docs §8.5-8.6): lease -> download -> run_analysis -> submit.

Only outbound HTTP, so it runs on the laptop, on a Kaggle notebook, or anywhere. Heartbeats run in
their own thread so a long GPU stage cannot make the lease expire. ``idle_exit_s`` makes the worker
quit when there is no work (Kaggle bills session time, not utilisation).
"""

from __future__ import annotations

import gzip
import logging
import os
import socket
import threading
import time
from pathlib import Path

import httpx
from taber_ir.models import Analysis, AnalysisOptions

from .audio.ingest import IngestError
from .models import ModelRegistry
from .pipeline import Canceled, JobSpec, run_analysis

log = logging.getLogger("taber.worker")


class HttpPullIO:
    def __init__(self, client: httpx.Client, job: dict, worker_id: str, cache_dir: Path):
        self.client, self.job, self.worker_id, self.cache_dir = client, job, worker_id, cache_dir
        self.job_id = job["job_id"]
        self._assets = {i["asset_id"]: i for i in job["inputs"]}
        self._canceled = threading.Event()
        self.submitted = False

    # JobIO
    def fetch_input(self, asset_id: str) -> Path:
        info = self._assets[asset_id]
        ext = Path(info["filename"]).suffix.lower() or ".bin"
        dest = self.cache_dir / f"{info['sha256']}{ext}"
        if dest.exists() and dest.stat().st_size == info.get("size", dest.stat().st_size):
            return dest  # cached by content hash
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with self.client.stream("GET", f"/api/v1/worker/assets/{asset_id}/content") as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        tmp.replace(dest)
        return dest

    def report(self, stage: str, progress: float, message: str = "") -> None:
        try:
            r = self.client.post(
                f"/api/v1/worker/jobs/{self.job_id}/progress",
                json={"worker_id": self.worker_id, "stage": stage, "progress": progress, "message": message},
            )
            if r.status_code == 409 or (r.status_code == 200 and r.json().get("cancel")):
                self._canceled.set()
        except httpx.HTTPError as e:  # progress is best effort
            log.warning("progress report failed: %s", e)

    def is_canceled(self) -> bool:
        return self._canceled.is_set()

    def submit(self, analysis: Analysis) -> None:
        body = gzip.compress(analysis.model_dump_json().encode())
        r = self.client.post(
            f"/api/v1/worker/jobs/{self.job_id}/analysis",
            params={"worker_id": self.worker_id},
            content=body,
            headers={"Content-Encoding": "gzip", "Content-Type": "application/json"},
            timeout=120,
        )
        r.raise_for_status()
        self.submitted = True

    def fail(self, error: str, retriable: bool) -> None:
        try:
            self.client.post(
                f"/api/v1/worker/jobs/{self.job_id}/fail",
                json={"worker_id": self.worker_id, "error": error, "retriable": retriable},
            )
        except httpx.HTTPError:
            pass


class PullWorker:
    def __init__(
        self,
        base_url: str,
        token: str,
        worker_id: str | None = None,
        location: str = "local",
        cache_dir: str | Path = "~/.cache/taber/inputs",
        poll_s: float = 3.0,
        heartbeat_s: float = 30.0,
        idle_exit_s: float | None = None,
        models: ModelRegistry | None = None,
        tracker: str = "auto",
        beat_tracker: str = "auto",
    ):
        self.client = httpx.Client(
            base_url=base_url.rstrip("/"), headers={"Authorization": f"Bearer {token}"}, timeout=60
        )
        self.worker_id = worker_id or f"{location}-{socket.gethostname()}-{os.getpid()}"
        self.location, self.poll_s, self.heartbeat_s = location, poll_s, heartbeat_s
        self.idle_exit_s, self.tracker, self.beat_tracker = idle_exit_s, tracker, beat_tracker
        self.cache_dir = Path(cache_dir).expanduser()
        self.models = models or ModelRegistry()
        self._stop = threading.Event()

    def capabilities(self) -> dict:
        return {"device": self.models.device, "tracker": self.tracker}

    def lease(self) -> dict | None:
        r = self.client.post(
            "/api/v1/worker/lease",
            json={"worker_id": self.worker_id, "location": self.location, "capabilities": self.capabilities()},
        )
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    def _heartbeat_loop(self, io: HttpPullIO, done: threading.Event) -> None:
        while not done.wait(self.heartbeat_s):
            try:
                r = self.client.post(f"/api/v1/worker/jobs/{io.job_id}/heartbeat", json={"worker_id": self.worker_id})
                if r.status_code == 409 or (r.status_code == 200 and r.json().get("cancel")):
                    io._canceled.set()
            except httpx.HTTPError as e:
                log.warning("heartbeat failed: %s", e)

    def run_job(self, job: dict) -> bool:
        io = HttpPullIO(self.client, job, self.worker_id, self.cache_dir)
        done = threading.Event()
        hb = threading.Thread(target=self._heartbeat_loop, args=(io, done), daemon=True)
        hb.start()
        try:
            spec = JobSpec(
                options=AnalysisOptions.model_validate(job["analysis_options"]),
                inputs={i["role"]: i["asset_id"] for i in job["inputs"] if i["role"] in ("wet", "di", "video")},
                tracker=self.tracker,
                beat_tracker=self.beat_tracker,
            )
            run_analysis(spec, io, self.models)
            return True
        except Canceled:
            log.info("job %s canceled", io.job_id)
            return False
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 409:  # lease lost or job canceled while we worked: not a failure
                log.info("job %s no longer ours (409), dropping result", io.job_id)
                return False
            log.exception("job %s failed talking to the API", io.job_id)
            io.fail(f"API {e.response.status_code}", retriable=True)
            return False
        except (IngestError, ValueError, KeyError) as e:  # bad input: retrying will not help
            log.error("job %s failed (input): %s", io.job_id, e)
            io.fail(str(e), retriable=False)
            return False
        except Exception as e:  # noqa: BLE001 - report everything else, the API decides about retries
            log.exception("job %s failed", io.job_id)
            io.fail(f"{type(e).__name__}: {e}", retriable=True)
            return False
        finally:
            done.set()
            hb.join(timeout=2)

    def run_once(self) -> bool:
        job = self.lease()
        if job is None:
            return False
        self.run_job(job)
        return True

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        idle_since = time.monotonic()
        log.info("worker %s polling %s", self.worker_id, self.client.base_url)
        while not self._stop.is_set():
            try:
                ran = self.run_once()
            except httpx.HTTPError as e:
                log.warning("API unreachable: %s", e)
                ran = False
            if ran:
                idle_since = time.monotonic()
                continue
            if self.idle_exit_s is not None and time.monotonic() - idle_since > self.idle_exit_s:
                log.info("idle for %.0fs, exiting", self.idle_exit_s)
                return
            self._stop.wait(self.poll_s)

"""End-to-end: real uvicorn + real PullWorker + real analysis pipeline over HTTP."""

from __future__ import annotations

import io
import json
import socket
import threading
import time

import httpx
import pytest
import soundfile as sf
import uvicorn

pytest.importorskip("taber_ml")

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from taber_ir.models import Score  # noqa: E402
from taber_ir.testing import TabNote, analysis_from_tab  # noqa: E402
from taber_ml.eval import note_f1  # noqa: E402
from taber_ml.synth import render  # noqa: E402
from taber_ml.worker import PullWorker  # noqa: E402

TOKEN = "e2e-token-0123456789abcdef"


@pytest.fixture()
def server(tmp_path):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    settings = Settings(data_dir=tmp_path / "data", worker_token=TOKEN, spa_dir=tmp_path / "x", reaper_interval_s=3600)
    app = create_app(settings)
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=srv.run, daemon=True)
    th.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    assert srv.started
    yield f"http://127.0.0.1:{port}", app
    srv.should_exit = True
    th.join(timeout=5)


def solo():
    seq = [(2, 8), (2, 10), (1, 5), (1, 8), (1, 10), (1, 8), (1, 5), (2, 8)]
    tab = [TabNote(s, f, i * 0.5, 0.5) for i, (s, f) in enumerate(seq)]
    return tab, analysis_from_tab(tab, bpm=100)


def upload_wav(base: str, tone: str = "distortion_light") -> tuple[str, str, object]:
    tab, ref = solo()
    buf = io.BytesIO()
    sf.write(buf, render(ref.notes, tone=tone), 44100, format="WAV")
    r = httpx.post(f"{base}/api/v1/uploads", files={"file": ("solo.wav", buf.getvalue(), "audio/wav")})
    assert r.status_code == 201, r.text
    pid = httpx.get(f"{base}/api/v1/projects").json()[0]["id"]
    return pid, r.json()["asset_id"], ref


def wait_for(fn, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(0.2)
    raise AssertionError("timed out")


def test_real_worker_full_pipeline_with_sse(server, tmp_path):
    base, app = server
    pid, asset_id, ref = upload_wav(base)
    created = httpx.post(f"{base}/api/v1/projects/{pid}/transcriptions", json={
        "inputs": [{"asset_id": asset_id, "role": "wet"}],
        "assembly_params": {"timing": "grid_from_hint", "tempo_hint_bpm": 100}}).json()
    jid, tid = created["job_id"], created["transcription_id"]

    events: list[tuple[str, dict]] = []

    def listen():
        cur = None
        with httpx.stream("GET", f"{base}/api/v1/jobs/{jid}/events", timeout=60) as r:
            for line in r.iter_lines():
                if line.startswith("event:"):
                    cur = line.split(":", 1)[1].strip()
                elif line.startswith("data:") and cur and cur != "ping":
                    events.append((cur, json.loads(line.split(":", 1)[1])))
                    if cur in ("done", "error"):
                        return

    lt = threading.Thread(target=listen, daemon=True)
    lt.start()
    time.sleep(0.3)  # let the subscriber attach before the worker starts

    worker = PullWorker(base, TOKEN, worker_id="e2e-w", cache_dir=tmp_path / "cache", tracker="pyin", heartbeat_s=0.5)
    assert worker.run_once() is True
    lt.join(timeout=10)

    stages = [d["stage"] for e, d in events if e == "progress"]
    assert stages[:7] == ["ingest", "separation", "beats", "f0", "segment", "video", "quality"], stages
    assert events[-1][0] == "done"

    t = httpx.get(f"{base}/api/v1/transcriptions/{tid}").json()
    assert t["status"] == "ready"
    est = httpx.get(f"{base}/api/v1/transcriptions/{tid}/analysis").json()
    from taber_ir.models import Analysis

    an = Analysis.model_validate(est)
    assert note_f1(ref.notes, an.notes).f1 >= 0.95
    score = Score.model_validate(t["score"])
    assert sum(len(s.notes) for m in score.measures for s in m.slots) == len(ref.notes)
    # the input was cached by content hash on the worker
    assert any(p.suffix == ".wav" for p in (tmp_path / "cache").iterdir())
    # a second identical request never reaches a worker
    again = httpx.post(f"{base}/api/v1/projects/{pid}/transcriptions", json={"inputs": [{"asset_id": asset_id, "role": "wet"}]}).json()
    assert again["cached"] is True
    assert worker.run_once() is False
    # worker shows up as online
    assert [w["id"] for w in httpx.get(f"{base}/api/v1/workers").json()] == ["e2e-w"]
    # exports work on the real result
    assert httpx.get(f"{base}/api/v1/transcriptions/{tid}/export", params={"format": "gp5"}).status_code == 200


def test_worker_reports_failure_and_job_ends_failed(server, monkeypatch, tmp_path):
    base, _ = server
    pid, asset_id, _ref = upload_wav(base, "clean")
    jid = httpx.post(f"{base}/api/v1/projects/{pid}/transcriptions",
                     json={"inputs": [{"asset_id": asset_id, "role": "wet"}]}).json()["job_id"]
    import taber_ml.worker as w

    def boom(*a, **k):
        raise RuntimeError("CUDA out of memory")

    monkeypatch.setattr(w, "run_analysis", boom)
    worker = PullWorker(base, TOKEN, cache_dir=tmp_path / "c", heartbeat_s=5)
    assert worker.run_once() is True  # attempt 1 -> retriable -> queued again
    assert httpx.get(f"{base}/api/v1/jobs/{jid}").json()["status"] == "queued"
    assert worker.run_once() is True  # attempt 2 -> failed for good
    snap = httpx.get(f"{base}/api/v1/jobs/{jid}").json()
    assert snap["status"] == "failed" and "CUDA out of memory" in snap["error"] and snap["attempts"] == 2


def test_worker_picks_up_cancel_between_stages(server, monkeypatch, tmp_path):
    base, _ = server
    pid, asset_id, _ref = upload_wav(base, "clean")
    jid = httpx.post(f"{base}/api/v1/projects/{pid}/transcriptions",
                     json={"inputs": [{"asset_id": asset_id, "role": "wet"}]}).json()["job_id"]
    import taber_ml.models as tm

    real_get = tm.get_tracker

    def slow_then_cancel(name):
        httpx.post(f"{base}/api/v1/jobs/{jid}/cancel")  # user presses cancel while the worker is running
        return real_get(name)

    monkeypatch.setattr(tm, "get_tracker", slow_then_cancel)
    worker = PullWorker(base, TOKEN, cache_dir=tmp_path / "c", tracker="pyin", heartbeat_s=0.2)
    worker.run_once()
    assert httpx.get(f"{base}/api/v1/jobs/{jid}").json()["status"] == "canceled"
    assert httpx.get(f"{base}/api/v1/transcriptions/{httpx.get(f'{base}/api/v1/jobs/{jid}').json()['transcription_id']}").json()["status"] == "canceled"


def test_worker_with_wrong_token_is_rejected(server, tmp_path):
    base, _ = server
    w = PullWorker(base, "wrong-token", cache_dir=tmp_path / "c")
    with pytest.raises(httpx.HTTPStatusError):
        w.run_once()


def test_idle_exit(server, tmp_path):
    base, _ = server
    w = PullWorker(base, TOKEN, cache_dir=tmp_path / "c", poll_s=0.1, idle_exit_s=0.5)
    t0 = time.time()
    w.run_forever()  # no jobs: must return by itself (saves Kaggle quota)
    assert 0.4 < time.time() - t0 < 5

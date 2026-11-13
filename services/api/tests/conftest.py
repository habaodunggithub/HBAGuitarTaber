from __future__ import annotations

import io
import wave

import numpy as np
import pytest
from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient
from taber_ir.models import Analysis
from taber_ir.testing import TabNote, analysis_from_tab

TOKEN = "test-worker-token-0123456789"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def make_wav(seconds: float = 1.0, freq: float = 220.0, sr: int = 22050, seed: int = 0) -> bytes:
    """A short valid WAV (tone + a little noise so different seeds hash differently)."""
    t = np.arange(int(seconds * sr)) / sr
    rng = np.random.default_rng(seed)
    y = 0.3 * np.sin(2 * np.pi * freq * t) + 0.001 * rng.standard_normal(len(t))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def fake_analysis() -> Analysis:
    tab = [TabNote(2, 5, 0, 1), TabNote(2, 7, 1, 1), TabNote(1, 5, 2, 1), TabNote(1, 8, 3, 1)]
    a = analysis_from_tab(tab, bpm=100, n_beats=8)
    a.meta = {"pipeline_version": "test"}
    return a


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", worker_token=TOKEN, spa_dir=tmp_path / "no-spa",
                    reaper_interval_s=3600, max_audio_mb=5, max_video_mb=8)


@pytest.fixture()
def app(settings):
    return create_app(settings)


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def project_id(client) -> str:
    return client.post("/api/v1/projects", json={"title": "t"}).json()["id"]


def upload(client, data: bytes | None = None, name: str = "take.wav", project_id: str | None = None, **kw):
    files = {"file": (name, data if data is not None else make_wav(**kw), "audio/wav")}
    return client.post("/api/v1/uploads", files=files, data={"project_id": project_id} if project_id else {})


@pytest.fixture()
def asset(client, project_id) -> dict:
    r = upload(client, project_id=project_id)
    assert r.status_code == 201, r.text
    return r.json()


def create_t(client, project_id: str, asset_id: str, **body):
    payload = {"inputs": [{"asset_id": asset_id, "role": "wet"}], **body}
    r = client.post(f"/api/v1/projects/{project_id}/transcriptions", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def lease(client, worker_id: str = "w1", location: str = "local"):
    return client.post("/api/v1/worker/lease", headers=AUTH,
                       json={"worker_id": worker_id, "location": location, "capabilities": {}})


def submit(client, job_id: str, worker_id: str = "w1", analysis: Analysis | None = None):
    a = analysis or fake_analysis()
    return client.post(f"/api/v1/worker/jobs/{job_id}/analysis", headers=AUTH, params={"worker_id": worker_id},
                       content=a.model_dump_json().encode(), )

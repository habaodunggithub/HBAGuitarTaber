from __future__ import annotations

import gzip
import io
import threading
import xml.etree.ElementTree as ET
from datetime import timedelta

import guitarpro as gp
import pytest
from app import service as svc
from app.db import Job, utcnow
from conftest import AUTH, create_t, fake_analysis, lease, submit, upload
from taber_ir.models import AssemblyParams, Score, Tuning


# ───────────────────────────── uploads ─────────────────────────────
def test_health(client):
    assert client.get("/api/v1/health").json()["ok"] is True


def test_upload_ok_probe_and_sha(client, asset):
    assert asset["kind"] == "audio" and 0.9 < asset["duration_s"] < 1.1 and len(asset["sha256"]) == 64
    content = client.get(f"/api/v1/assets/{asset['asset_id']}/content")
    assert content.status_code == 200 and content.content[:4] == b"RIFF"


def test_upload_rejects_non_media_and_cleans_up(client, settings, project_id):
    r = upload(client, b"definitely not audio", name="x.mp3", project_id=project_id)
    assert r.status_code == 422
    assert not any((settings.data_dir / "assets").iterdir())  # nothing left behind


def test_upload_rejects_too_big(client, project_id):
    r = upload(client, b"\0" * (9 * 1024 * 1024), name="big.wav", project_id=project_id)
    assert r.status_code == 413


def test_upload_rejects_too_long(client, settings, project_id):
    settings.max_duration_s = 0
    r = upload(client, project_id=project_id)
    assert r.status_code == 422 and "maximum" in r.json()["detail"]


# ───────────────────────────── worker auth ─────────────────────────────
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer nope"}, {"Authorization": "Basic abc"}])
def test_worker_routes_require_token(client, headers):
    r = client.post("/api/v1/worker/lease", headers=headers, json={"worker_id": "w"})
    assert r.status_code == 401


def test_public_routes_do_not_accept_worker_token_as_anything_special(client):
    assert client.get("/api/v1/workers").status_code == 200  # open (localhost UI)


# ───────────────────────────── the whole job flow ─────────────────────────────
def test_full_flow_lease_progress_submit_export(client, project_id, asset):
    created = create_t(client, project_id, asset["asset_id"], title="My solo")
    assert created["cached"] is False
    tid, jid = created["transcription_id"], created["job_id"]
    assert client.get(f"/api/v1/transcriptions/{tid}").json()["status"] == "queued"

    job = lease(client).json()
    assert job["job_id"] == jid and job["inputs"][0]["role"] == "wet"
    assert lease(client, "w2").status_code == 204  # nothing else queued
    assert client.get(f"/api/v1/jobs/{jid}").json()["status"] == "running"

    r = client.post(f"/api/v1/worker/jobs/{jid}/progress", headers=AUTH,
                    json={"worker_id": "w1", "stage": "f0", "progress": 0.4, "message": "x"})
    assert r.status_code == 200 and r.json() == {"cancel": False}
    snap = client.get(f"/api/v1/jobs/{jid}").json()
    assert snap["stage"] == "f0" and snap["progress"] == 0.4 and snap["worker"] == "w1"

    assert submit(client, jid).status_code == 200
    t = client.get(f"/api/v1/transcriptions/{tid}").json()
    assert t["status"] == "ready" and t["current_revision"] == 1 and t["title"] == "My solo"
    score = Score.model_validate(t["score"])
    assert score.measures and t["job"]["status"] == "succeeded"
    assert client.get(f"/api/v1/transcriptions/{tid}/analysis").json()["notes"]

    # every export format
    gp5 = client.get(f"/api/v1/transcriptions/{tid}/export", params={"format": "gp5"})
    assert gp5.status_code == 200 and 'filename="My solo.gp5"' in gp5.headers["content-disposition"]
    gp.parse(io.BytesIO(gp5.content))
    ET.fromstring(client.get(f"/api/v1/transcriptions/{tid}/export", params={"format": "musicxml"}).text)
    assert "\\tuning" in client.get(f"/api/v1/transcriptions/{tid}/export", params={"format": "alphatex"}).text
    assert client.get(f"/api/v1/transcriptions/{tid}/export", params={"format": "midi"}).content[:4] == b"MThd"
    assert client.get(f"/api/v1/transcriptions/{tid}/export", params={"format": "ascii"}).status_code == 200
    assert client.get(f"/api/v1/transcriptions/{tid}/export", params={"format": "pdf"}).status_code == 422


def test_gzip_analysis_upload(client, project_id, asset):
    created = create_t(client, project_id, asset["asset_id"])
    lease(client)
    body = gzip.compress(fake_analysis().model_dump_json().encode())
    r = client.post(f"/api/v1/worker/jobs/{created['job_id']}/analysis", headers={**AUTH, "Content-Encoding": "gzip"},
                    params={"worker_id": "w1"}, content=body)
    assert r.status_code == 200, r.text


def test_invalid_analysis_rejected(client, project_id, asset):
    created = create_t(client, project_id, asset["asset_id"])
    lease(client)
    r = client.post(f"/api/v1/worker/jobs/{created['job_id']}/analysis", headers=AUTH,
                    params={"worker_id": "w1"}, content=b'{"notes": "nope"}')
    assert r.status_code == 422


def test_other_worker_cannot_touch_the_job(client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client, "w1")
    assert submit(client, jid, "intruder").status_code == 409
    r = client.post(f"/api/v1/worker/jobs/{jid}/progress", headers=AUTH,
                    json={"worker_id": "intruder", "stage": "x", "progress": 0.1})
    assert r.status_code == 409


# ───────────────────────────── caching ─────────────────────────────
def test_identical_input_is_served_from_cache_without_a_job(client, project_id, asset):
    first = create_t(client, project_id, asset["asset_id"])
    lease(client)
    submit(client, first["job_id"])
    second = create_t(client, project_id, asset["asset_id"], assembly_params={"tuning": {"capo": 2}})
    assert second["cached"] is True and second["job_id"] is None
    t = client.get(f"/api/v1/transcriptions/{second['transcription_id']}").json()
    assert t["status"] == "ready" and t["score"]["assembly_params"]["tuning"]["capo"] == 2
    assert lease(client).status_code == 204


def test_listening_stems_upload_and_playback(client, project_id, asset):
    first = create_t(client, project_id, asset["asset_id"])
    jid, tid = first["job_id"], first["transcription_id"]
    lease(client)
    url = f"/api/v1/worker/jobs/{jid}/stems/guitar"
    assert client.post(url, params={"worker_id": "w1"}, content=b"x").status_code == 401  # worker token required
    assert client.post(url, headers=AUTH, params={"worker_id": "intruder"}, content=b"x").status_code == 409
    assert client.post(f"/api/v1/worker/jobs/{jid}/stems/drums", headers=AUTH, params={"worker_id": "w1"}, content=b"x").status_code == 422
    assert client.post(url, headers=AUTH, params={"worker_id": "w1"}, content=b"").status_code == 422
    assert client.get(f"/api/v1/transcriptions/{tid}/stems/guitar").status_code == 404  # no analysis yet
    for role, body in (("guitar", b"GTR" * 1000), ("backing", b"BND" * 1000)):
        r = client.post(f"/api/v1/worker/jobs/{jid}/stems/{role}", headers=AUTH, params={"worker_id": "w1"}, content=body)
        assert r.status_code == 204, r.text
    submit(client, jid)
    r = client.get(f"/api/v1/transcriptions/{tid}/stems/backing")
    assert r.status_code == 200 and r.content == b"BND" * 1000 and r.headers["content-type"] == "audio/mp4"
    part = client.get(f"/api/v1/transcriptions/{tid}/stems/guitar", headers={"Range": "bytes=0-2"})
    assert part.status_code == 206 and part.content == b"GTR"  # seekable in the browser
    # a tab that reuses the analysis (same input + options) hears the same stems
    second = create_t(client, project_id, asset["asset_id"], assembly_params={"tuning": {"capo": 2}})
    assert client.get(f"/api/v1/transcriptions/{second['transcription_id']}/stems/guitar").content == b"GTR" * 1000


def test_video_track_for_the_overlay(client, project_id, asset):
    first = create_t(client, project_id, asset["asset_id"])
    tid = first["transcription_id"]
    assert client.get(f"/api/v1/transcriptions/{tid}/video-track").status_code == 409  # no analysis yet
    lease(client)
    a = fake_analysis()
    a.video_track = {"time_offset_s": 0.0, "size": [960, 540], "fret_a": 3, "fret_b": 12,
                     "samples": [[0.1, 1, 0.1, 0.2, 0.1, 0.3, 0.5, 0.3, 0.5, 0.2]], "tips": [[0.1, 0.3, 0.25, 1]]}
    submit(client, first["job_id"], analysis=a)
    r = client.get(f"/api/v1/transcriptions/{tid}/video-track")
    assert r.status_code == 200 and r.json() == a.video_track
    other = create_t(client, project_id, upload(client, project_id=project_id, seed=7).json()["asset_id"])
    lease(client)
    submit(client, other["job_id"])
    assert client.get(f"/api/v1/transcriptions/{other['transcription_id']}/video-track").status_code == 404


def test_different_options_do_not_share_cache(client, project_id, asset):
    a = create_t(client, project_id, asset["asset_id"])
    lease(client)
    submit(client, a["job_id"])
    b = create_t(client, project_id, asset["asset_id"], analysis_options={"tone": "high_gain"})
    assert b["cached"] is False


# ───────────────────────────── reassemble / edit / revisions ─────────────────────────────
@pytest.fixture()
def ready(client, project_id, asset) -> str:
    c = create_t(client, project_id, asset["asset_id"])
    lease(client)
    submit(client, c["job_id"])
    return c["transcription_id"]


def test_reassemble_capo_is_instant_and_keeps_pitches(client, ready):
    before = Score.model_validate(client.get(f"/api/v1/transcriptions/{ready}").json()["score"])
    r = client.post(f"/api/v1/transcriptions/{ready}/reassemble",
                    json={"assembly_params": AssemblyParams(tuning=Tuning(capo=3)).model_dump(mode="json")})
    assert r.status_code == 200 and r.json()["current_revision"] == 2
    after = Score.model_validate(r.json()["score"])
    pitches = lambda s: [n.pitch_midi for m in s.measures for sl in m.slots for n in sl.notes]  # noqa: E731
    assert pitches(before) == pitches(after) and after.assembly_params.tuning.capo == 3
    revs = client.get(f"/api/v1/transcriptions/{ready}/revisions").json()
    assert [x["number"] for x in revs] == [2, 1] and revs[0]["source"] == "reassemble"


def test_user_edit_is_locked_across_reassemble(client, ready):
    t = client.get(f"/api/v1/transcriptions/{ready}").json()
    score = Score.model_validate(t["score"])
    target = next(n for m in score.measures for s in m.slots for n in s.notes)
    from taber_ir import sounding_pitch

    same_pitch = [(s, f) for s in range(1, 7) for f in range(0, 20) if sounding_pitch(Tuning(), s, f) == target.pitch_midi]
    s, f = next(x for x in same_pitch if x != (target.string, target.fret))
    target.string, target.fret, target.locked = s, f, True
    saved = client.put(f"/api/v1/transcriptions/{ready}", json=score.model_dump(mode="json"))
    assert saved.status_code == 200 and saved.json()["revision_source"] == "user"
    r = client.post(f"/api/v1/transcriptions/{ready}/reassemble",
                    json={"assembly_params": {"timing": "grid_from_hint", "tempo_hint_bpm": 100}})
    got = Score.model_validate(r.json()["score"])
    first = next(n for m in got.measures for sl in m.slots for n in sl.notes)
    assert (first.string, first.fret, first.locked) == (s, f, True)


def test_ranged_reassemble_and_validation(client, ready):
    ok = client.post(f"/api/v1/transcriptions/{ready}/reassemble",
                     json={"range": {"from_s": 0.0, "to_s": 2.0}, "assembly_params": {"fingering_weights": {"open_cost": 3}}})
    assert ok.status_code == 200
    bad = client.post(f"/api/v1/transcriptions/{ready}/reassemble", json={"range": {"from_s": 5, "to_s": 1}})
    assert bad.status_code == 422


def test_restore_revision(client, ready):
    client.post(f"/api/v1/transcriptions/{ready}/reassemble", json={"assembly_params": {"tuning": {"capo": 5}}})
    r = client.post(f"/api/v1/transcriptions/{ready}/revisions/1/restore")
    assert r.status_code == 200 and r.json()["current_revision"] == 3
    assert r.json()["score"]["assembly_params"]["tuning"]["capo"] == 0
    assert client.get(f"/api/v1/transcriptions/{ready}/revisions/99").status_code == 404


def test_invalid_score_rejected(client, ready):
    assert client.put(f"/api/v1/transcriptions/{ready}", json={"measures": "x"}).status_code == 422
    assert client.get("/api/v1/transcriptions/doesnotexist").status_code == 404


def test_reassemble_before_analysis_is_a_conflict(client, project_id, asset):
    tid = create_t(client, project_id, asset["asset_id"])["transcription_id"]
    assert client.post(f"/api/v1/transcriptions/{tid}/reassemble", json={}).status_code == 409
    assert client.get(f"/api/v1/transcriptions/{tid}/export").status_code == 409


# ───────────────────────────── validation of create ─────────────────────────────
def test_create_validation(client, project_id, asset):
    p = f"/api/v1/projects/{project_id}/transcriptions"
    assert client.post(p, json={"inputs": []}).status_code == 422
    assert client.post(p, json={"inputs": [{"asset_id": asset["asset_id"], "role": "video"}]}).status_code == 422
    assert client.post(p, json={"inputs": [{"asset_id": "nope", "role": "wet"}]}).status_code == 404
    dup = {"inputs": [{"asset_id": asset["asset_id"], "role": "wet"}, {"asset_id": asset["asset_id"], "role": "wet"}]}
    assert client.post(p, json=dup).status_code == 422
    assert client.post("/api/v1/projects/zzz/transcriptions", json={"inputs": []}).status_code == 404


def test_di_and_wet_inputs_listed(client, project_id):
    wet = upload(client, project_id=project_id, seed=1).json()
    di = upload(client, project_id=project_id, seed=2).json()
    created = client.post(f"/api/v1/projects/{project_id}/transcriptions", json={
        "inputs": [{"asset_id": wet["asset_id"], "role": "wet"}, {"asset_id": di["asset_id"], "role": "di"}]}).json()
    job = lease(client).json()
    assert {i["role"] for i in job["inputs"]} == {"wet", "di"}
    t = client.get(f"/api/v1/transcriptions/{created['transcription_id']}").json()
    assert {i["role"] for i in t["inputs"]} == {"wet", "di"}


# ───────────────────────────── queue semantics ─────────────────────────────
def test_lease_is_atomic_under_concurrency(app, client, project_id):
    for seed in range(3):
        a = upload(client, project_id=project_id, seed=seed + 10).json()
        create_t(client, project_id, a["asset_id"])
    got: list[str] = []
    lock = threading.Lock()

    def grab(i: int) -> None:
        with app.state.db.session_factory() as s:
            j = svc.lease_job(s, app.state.settings, f"w{i}", "local", {})
        if j:
            with lock:
                got.append(j["job_id"])

    threads = [threading.Thread(target=grab, args=(i,)) for i in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(got) == 3 and len(set(got)) == 3  # 3 jobs, 12 racing workers, no duplicates


def test_worker_target_routing(client, project_id, asset):
    create_t(client, project_id, asset["asset_id"], worker_target="kaggle")
    assert lease(client, "laptop", "local").status_code == 204
    assert lease(client, "nb", "kaggle").status_code == 200


def test_oldest_job_first(client, project_id):
    ids = []
    for seed in range(3):
        a = upload(client, project_id=project_id, seed=seed + 20).json()
        ids.append(create_t(client, project_id, a["asset_id"])["job_id"])
    assert [lease(client, f"w{i}").json()["job_id"] for i in range(3)] == ids


def expire(app, jid: str) -> None:
    with app.state.db.session_factory() as s:
        s.get(Job, jid).lease_expires_at = utcnow() - timedelta(seconds=5)
        s.commit()


def test_reaper_requeues_then_fails_after_max_attempts(app, client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client, "dies-1")
    expire(app, jid)
    with app.state.db.session_factory() as s:
        assert svc.reap_expired(s, app.state.settings, app.state.bus) == 1
    snap = client.get(f"/api/v1/jobs/{jid}").json()
    assert snap["status"] == "queued" and snap["attempts"] == 1
    assert submit(client, jid, "dies-1").status_code == 409  # the dead worker lost its lease
    lease(client, "dies-2")
    expire(app, jid)
    with app.state.db.session_factory() as s:
        svc.reap_expired(s, app.state.settings, app.state.bus)
    snap = client.get(f"/api/v1/jobs/{jid}").json()
    assert snap["status"] == "failed" and "lease" in snap["error"]


def test_heartbeat_extends_lease_so_reaper_leaves_it(app, client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client)
    expire(app, jid)
    assert client.post(f"/api/v1/worker/jobs/{jid}/heartbeat", headers=AUTH, json={"worker_id": "w1"}).json() == {"cancel": False}
    with app.state.db.session_factory() as s:
        assert svc.reap_expired(s, app.state.settings, app.state.bus) == 0


def test_fail_retriable_then_final(client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client)
    r = client.post(f"/api/v1/worker/jobs/{jid}/fail", headers=AUTH, json={"worker_id": "w1", "error": "oom", "retriable": True})
    assert r.json() == {"status": "queued", "attempts": 1}
    lease(client)
    r = client.post(f"/api/v1/worker/jobs/{jid}/fail", headers=AUTH, json={"worker_id": "w1", "error": "oom", "retriable": True})
    assert r.json() == {"status": "failed", "attempts": 2}


def test_fail_not_retriable_is_final_immediately(client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client)
    r = client.post(f"/api/v1/worker/jobs/{jid}/fail", headers=AUTH, json={"worker_id": "w1", "error": "bad file", "retriable": False})
    assert r.json()["status"] == "failed"
    assert client.get(f"/api/v1/jobs/{jid}").json()["error"] == "bad file"


def test_cancel_queued_and_running(client, project_id):
    a = upload(client, project_id=project_id, seed=31).json()
    q = create_t(client, project_id, a["asset_id"])["job_id"]
    assert client.post(f"/api/v1/jobs/{q}/cancel").json()["status"] == "canceled"
    assert lease(client).status_code == 204  # canceled jobs are never leased

    b = upload(client, project_id=project_id, seed=32).json()
    run = create_t(client, project_id, b["asset_id"])["job_id"]
    lease(client)
    client.post(f"/api/v1/jobs/{run}/cancel")
    hb = client.post(f"/api/v1/worker/jobs/{run}/heartbeat", headers=AUTH, json={"worker_id": "w1"})
    assert hb.json() == {"cancel": True}
    assert client.post("/api/v1/jobs/nope/cancel").status_code == 404


def test_workers_listing_shows_online_only(app, client, project_id, asset):
    create_t(client, project_id, asset["asset_id"])
    lease(client, "laptop-gpu", "local")
    ws = client.get("/api/v1/workers").json()
    assert [w["id"] for w in ws] == ["laptop-gpu"]
    with app.state.db.session_factory() as s:
        from app.db import Worker

        s.get(Worker, "laptop-gpu").last_seen = utcnow() - timedelta(minutes=5)
        s.commit()
    assert client.get("/api/v1/workers").json() == []


# ───────────────────────────── SSE ─────────────────────────────
def read_events(client, url: str, stop_on: set[str], limit: int = 20) -> list[tuple[str, str]]:
    events, cur = [], None
    with client.stream("GET", url) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines():
            if line.startswith("event:"):
                cur = line.split(":", 1)[1].strip()
            elif line.startswith("data:") and cur:
                events.append((cur, line.split(":", 1)[1].strip()))
                if cur in stop_on or len(events) >= limit:
                    break
    return events


def test_sse_replays_terminal_state_for_late_subscribers(client, project_id, asset):
    created = create_t(client, project_id, asset["asset_id"])
    lease(client)
    submit(client, created["job_id"])
    ev = read_events(client, f"/api/v1/jobs/{created['job_id']}/events", {"done"})
    assert [e for e, _ in ev] == ["snapshot", "done"]
    assert created["transcription_id"] in ev[-1][1]


def test_sse_failed_job(client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client)
    client.post(f"/api/v1/worker/jobs/{jid}/fail", headers=AUTH, json={"worker_id": "w1", "error": "boom", "retriable": False})
    ev = read_events(client, f"/api/v1/jobs/{jid}/events", {"error"})
    assert ev[-1][0] == "error" and "boom" in ev[-1][1]
    assert client.get("/api/v1/jobs/nope/events").status_code == 404


def test_sse_live_progress(app, client, project_id, asset):
    jid = create_t(client, project_id, asset["asset_id"])["job_id"]
    lease(client)

    def publish():
        import time

        time.sleep(0.4)
        for i, st in enumerate(("ingest", "f0")):
            app.state.bus.publish(jid, "progress", {"stage": st, "progress": i / 2, "message": ""})
        app.state.bus.publish(jid, "done", {"transcription_id": "x"})

    threading.Thread(target=publish, daemon=True).start()
    ev = read_events(client, f"/api/v1/jobs/{jid}/events", {"done"})
    assert [e for e, _ in ev] == ["snapshot", "progress", "progress", "done"]


# ───────────────────────────── SPA hosting ─────────────────────────────
def test_spa_fallback_and_api_404(tmp_path):
    from app.config import Settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    spa = tmp_path / "dist"
    (spa / "assets").mkdir(parents=True)
    (spa / "index.html").write_text("<html>spa</html>")
    (spa / "assets" / "a.js").write_text("console.log(1)")
    s = Settings(data_dir=tmp_path / "d", worker_token="t" * 20, spa_dir=spa, reaper_interval_s=3600)
    with TestClient(create_app(s)) as c:
        assert c.get("/").text == "<html>spa</html>"
        assert c.get("/t/abc123").text == "<html>spa</html>"  # client-side route
        assert c.get("/assets/a.js").text == "console.log(1)"
        assert c.get("/api/v1/nothing").status_code == 404
        assert c.get("/../../etc/passwd").status_code in (200, 404)  # never serves outside dist
        assert "root:" not in c.get("/..%2f..%2fetc/passwd").text


# ───────────────────────────── editor support ─────────────────────────────
def test_cached_transcription_still_lists_its_inputs(client, project_id, asset):
    """The UI plays the original audio, so a cache hit must know which asset it came from."""
    first = create_t(client, project_id, asset["asset_id"])
    lease(client)
    submit(client, first["job_id"])
    second = create_t(client, project_id, asset["asset_id"])
    assert second["cached"] is True
    t = client.get(f"/api/v1/transcriptions/{second['transcription_id']}").json()
    assert [(i["role"], i["asset_id"]) for i in t["inputs"]] == [("wet", asset["asset_id"])]
    assert t["job"]["status"] == "succeeded"


def test_alphatex_preview_of_an_unsaved_score(client, ready):
    score = Score.model_validate(client.get(f"/api/v1/transcriptions/{ready}").json()["score"])
    score.assembly_params.tuning.capo = 2
    r = client.post("/api/v1/alphatex", json=score.model_dump(mode="json"))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert "\\capo 2" in r.text and "\\tuning e4 b3 g3 d3 a2 e2" in r.text
    # stateless: nothing was saved
    assert client.get(f"/api/v1/transcriptions/{ready}").json()["current_revision"] == 1
    assert client.post("/api/v1/alphatex", json={"measures": 5}).status_code == 422


def test_upload_returns_project_id(client, project_id):
    assert upload(client, project_id=project_id).json()["project_id"] == project_id
    assert upload(client, seed=77).json()["project_id"]  # default project when none is given


# ───────────────────────────── video ─────────────────────────────
def make_mp4(tmp_path, seconds: int = 2) -> bytes:
    import shutil
    import subprocess

    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg needed")
    out = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=15:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=330:duration={seconds}", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", str(out)], check=True)
    return out.read_bytes()


CAL = {"t_s": 0.5, "points": [[0.8, 0.6], [0.8, 0.4], [0.2, 0.35], [0.2, 0.65]], "fret_a": 3, "fret_b": 12}


@pytest.fixture()
def video_t(client, project_id, tmp_path):
    v = client.post("/api/v1/uploads", files={"file": ("clip.mp4", make_mp4(tmp_path), "video/mp4")}, data={"project_id": project_id})
    assert v.status_code == 201 and v.json()["kind"] == "video", v.text
    created = create_t(client, project_id, v.json()["asset_id"])
    lease(client)
    submit(client, created["job_id"])
    return created["transcription_id"], v.json()["asset_id"]


def test_frame_endpoint_returns_a_jpeg(client, video_t, asset):
    _tid, vid = video_t
    r = client.get(f"/api/v1/assets/{vid}/frame", params={"t": 1.0})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content[:2] == b"\xff\xd8"
    assert client.get(f"/api/v1/assets/{asset['asset_id']}/frame").status_code == 422  # audio has no frames
    assert client.get(f"/api/v1/assets/{vid}/frame", params={"t": 999}).status_code == 422
    assert client.get("/api/v1/assets/nope/frame").status_code == 404


def test_video_reanalysis_flow_keeps_current_params(client, video_t):
    tid, _vid = video_t
    # the user changes the capo before running the video analysis
    client.post(f"/api/v1/transcriptions/{tid}/reassemble", json={"assembly_params": {"tuning": {"capo": 2}}})
    r = client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": CAL})
    assert r.status_code == 201, r.text
    jid = r.json()["job_id"]
    assert client.get(f"/api/v1/transcriptions/{tid}").json()["status"] == "queued"  # the page shows the progress
    assert client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": CAL}).status_code == 409  # one at a time
    job = lease(client).json()
    assert job["job_id"] == jid and job["analysis_options"]["use_video"] is True
    assert job["analysis_options"]["video_calibration"]["fret_b"] == 12
    assert {i["role"] for i in job["inputs"]} == {"wet"}
    assert submit(client, jid).status_code == 200
    t = client.get(f"/api/v1/transcriptions/{tid}").json()
    assert t["status"] == "ready" and t["score"]["assembly_params"]["tuning"]["capo"] == 2


def test_video_reanalysis_needs_a_video_and_valid_frets(client, project_id, asset, video_t):
    tid_audio = create_t(client, project_id, asset["asset_id"])["transcription_id"]
    assert client.post(f"/api/v1/transcriptions/{tid_audio}/video", json={"calibration": CAL}).status_code == 422
    tid, _ = video_t
    assert client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": {**CAL, "fret_a": 12, "fret_b": 5}}).status_code == 422
    assert client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": {**CAL, "points": [[0, 0]]}}).status_code == 422
    three = {**CAL, "frets": [3, 7, 12], "guitar": "acoustic"}  # 3 wires need 6 points
    assert client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": three}).status_code == 422
    assert client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": {**CAL, "guitar": "banjo"}}).status_code == 422


def test_video_calibration_with_more_wires_and_a_body_type(client, video_t):
    tid, _ = video_t
    cal = {**CAL, "points": CAL["points"] + [[0.1, 0.66], [0.1, 0.34]], "frets": [3, 9, 12], "guitar": "classical"}
    assert client.post(f"/api/v1/transcriptions/{tid}/video", json={"calibration": cal}).status_code == 201
    got = lease(client).json()["analysis_options"]["video_calibration"]
    assert got["frets"] == [3, 9, 12] and got["guitar"] == "classical" and len(got["points"]) == 6


def test_listing_uses_a_fixed_number_of_queries(app, client, project_id):
    """The library list must not run queries per row (N+1), nor load any score."""
    from sqlalchemy import event

    def count_list_queries() -> tuple[int, list]:
        stmts: list[str] = []
        listen = lambda *a: stmts.append(a[2])  # noqa: E731  (conn, cursor, statement, ...)
        event.listen(app.state.db.engine, "before_cursor_execute", listen)
        try:
            rows = client.get("/api/v1/transcriptions").json()
        finally:
            event.remove(app.state.db.engine, "before_cursor_execute", listen)
        assert not any("FROM revisions" in s for s in stmts)  # status comes from current_revision
        return len(stmts), rows

    for seed in range(2):
        a = upload(client, project_id=project_id, seed=seed).json()
        create_t(client, project_id, a["asset_id"])
    few, rows = count_list_queries()
    assert len(rows) == 2 and all(r["inputs"] for r in rows)
    for seed in range(2, 7):
        a = upload(client, project_id=project_id, seed=seed).json()
        create_t(client, project_id, a["asset_id"])
    many, rows = count_list_queries()
    assert len(rows) == 7 and many == few


def _struck(score: Score):
    return [n for m in score.measures for sl in m.slots for n in sl.notes if not n.tie_from_prev]


def test_note_edits_survive_reassemble(client, ready):
    """Deleted, re-pitched and added notes are kept when the score is re-assembled."""
    score = Score.model_validate(client.get(f"/api/v1/transcriptions/{ready}").json()["score"])
    notes = _struck(score)
    gone, repitched = notes[0], notes[1]
    for m in score.measures:
        for sl in m.slots:
            sl.notes = [n for n in sl.notes if n.note_id != gone.note_id]
    score.deleted_note_ids = [gone.note_id]
    repitched.fret += 1
    repitched.pitch_midi += 1
    repitched.locked = True
    rest = next(sl for m in score.measures for sl in m.slots if not sl.notes and sl.start_s > 0)
    from taber_ir.models import ScoreNote

    rest.notes = [ScoreNote(note_id="u1", pitch_midi=67, string=1, fret=3, locked=True)]
    assert client.put(f"/api/v1/transcriptions/{ready}", json=score.model_dump(mode="json")).status_code == 200

    r = client.post(f"/api/v1/transcriptions/{ready}/reassemble",
                    json={"assembly_params": {"timing": "grid_from_hint", "tempo_hint_bpm": 100}})
    got = Score.model_validate(r.json()["score"])
    ids = {n.note_id: n for n in _struck(got)}
    assert gone.note_id not in ids and got.deleted_note_ids == [gone.note_id]
    assert ids[repitched.note_id].pitch_midi == repitched.pitch_midi
    assert (ids["u1"].pitch_midi, ids["u1"].string, ids["u1"].fret, ids["u1"].locked) == (67, 1, 3, True)


def test_truth_snapshot_roundtrip(client, ready, settings):
    from taber_ir.truth import TruthTake

    assert client.get(f"/api/v1/transcriptions/{ready}/truth").json() is None
    r = client.put(f"/api/v1/transcriptions/{ready}/truth")
    assert r.status_code == 200, r.text
    assert r.json()["notes"] == 4 and r.json()["revision"] == 1
    folder = settings.data_dir / "truth" / ready
    take = TruthTake.model_validate_json((folder / "truth.json").read_text())
    assert take.inputs == {"wet": "wet.wav"} and (folder / "wet.wav").exists() and (folder / "analysis.json.gz").exists()
    assert [n.timing for n in take.notes] == ["detected"] * 4
    assert client.get(f"/api/v1/transcriptions/{ready}/truth").json()["notes"] == 4
    assert client.delete(f"/api/v1/transcriptions/{ready}/truth").status_code == 204
    assert not folder.exists() and client.get(f"/api/v1/transcriptions/{ready}/truth").json() is None


def test_truth_needs_a_score(client, project_id, asset):
    c = create_t(client, project_id, asset["asset_id"])
    assert client.put(f"/api/v1/transcriptions/{c['transcription_id']}/truth").status_code == 409


def test_truth_folder_feeds_truth_eval(client, ready, settings, capsys):
    """The data loop end to end: mark a checked tab, then `taber truth-eval --stored` scores it."""
    taber_cli = pytest.importorskip("taber_ml.cli")
    assert client.put(f"/api/v1/transcriptions/{ready}/truth").status_code == 200
    assert taber_cli.main(["truth-eval", str(settings.data_dir / "truth"), "--stored"]) == 0
    out = capsys.readouterr().out
    assert "1 take(s), 4 reference notes" in out and "right pitch+string+fret 100.0%" in out

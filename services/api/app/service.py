"""Business logic: transcriptions, job queue (lease / heartbeat / reaper), assembly."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta

from sqlalchemy import DateTime, bindparam, select, text
from sqlalchemy.orm import Session
from taber_ir import assemble
from taber_ir.models import Analysis as AnalysisModel
from taber_ir.models import AnalysisOptions, AssemblyParams, Score, VideoCalibration

from .config import Settings
from .db import Analysis, Job, JobInput, MediaAsset, Revision, Transcription, Worker, iso, new_id, utcnow
from .events import EventBus
from .storage import Storage

ROLES = {"wet", "di", "video"}
ACTIVE = ("queued", "running")


class ServiceError(Exception):
    """An API error. `code` (with `params`) names the ones a user can meet, so the app can say them in its own language
    (apps/web/src/i18n/en.ts, server.errors); `detail` stays the English text."""

    def __init__(self, status: int, detail: str, code: str | None = None, **params: str | float):
        super().__init__(detail)
        self.status, self.detail, self.code, self.params = status, detail, code, params


def compute_cache_key(inputs: list[tuple[str, str]], options: AnalysisOptions, pipeline_version: str) -> str:
    """sha256 over (role, asset sha256) pairs + options + pipeline version. Not the worker target."""
    payload = json.dumps(
        {"inputs": sorted(inputs), "options": options.model_dump(), "v": pipeline_version}, sort_keys=True
    )
    return hashlib.sha256(payload.encode()).hexdigest()


# ───────────────────────────── assembly ─────────────────────────────
def get_revision(db: Session, tid: str, number: int) -> Revision:
    r = db.scalar(select(Revision).where(Revision.transcription_id == tid, Revision.number == number))
    if r is None:
        raise ServiceError(404, "Revision not found")
    return r


def latest_revision(db: Session, t: Transcription) -> Revision | None:
    if t.current_revision == 0:  # add_revision() is the only writer: 0 means "no score yet"
        return None
    return db.scalar(
        select(Revision).where(Revision.transcription_id == t.id, Revision.number == t.current_revision)
    )


def add_revision(db: Session, t: Transcription, score: Score, source: str) -> Revision:
    nxt = (db.scalar(select(Revision.number).where(Revision.transcription_id == t.id).order_by(Revision.number.desc()).limit(1)) or 0) + 1
    rev = Revision(transcription_id=t.id, number=nxt, score=score.model_dump(mode="json"), source=source)
    db.add(rev)
    t.current_revision = nxt
    db.flush()
    return rev


def load_analysis_for(db: Session, storage: Storage, t: Transcription) -> AnalysisModel:
    if not t.analysis_id:
        raise ServiceError(409, "This transcription has no analysis yet")
    row = db.get(Analysis, t.analysis_id)
    assert row is not None
    return storage.load_analysis(row.storage_key)


def reassemble(
    db: Session,
    storage: Storage,
    t: Transcription,
    params: AssemblyParams | None,
    range_s: tuple[float, float] | None,
) -> Revision:
    analysis = load_analysis_for(db, storage, t)
    prev_rev = latest_revision(db, t)
    previous = Score.model_validate(prev_rev.score) if prev_rev else None
    use = params or (previous.assembly_params if previous else AssemblyParams())
    score = assemble(analysis, use, previous=previous, range_s=range_s, title=t.title, analysis_id=t.analysis_id or "")
    return add_revision(db, t, score, "reassemble")


# ───────────────────────────── jobs: shared helpers ─────────────────────────────
def latest_job(db: Session, tid: str) -> Job | None:
    return db.scalar(select(Job).where(Job.transcription_id == tid).order_by(Job.created_at.desc()).limit(1))


def job_assets(db: Session, job_ids: list[str]) -> dict[str, list[tuple[str, MediaAsset]]]:
    """job id -> [(role, asset)], in one query."""
    out: dict[str, list[tuple[str, MediaAsset]]] = {j: [] for j in job_ids}
    if job_ids:
        rows = db.execute(
            select(JobInput.job_id, JobInput.role, MediaAsset)
            .join(MediaAsset, MediaAsset.id == JobInput.asset_id)
            .where(JobInput.job_id.in_(job_ids))
        )
        for job_id, role, asset in rows:
            out[job_id].append((role, asset))
    return out


def _add_job(db: Session, settings: Settings, t: Transcription, options: AnalysisOptions,
             assets: dict[str, MediaAsset], worker_target: str, **fields) -> Job:
    """A job row plus its input rows. `fields` override the defaults (e.g. a job that is already done)."""
    cache_key = compute_cache_key([(r, a.sha256) for r, a in assets.items()], options, settings.pipeline_version)
    job = Job(transcription_id=t.id, analysis_options=options.model_dump(), cache_key=cache_key,
              pipeline_version=settings.pipeline_version, worker_target=worker_target, **fields)
    db.add(job)
    db.flush()
    for role, a in assets.items():
        db.add(JobInput(job_id=job.id, role=role, asset_id=a.id))
    return job


# ───────────────────────────── transcription / jobs ─────────────────────────────
def create_transcription(
    db: Session,
    settings: Settings,
    storage: Storage,
    bus: EventBus,
    project_id: str,
    inputs: list[tuple[str, str]],  # (asset_id, role)
    options: AnalysisOptions,
    params: AssemblyParams,
    worker_target: str,
    title: str | None,
) -> tuple[Transcription, Job | None]:
    roles = {r for _, r in inputs}
    if not roles <= ROLES or not roles & {"wet", "di"}:
        raise ServiceError(422, "At least one input with role 'wet' or 'di' is required", code="needs_audio_input")
    if len(roles) != len(inputs):
        raise ServiceError(422, "Each role can be used only once")
    assets: dict[str, MediaAsset] = {}
    for aid, role in inputs:
        a = db.get(MediaAsset, aid)
        if a is None or a.project_id != project_id:
            raise ServiceError(404, f"Asset {aid} not found in this project")
        if role in ("wet", "di") and a.kind not in ("audio", "video"):
            raise ServiceError(422, "The audio input must be an audio file or a video with sound", code="audio_input_invalid")
        assets[role] = a
    cache_key = compute_cache_key([(r, a.sha256) for r, a in assets.items()], options, settings.pipeline_version)
    t = Transcription(
        project_id=project_id,
        title=title or next(iter(assets.values())).filename.rsplit(".", 1)[0][:120],
        analysis_options=options.model_dump(),
        assembly_params=params.model_dump(mode="json"),
    )
    db.add(t)
    db.flush()

    cached = db.scalar(select(Analysis).where(Analysis.cache_key == cache_key))
    if cached is not None:  # identical input + options already analysed: no GPU needed
        t.analysis_id = cached.id
        db.flush()
        score = assemble(storage.load_analysis(cached.storage_key), params, title=t.title, analysis_id=cached.id)
        add_revision(db, t, score, "auto")
        # a finished job row keeps the inputs (the UI needs the audio to play) without any worker
        _add_job(db, settings, t, options, assets, worker_target, status="succeeded", progress=1.0,
                 current_stage="done", message="Reused an existing analysis", finished_at=utcnow())
        db.commit()
        return t, None

    job = _add_job(db, settings, t, options, assets, worker_target)
    db.commit()
    return t, job


def job_snapshot(job: Job) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "stage": job.current_stage,
        "progress": round(job.progress, 3),
        "message": job.message,
        "error": job.error,
        "attempts": job.attempts,
        "worker_target": job.worker_target,
        "worker": job.lease_owner,
        "created_at": iso(job.created_at),
        "started_at": iso(job.started_at),
        "finished_at": iso(job.finished_at),
        "transcription_id": job.transcription_id,
    }


def get_job(db: Session, job_id: str) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise ServiceError(404, "Job not found")
    return job


def owned_job(db: Session, job_id: str, worker_id: str) -> Job:
    """The job, if this worker still holds its lease (else 409)."""
    return _owned(db, job_id, worker_id)


def _owned(db: Session, job_id: str, worker_id: str) -> Job:
    job = get_job(db, job_id)
    if job.status == "canceled":
        raise ServiceError(409, "Job was canceled")
    if job.status != "running" or job.lease_owner != worker_id:
        raise ServiceError(409, "This worker no longer holds the job (lease expired?)")
    return job


def touch_worker(db: Session, worker_id: str, location: str, caps: dict) -> None:
    w = db.get(Worker, worker_id)
    if w is None:
        db.add(Worker(id=worker_id, location=location, capabilities=caps, last_seen=utcnow()))
    else:
        w.location, w.capabilities, w.last_seen = location, caps, utcnow()


def lease_job(db: Session, settings: Settings, worker_id: str, location: str, caps: dict) -> dict | None:
    """Atomically claim the oldest queued job this worker may run (no two workers get the same job)."""
    touch_worker(db, worker_id, location, caps)
    now = utcnow()
    stmt = text(
        "UPDATE jobs SET status='running', lease_owner=:w, lease_expires_at=:exp, "
        "started_at=COALESCE(started_at, :now), current_stage='', progress=0, message='' "
        "WHERE id = (SELECT id FROM jobs WHERE status='queued' AND worker_target IN ('any', :loc) "
        "ORDER BY created_at LIMIT 1) RETURNING id"
    ).bindparams(bindparam("exp", type_=DateTime), bindparam("now", type_=DateTime))  # same storage format as the ORM
    row = db.execute(
        stmt,
        {"w": worker_id, "exp": now + timedelta(seconds=settings.lease_seconds), "now": now, "loc": location},
    ).first()
    db.commit()
    if row is None:
        return None
    job = get_job(db, row[0])
    inputs = [{"asset_id": a.id, "role": role, "sha256": a.sha256, "filename": a.filename, "size": a.size}
              for role, a in job_assets(db, [job.id])[job.id]]
    return {
        "job_id": job.id,
        "analysis_options": job.analysis_options,
        "inputs": inputs,
        "lease_expires_at": iso(job.lease_expires_at),
        "attempt": job.attempts,
    }


def heartbeat(db: Session, settings: Settings, job_id: str, worker_id: str) -> dict:
    if get_job(db, job_id).status == "canceled":
        return {"cancel": True}
    job = _owned(db, job_id, worker_id)
    now = utcnow()
    job.lease_expires_at = now + timedelta(seconds=settings.lease_seconds)
    w = db.get(Worker, worker_id)
    if w is not None:
        w.last_seen = now
    db.commit()
    return {"cancel": False}


def report_progress(db: Session, settings: Settings, bus: EventBus, job_id: str, worker_id: str, stage: str, progress: float, message: str) -> dict:
    job = db.get(Job, job_id)
    if job is not None and job.status == "canceled":
        return {"cancel": True}
    job = _owned(db, job_id, worker_id)
    job.current_stage, job.progress, job.message = stage[:30], float(progress), message[:300]
    job.lease_expires_at = utcnow() + timedelta(seconds=settings.lease_seconds)
    db.commit()
    bus.publish(job.id, "progress", {"stage": stage, "progress": round(progress, 3), "message": message})
    return {"cancel": False}


def complete_job(db: Session, settings: Settings, storage: Storage, bus: EventBus, job_id: str, worker_id: str, analysis: AnalysisModel) -> Transcription:
    job = _owned(db, job_id, worker_id)
    t = db.get(Transcription, job.transcription_id)
    assert t is not None
    row = db.scalar(select(Analysis).where(Analysis.cache_key == job.cache_key))
    if row is None:
        aid = new_id()
        key = storage.save_analysis(aid, analysis)
        row = Analysis(id=aid, cache_key=job.cache_key, storage_key=key, pipeline_version=job.pipeline_version, quality=analysis.quality.model_dump())
        db.add(row)
        db.flush()
    t.analysis_id = row.id
    # keep what the user set since (capo, tuning, tempo...) when a re-analysis (e.g. with video) lands
    prev = latest_revision(db, t)
    if prev is not None:
        params = Score.model_validate(prev.score).assembly_params
    else:
        params = AssemblyParams.model_validate(t.assembly_params) if t.assembly_params else AssemblyParams()
    score = assemble(analysis, params, title=t.title, analysis_id=row.id)
    add_revision(db, t, score, "auto")
    job.status, job.progress, job.current_stage, job.finished_at, job.error = "succeeded", 1.0, "done", utcnow(), None
    job.lease_owner, job.lease_expires_at = None, None
    db.commit()
    bus.publish(job.id, "done", {"transcription_id": t.id})
    return t


def _end_attempt(job: Job, settings: Settings, bus: EventBus, retry: bool, retry_msg: str, fail_error: str) -> str | None:
    """The worker gave the job back (error) or vanished (lease expired): queue it again, or fail it for good.
    Returns the retry message when the job went back to the queue."""
    job.attempts += 1
    job.lease_owner, job.lease_expires_at = None, None
    if retry and job.attempts < settings.max_attempts:
        job.status = "queued"
        bus.publish(job.id, "progress", {"stage": "retry", "progress": 0.0, "message": retry_msg})
        return retry_msg
    job.status, job.finished_at, job.error = "failed", utcnow(), fail_error
    bus.publish(job.id, "error", {"error": job.error})
    return None


def fail_job(db: Session, settings: Settings, bus: EventBus, job_id: str, worker_id: str, error: str, retriable: bool) -> Job:
    job = _owned(db, job_id, worker_id)
    job.error = error[:1000]
    _end_attempt(job, settings, bus, retriable, "Temporary error, retrying", job.error)
    db.commit()
    return job


def cancel_job(db: Session, bus: EventBus, job_id: str) -> Job:
    job = get_job(db, job_id)
    if job.status in ACTIVE:
        job.status, job.finished_at, job.error = "canceled", utcnow(), "Canceled"
        db.commit()
        bus.publish(job.id, "error", {"error": "Canceled", "canceled": True})
    return job


def reap_expired(db: Session, settings: Settings, bus: EventBus) -> int:
    """Jobs whose lease expired go back to the queue (or fail after max attempts)."""
    n = 0
    now = utcnow()
    for job in db.scalars(select(Job).where(Job.status == "running", Job.lease_expires_at < now)):
        msg = _end_attempt(job, settings, bus, True, "Worker lost connection, re-queuing",
                           "Worker stopped responding (lease timed out)")
        if msg:
            job.message = msg
        n += 1
    if n:
        db.commit()
    return n


def online_workers(db: Session, within_s: int = 30) -> list[Worker]:
    cutoff = utcnow() - timedelta(seconds=within_s)
    return list(db.scalars(select(Worker).where(Worker.last_seen >= cutoff)))


def start_video_analysis(db: Session, settings: Settings, t: Transcription, calibration: VideoCalibration,
                         worker_target: str = "any") -> Job:
    """Re-run the analysis of a transcription with its video and a fretboard calibration."""
    last = latest_job(db, t.id)
    if last is None:
        raise ServiceError(409, "This transcription has no input files")
    assets = dict(job_assets(db, [last.id])[last.id])
    if not any(a.kind == "video" for a in assets.values()):
        raise ServiceError(422, "This transcription has no video. Upload a video with the guitar audible.", code="no_video")
    if last.status in ACTIVE:
        raise ServiceError(409, "An analysis is already running for this transcription", code="analysis_running")
    options = AnalysisOptions.model_validate(last.analysis_options)
    options.use_video = True
    options.video_calibration = calibration
    job = _add_job(db, settings, t, options, assets, worker_target)
    t.analysis_options = options.model_dump()
    db.commit()
    return job


# ───────────────────────────── read models ─────────────────────────────
def get_transcription(db: Session, tid: str) -> Transcription:
    t = db.get(Transcription, tid)
    if t is None:
        raise ServiceError(404, "Transcription not found", code="tab_not_found")
    return t


def asset_view(a: MediaAsset) -> dict:
    return {"asset_id": a.id, "project_id": a.project_id, "kind": a.kind, "filename": a.filename, "size": a.size,
            "duration_s": a.duration_s, "sha256": a.sha256, "mime": a.mime}


def transcription_views(db: Session, ts: list[Transcription], with_score: bool = True) -> list[dict]:
    """What the SPA gets for each transcription. A constant number of queries for any number of rows."""
    ids = [t.id for t in ts]
    jobs: dict[str, Job] = {}
    for job in db.scalars(select(Job).where(Job.transcription_id.in_(ids)).order_by(Job.created_at)):
        jobs[job.transcription_id] = job  # ascending: the last one wins = the latest job
    inputs = job_assets(db, [j.id for j in jobs.values()])
    analysis_ids = {t.analysis_id for t in ts if t.analysis_id}
    quality = {a.id: a.quality for a in db.scalars(select(Analysis).where(Analysis.id.in_(analysis_ids)))} if analysis_ids else {}

    out = []
    for t in ts:
        job = jobs.get(t.id)
        has_score = t.current_revision > 0
        if job and job.status in ACTIVE:
            status = job.status  # a running re-analysis (e.g. with video) takes over the page until it finishes
        else:
            status = "ready" if has_score else (job.status if job else "empty")
        view = {
            "id": t.id,
            "project_id": t.project_id,
            "title": t.title,
            "analysis_id": t.analysis_id,
            "current_revision": t.current_revision,
            "created_at": iso(t.created_at),
            "job": job_snapshot(job) if job else None,
            "status": status,
            "assembly_params": t.assembly_params,
        }
        if with_score and has_score:
            rev = latest_revision(db, t)
            if rev is not None:
                view["score"] = rev.score
                view["revision_source"] = rev.source
        if t.analysis_id:
            view["quality"] = quality.get(t.analysis_id)
        view["inputs"] = [{"role": role, **asset_view(a)} for role, a in inputs.get(job.id, [])] if job else []
        out.append(view)
    return out


def transcription_view(db: Session, t: Transcription) -> dict:
    return transcription_views(db, [t])[0]

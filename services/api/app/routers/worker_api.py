"""Worker protocol (docs §8.2): lease / heartbeat / progress / asset content / analysis / fail.

The only routes that may be exposed through a tunnel (bearer WORKER_TOKEN).
"""

from __future__ import annotations

import gzip
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from taber_ir.models import Analysis

from .. import service as svc
from ..config import Settings
from ..db import MediaAsset
from ..deps import get_bus, get_db, get_settings_dep, get_storage, require_worker
from ..events import EventBus
from ..storage import Storage

router = APIRouter(prefix="/api/v1/worker", dependencies=[Depends(require_worker)])

MAX_ANALYSIS_BYTES = 100 * 1024 * 1024  # Cloudflare's free request-body cap


class LeaseIn(BaseModel):
    worker_id: str = Field(min_length=1, max_length=100)
    location: str = "local"
    capabilities: dict = Field(default_factory=dict)


class ProgressIn(BaseModel):
    worker_id: str
    stage: str
    progress: float = Field(ge=0, le=1)
    message: str = ""


class WorkerRef(BaseModel):
    worker_id: str


class FailIn(BaseModel):
    worker_id: str
    error: str
    retriable: bool = True


@router.post("/lease")
def lease(body: LeaseIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    job = svc.lease_job(db, settings, body.worker_id, body.location, body.capabilities)
    if job is None:
        return Response(status_code=204)
    return job


@router.post("/jobs/{job_id}/heartbeat")
def heartbeat(job_id: str, body: WorkerRef, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    return svc.heartbeat(db, settings, job_id, body.worker_id)


@router.post("/jobs/{job_id}/progress")
def progress(
    job_id: str, body: ProgressIn, db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep), bus: EventBus = Depends(get_bus),
):
    return svc.report_progress(db, settings, bus, job_id, body.worker_id, body.stage, body.progress, body.message)


@router.get("/assets/{asset_id}/content")
def asset_content(asset_id: str, db: Session = Depends(get_db), storage: Storage = Depends(get_storage)):
    a = db.get(MediaAsset, asset_id)
    if a is None:
        raise svc.ServiceError(404, "Asset not found")
    return FileResponse(storage.resolve(a.storage_key), media_type="application/octet-stream", filename=a.filename)


@router.post("/jobs/{job_id}/stems/{role}", status_code=204)
async def submit_stem(
    job_id: str, role: Literal["guitar", "backing"], request: Request, worker_id: str,
    db: Session = Depends(get_db), storage: Storage = Depends(get_storage),
):
    """A listening stem (AAC in .m4a) of the job's separation; the editor plays it instead of the original."""
    job = svc.owned_job(db, job_id, worker_id)
    path = storage.stem_path(job.cache_key, role)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    size = 0
    try:
        with open(tmp, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_ANALYSIS_BYTES:
                    raise HTTPException(413, "Stem too large")
                f.write(chunk)
        if size == 0:
            raise HTTPException(422, "Empty stem")
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
    return Response(status_code=204)


@router.post("/jobs/{job_id}/analysis")
async def submit_analysis(
    job_id: str, request: Request, worker_id: str,
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep),
    storage: Storage = Depends(get_storage), bus: EventBus = Depends(get_bus),
):
    raw = await request.body()
    if len(raw) > MAX_ANALYSIS_BYTES:
        raise HTTPException(413, "Analysis too large")
    if request.headers.get("content-encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    try:
        analysis = Analysis.model_validate(json.loads(raw))
    except Exception as e:
        raise HTTPException(422, f"Invalid analysis: {str(e)[:200]}") from e
    t = svc.complete_job(db, settings, storage, bus, job_id, worker_id, analysis)
    return {"transcription_id": t.id}


@router.post("/jobs/{job_id}/fail")
def fail(
    job_id: str, body: FailIn, db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep), bus: EventBus = Depends(get_bus),
):
    job = svc.fail_job(db, settings, bus, job_id, body.worker_id, body.error, body.retriable)
    return {"status": job.status, "attempts": job.attempts}

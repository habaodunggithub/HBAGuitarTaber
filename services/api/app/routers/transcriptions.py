"""Projects, transcriptions (tabs), their revisions, and exports."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from taber_ir.export import FORMATS, export, score_to_alphatex
from taber_ir.models import AnalysisOptions, AssemblyParams, Score, VideoCalibration

from .. import service as svc
from ..config import Settings
from ..db import Project, Revision, Transcription, iso
from ..deps import get_bus, get_db, get_settings_dep, get_storage
from ..events import EventBus
from ..service import ServiceError
from ..storage import Storage

router = APIRouter(prefix="/api/v1")

WorkerTarget = Literal["any", "local", "kaggle"]


class ProjectIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class InputRef(BaseModel):
    asset_id: str
    role: Literal["wet", "di", "video"]


class CreateTranscription(BaseModel):
    inputs: list[InputRef]
    analysis_options: AnalysisOptions = Field(default_factory=AnalysisOptions)
    assembly_params: AssemblyParams = Field(default_factory=AssemblyParams)
    worker_target: WorkerTarget = "any"
    title: str | None = None


class TimeRange(BaseModel):
    from_s: float
    to_s: float


class ReassembleIn(BaseModel):
    assembly_params: AssemblyParams | None = None
    range: TimeRange | None = None


class VideoIn(BaseModel):
    calibration: VideoCalibration
    worker_target: WorkerTarget = "any"


def _project_view(p: Project) -> dict:
    return {"id": p.id, "title": p.title, "created_at": iso(p.created_at)}


# ───────────────────────────── projects ─────────────────────────────


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    p = Project(title=body.title)
    db.add(p)
    db.commit()
    return _project_view(p)


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    return [_project_view(p) for p in db.scalars(select(Project).order_by(Project.created_at.desc()))]


# ───────────────────────────── transcriptions ─────────────────────────────


@router.post("/projects/{project_id}/transcriptions", status_code=201)
def create_transcription(
    project_id: str,
    body: CreateTranscription,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    storage: Storage = Depends(get_storage),
    bus: EventBus = Depends(get_bus),
):
    if db.get(Project, project_id) is None:
        raise ServiceError(404, "Project not found")
    t, job = svc.create_transcription(
        db, settings, storage, bus, project_id, [(i.asset_id, i.role) for i in body.inputs],
        body.analysis_options, body.assembly_params, body.worker_target, body.title,
    )
    return {"transcription_id": t.id, "job_id": job.id if job else None, "cached": job is None}


@router.get("/transcriptions")
def list_transcriptions(db: Session = Depends(get_db), limit: int = Query(50, le=200)):
    rows = list(db.scalars(select(Transcription).order_by(Transcription.created_at.desc()).limit(limit)))
    return svc.transcription_views(db, rows, with_score=False)


@router.get("/transcriptions/{tid}")
def get_transcription(tid: str, db: Session = Depends(get_db)):
    return svc.transcription_view(db, svc.get_transcription(db, tid))


@router.get("/transcriptions/{tid}/analysis")
def get_analysis(tid: str, db: Session = Depends(get_db), storage: Storage = Depends(get_storage)):
    return svc.load_analysis_for(db, storage, svc.get_transcription(db, tid)).model_dump(mode="json")


@router.post("/transcriptions/{tid}/reassemble")
def reassemble(
    tid: str, body: ReassembleIn, db: Session = Depends(get_db), storage: Storage = Depends(get_storage),
):
    t = svc.get_transcription(db, tid)
    rng = (body.range.from_s, body.range.to_s) if body.range else None
    if rng and rng[1] < rng[0]:
        raise ServiceError(422, "Invalid time range")
    svc.reassemble(db, storage, t, body.assembly_params, rng)
    db.commit()
    return svc.transcription_view(db, t)


@router.put("/transcriptions/{tid}")
def save_score(tid: str, score: Score, db: Session = Depends(get_db)):
    t = svc.get_transcription(db, tid)
    svc.add_revision(db, t, score, "user")
    db.commit()
    return svc.transcription_view(db, t)


@router.patch("/transcriptions/{tid}")
def rename(tid: str, body: ProjectIn, db: Session = Depends(get_db)):
    t = svc.get_transcription(db, tid)
    t.title = body.title
    db.commit()
    return {"id": t.id, "title": t.title}


@router.get("/transcriptions/{tid}/revisions")
def revisions(tid: str, db: Session = Depends(get_db)):
    svc.get_transcription(db, tid)
    return [{"number": r.number, "source": r.source, "created_at": iso(r.created_at)}
            for r in db.scalars(select(Revision).where(Revision.transcription_id == tid).order_by(Revision.number.desc()))]


@router.get("/transcriptions/{tid}/revisions/{number}")
def get_revision(tid: str, number: int, db: Session = Depends(get_db)):
    return svc.get_revision(db, tid, number).score


@router.post("/transcriptions/{tid}/revisions/{number}/restore")
def restore_revision(tid: str, number: int, db: Session = Depends(get_db)):
    t = svc.get_transcription(db, tid)
    r = svc.get_revision(db, tid, number)
    svc.add_revision(db, t, Score.model_validate(r.score), "user")
    db.commit()
    return svc.transcription_view(db, t)


@router.post("/alphatex")
def render_alphatex(score: Score):
    """alphaTex for a Score that is not saved (live editor preview). Stateless."""
    return Response(score_to_alphatex(score), media_type="text/plain; charset=utf-8")


@router.post("/transcriptions/{tid}/video", status_code=201)
def analyse_with_video(tid: str, body: VideoIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings_dep)):
    """Re-analyse with the video: fingertips on the calibrated fretboard steer the string/fret choice."""
    t = svc.get_transcription(db, tid)
    if body.calibration.fret_b <= body.calibration.fret_a:
        raise ServiceError(422, "The second fret must be higher than the first")
    job = svc.start_video_analysis(db, settings, t, body.calibration, body.worker_target)
    return {"job_id": job.id}


@router.get("/transcriptions/{tid}/export")
def export_score(tid: str, format: str = Query("gp5"), db: Session = Depends(get_db)):
    if format not in FORMATS:
        raise ServiceError(422, f"format must be one of {sorted(FORMATS)}")
    t = svc.get_transcription(db, tid)
    rev = svc.latest_revision(db, t)
    if rev is None:
        raise ServiceError(409, "The transcription is not ready yet")
    mime, ext = FORMATS[format]
    safe = "".join(c if c.isalnum() or c in "-_ ." else "_" for c in t.title).strip() or "tab"
    return Response(
        export(Score.model_validate(rev.score), format), media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{safe}.{ext}"'},
    )

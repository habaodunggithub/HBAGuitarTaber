"""Uploads and the files behind them (audio / video playback, video frames)."""

from __future__ import annotations

import asyncio
import hashlib
import shutil

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import media
from .. import service as svc
from ..config import Settings
from ..db import MediaAsset, Project, new_id
from ..deps import get_db, get_settings_dep, get_storage
from ..service import ServiceError
from ..storage import Storage

router = APIRouter(prefix="/api/v1")


def default_project(db: Session) -> Project:
    p = db.scalar(select(Project).order_by(Project.created_at).limit(1))
    if p is None:
        p = Project(title="Default")
        db.add(p)
        db.commit()
    return p


def _asset(db: Session, asset_id: str) -> MediaAsset:
    a = db.get(MediaAsset, asset_id)
    if a is None:
        raise ServiceError(404, "Asset not found")
    return a


@router.post("/uploads", status_code=201)
async def upload(
    file: UploadFile = File(...),
    project_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
    storage: Storage = Depends(get_storage),
):
    project = db.get(Project, project_id) if project_id else default_project(db)
    if project is None:
        raise ServiceError(404, "Project not found")
    asset_id = new_id()
    key, path = storage.asset_path(asset_id, file.filename or "upload.bin")
    limit = settings.max_video_mb * media.MB
    h, size = hashlib.sha256(), 0
    try:
        with open(path, "wb") as out:
            while chunk := await file.read(media.MB):
                size += len(chunk)
                if size > limit:
                    raise ServiceError(413, f"File is larger than {settings.max_video_mb} MB", code="file_too_large", params={"mb": settings.max_video_mb})
                h.update(chunk)
                out.write(chunk)
        info = await asyncio.to_thread(media.inspect, path, size, settings)
    except BaseException:
        shutil.rmtree(path.parent, ignore_errors=True)
        raise
    asset = MediaAsset(
        id=asset_id, project_id=project.id, kind=info.kind, filename=(file.filename or "upload")[:300],
        storage_key=key, mime=file.content_type or "", size=size, duration_s=info.duration_s,
        probe=info.probe, sha256=h.hexdigest(),
    )
    db.add(asset)
    db.commit()
    return svc.asset_view(asset)


@router.get("/assets/{asset_id}/content")
def asset_content(asset_id: str, db: Session = Depends(get_db), storage: Storage = Depends(get_storage)):
    """Original file (the SPA plays the wet audio / video from here)."""
    a = _asset(db, asset_id)
    return FileResponse(storage.resolve(a.storage_key), media_type=a.mime or "application/octet-stream", filename=a.filename)


@router.get("/assets/{asset_id}/frame")
async def asset_frame(asset_id: str, t: float = Query(0.0, ge=0), db: Session = Depends(get_db), storage: Storage = Depends(get_storage)):
    """One video frame as JPEG (for the fretboard calibration). ffmpeg applies the phone's rotation."""
    a = _asset(db, asset_id)
    if a.kind != "video":
        raise ServiceError(422, "This asset is not a video")
    jpeg = await asyncio.to_thread(media.frame_jpeg, storage.resolve(a.storage_key), t)
    return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})

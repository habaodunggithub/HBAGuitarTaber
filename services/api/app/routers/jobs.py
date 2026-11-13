"""Analysis jobs as the SPA sees them: status, cancel, live progress (SSE), and who is working."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from .. import service as svc
from ..db import iso
from ..deps import get_bus, get_db
from ..events import EventBus

router = APIRouter(prefix="/api/v1")

TERMINAL_EVENTS = ("done", "error")


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    return svc.job_snapshot(svc.get_job(db, job_id))


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, db: Session = Depends(get_db), bus: EventBus = Depends(get_bus)):
    return svc.job_snapshot(svc.cancel_job(db, bus, job_id))


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request, db: Session = Depends(get_db), bus: EventBus = Depends(get_bus)):
    snap = svc.job_snapshot(svc.get_job(db, job_id))
    q, unsubscribe = bus.subscribe(job_id)

    async def gen():
        try:
            yield {"event": "snapshot", "data": json.dumps(snap)}
            if snap["status"] == "succeeded":
                yield {"event": "done", "data": json.dumps({"transcription_id": snap["transcription_id"]})}
                return
            if snap["status"] in ("failed", "canceled"):
                yield {"event": "error", "data": json.dumps({"error": snap["error"]})}
                return
            while not await request.is_disconnected():
                try:
                    event, data = await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                yield {"event": event, "data": json.dumps(data)}
                if event in TERMINAL_EVENTS:
                    return
        finally:
            unsubscribe()

    return EventSourceResponse(gen(), ping=20)


@router.get("/workers")
def workers(db: Session = Depends(get_db)):
    return [{"id": w.id, "location": w.location, "capabilities": w.capabilities, "last_seen": iso(w.last_seen)}
            for w in svc.online_workers(db)]

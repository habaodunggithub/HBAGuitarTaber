"""FastAPI app: REST + SSE + static SPA. Run as ONE process (SSE bus is in-process)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import service as svc
from .config import Settings, get_settings
from .db import Database
from .events import EventBus
from .routers import jobs, media, transcriptions, worker_api
from .storage import LocalStorage

log = logging.getLogger("taber.api")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.ensure_dirs()
    db = Database(settings.db_url)
    db.create_all()
    bus = EventBus()
    token = settings.resolve_worker_token()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        async def reaper() -> None:
            while True:
                await asyncio.sleep(settings.reaper_interval_s)
                try:
                    with db.session_factory() as s:
                        n = await asyncio.to_thread(svc.reap_expired, s, settings, bus)
                    if n:
                        log.warning("reaper: %d job(s) lost their worker", n)
                except Exception:  # never let the reaper die
                    log.exception("reaper failed")

        task = asyncio.create_task(reaper())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="HBA Guitar Taber", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = db
    app.state.bus = bus
    app.state.storage = LocalStorage(settings.data_dir)
    app.state.worker_token = token

    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"],
    )
    if settings.trusted_hosts:  # added last = runs first: a rebound Host is rejected before anything else
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)

    @app.exception_handler(svc.ServiceError)
    async def _svc_err(_, exc: svc.ServiceError):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    for r in (media.router, transcriptions.router, jobs.router):
        app.include_router(r)
    app.include_router(worker_api.router)

    @app.get("/api/v1/health")
    def health():
        return {"ok": True, "version": app.version}

    spa: Path = settings.spa_dir
    if spa.exists() and (spa / "index.html").exists():
        if (spa / "assets").exists():
            app.mount("/assets", StaticFiles(directory=spa / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa_fallback(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            candidate = (spa / path).resolve()
            if path and spa.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(spa / "index.html")

    return app


def run() -> None:
    import uvicorn

    s = get_settings()
    s.ensure_dirs()
    print(f"worker token file: {s.data_dir / 'worker_token'}")
    uvicorn.run(create_app(s), host=s.host, port=s.port, log_level="info")


app = None  # created lazily by `uvicorn app.main:create_app --factory`

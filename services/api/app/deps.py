from __future__ import annotations

import hmac
from collections.abc import Iterator

from fastapi import Header, HTTPException, Request
from sqlalchemy.orm import Session

from .config import Settings
from .db import Database
from .events import EventBus
from .storage import Storage


def get_db(request: Request) -> Iterator[Session]:
    database: Database = request.app.state.db
    with database.session_factory() as s:
        yield s


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_storage(request: Request) -> Storage:
    return request.app.state.storage


def get_bus(request: Request) -> EventBus:
    return request.app.state.bus


def require_worker(request: Request, authorization: str | None = Header(default=None)) -> None:
    token: str = request.app.state.worker_token
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not given or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="Invalid WORKER_TOKEN")

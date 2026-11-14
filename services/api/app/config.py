from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TABER_", env_file=".env", extra="ignore")

    data_dir: Path = REPO_ROOT / "data"
    host: str = "127.0.0.1"
    port: int = 8000
    worker_token: str | None = None  # generated and stored in data/worker_token when unset
    spa_dir: Path = REPO_ROOT / "apps" / "web" / "dist"
    max_audio_mb: int = 50
    max_video_mb: int = 1024
    max_duration_s: int = 600
    lease_seconds: int = 120
    reaper_interval_s: float = 30.0
    max_attempts: int = 2  # 1 retry
    pipeline_version: str = "0.2.1"  # keep equal to taber_ml.pipeline.PIPELINE_VERSION: part of the analysis cache key
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'taber.db'}"

    def ensure_dirs(self) -> None:
        for sub in ("assets", "analyses", "debug"):
            (self.data_dir / sub).mkdir(parents=True, exist_ok=True)

    def resolve_worker_token(self) -> str:
        if self.worker_token:
            return self.worker_token
        f = self.data_dir / "worker_token"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if f.exists():
            return f.read_text().strip()
        tok = secrets.token_urlsafe(32)
        f.write_text(tok)
        try:
            f.chmod(0o600)
        except OSError:
            pass
        return tok


@lru_cache
def get_settings() -> Settings:
    return Settings()

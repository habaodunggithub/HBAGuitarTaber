"""Your own test set: tabs you have checked, kept as ground truth (docs §12).

``data/truth/<transcription id>/`` holds ``truth.json`` (taber_ir.truth.TruthTake), copies of the
input files and the machine's analysis at the time. The folder is self-contained, so it can be
zipped into a Kaggle dataset, and ``taber truth-eval data/truth`` measures any pipeline on it.
"""

from __future__ import annotations

import gzip
import shutil
from pathlib import Path

from sqlalchemy.orm import Session
from taber_ir.models import Score
from taber_ir.truth import TruthTake, truth_notes

from . import service as svc
from .db import Transcription, iso, utcnow
from .service import ServiceError
from .storage import Storage


def folder(storage: Storage, tid: str) -> Path:
    return storage.resolve(f"truth/{tid}")


def info(storage: Storage, tid: str) -> dict | None:
    f = folder(storage, tid) / "truth.json"
    if not f.exists():
        return None
    take = TruthTake.model_validate_json(f.read_text(encoding="utf-8"))
    grid = sum(1 for n in take.notes if n.timing == "grid")
    return {"revision": take.revision, "created_at": take.created_at, "notes": len(take.notes), "added_notes": grid}


def save(db: Session, storage: Storage, t: Transcription) -> dict:
    """Snapshot the current revision as ground truth (replaces an earlier snapshot of this take)."""
    rev = svc.latest_revision(db, t)
    if rev is None:
        raise ServiceError(409, "The transcription is not ready yet")
    analysis = svc.load_analysis_for(db, storage, t)
    job = svc.latest_job(db, t.id)
    assets = svc.job_assets(db, [job.id])[job.id] if job else []
    if not any(role in ("wet", "di") for role, _a in assets):
        raise ServiceError(409, "This transcription has no audio input")
    score = Score.model_validate(rev.score)

    out = folder(storage, t.id)
    tmp = out.with_name(out.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    inputs: dict[str, str] = {}
    for role, a in assets:
        src = storage.resolve(a.storage_key)
        name = f"{role}{src.suffix}"
        shutil.copy2(src, tmp / name)
        inputs[role] = name
    with gzip.open(tmp / "analysis.json.gz", "wt", encoding="utf-8") as f:
        f.write(analysis.model_dump_json())
    take = TruthTake(
        title=t.title, transcription_id=t.id, revision=rev.number, created_at=iso(utcnow()) or "",
        tuning=score.assembly_params.tuning, inputs=inputs,
        analysis_options=(job.analysis_options if job else {}),
        tempo_bpm=score.measures[0].tempo_bpm if score.measures else None,
        notes=truth_notes(score, analysis),
    )
    (tmp / "truth.json").write_text(take.model_dump_json(indent=1), encoding="utf-8")
    shutil.rmtree(out, ignore_errors=True)
    tmp.rename(out)
    return info(storage, t.id) or {}


def delete(storage: Storage, tid: str) -> None:
    shutil.rmtree(folder(storage, tid), ignore_errors=True)

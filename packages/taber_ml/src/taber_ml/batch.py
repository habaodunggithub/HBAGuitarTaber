"""Batch transcription over a folder, one process per GPU (docs §8.6, Kaggle batch mode).

Meant for Kaggle (2x T4) but works anywhere: GPUs are given as CUDA indices, ``None`` means CPU.
Each file's result is written the moment it is done and finished files are skipped on the next run,
so a session that gets killed loses at most the files in flight.
"""

from __future__ import annotations

import csv
import json
import multiprocessing as mp
import os
import time
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path

from taber_ir.export import FORMATS, export
from taber_ir.models import AnalysisOptions, AssemblyParams

AUDIO_EXT = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".mp4", ".mov", ".webm"}


@dataclass
class BatchConfig:
    out_dir: str
    tracker: str = "auto"
    options: dict = field(default_factory=lambda: AnalysisOptions().model_dump())
    params: dict = field(default_factory=lambda: AssemblyParams().model_dump(mode="json"))
    formats: str = "gp5,ascii,midi,alphatex,musicxml"
    skip_done: bool = True


def find_inputs(root: str | Path) -> list[Path]:
    """Audio files under ``root``. A ``name.di.<ext>`` file is the DI take for ``name.<ext>``."""
    root = Path(root)
    files = [root] if root.is_file() else sorted(p for p in root.rglob("*") if p.suffix.lower() in AUDIO_EXT)
    return [p for p in files if ".di" not in p.suffixes[:-1]]  # DI files are picked up with their wet take


def _di_for(wet: Path) -> Path | None:
    for ext in AUDIO_EXT:
        cand = wet.with_name(f"{wet.stem}.di{ext}")
        if cand.exists():
            return cand
    return None


_WORKER_MODELS = None


def _init_worker(gpu_queue) -> None:
    """Pin this process to one GPU *before* torch is imported (spawned interpreters are fresh)."""
    gpu = gpu_queue.get()
    if gpu is None:
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    else:
        os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu)


def _process(args: tuple[str, dict]) -> dict:
    global _WORKER_MODELS
    path_s, cfg_d = args
    cfg = BatchConfig(**cfg_d)
    path = Path(path_s)
    out = Path(cfg.out_dir) / path.stem
    t0 = time.perf_counter()
    row = {"file": path.name, "status": "ok", "notes": 0, "measures": 0, "seconds": 0.0, "device": "", "error": ""}
    try:
        from taber_ir import assemble

        from .io.local_dir import LocalDirIO, load_analysis
        from .models import ModelRegistry
        from .pipeline import JobSpec, run_analysis

        if _WORKER_MODELS is None:
            _WORKER_MODELS = ModelRegistry()
        models = _WORKER_MODELS
        row["device"] = models.device
        done = out / "analysis.json.gz"
        if cfg.skip_done and done.exists():
            analysis = load_analysis(done)
            row["status"] = "skipped"
        else:
            inputs = {"wet": str(path)}
            di = _di_for(path)
            if di is not None:
                inputs["di"] = str(di)
            spec = JobSpec(options=AnalysisOptions(**cfg.options), inputs=inputs, tracker=cfg.tracker)
            analysis = run_analysis(spec, LocalDirIO(inputs, out_dir=out), models)
        score = assemble(analysis, AssemblyParams.model_validate(cfg.params), title=path.stem)
        out.mkdir(parents=True, exist_ok=True)
        (out / "score.json").write_text(score.model_dump_json(indent=1), encoding="utf-8")
        for fmt in [f.strip() for f in cfg.formats.split(",") if f.strip()]:
            (out / f"{path.stem}.{FORMATS[fmt][1]}").write_bytes(export(score, fmt))
        row["notes"] = len(analysis.notes)
        row["measures"] = len(score.measures)
    except Exception as e:  # noqa: BLE001 - one bad file must not stop the batch
        row["status"] = "error"
        row["error"] = f"{type(e).__name__}: {e}"
        out.mkdir(parents=True, exist_ok=True)
        (out / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
    row["seconds"] = round(time.perf_counter() - t0, 2)
    return row


def run_batch(files: list[Path], cfg: BatchConfig, gpus: list[int | None] | None = None) -> list[dict]:
    """Process ``files`` with one worker per entry of ``gpus``; returns one summary row per file."""
    gpus = gpus or [None]
    out_dir = Path(cfg.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    for g in gpus:
        q.put(g)
    rows: list[dict] = []
    jobs = [(str(f), asdict(cfg)) for f in files]
    with ctx.Pool(processes=len(gpus), initializer=_init_worker, initargs=(q,)) as pool:
        for row in pool.imap_unordered(_process, jobs):
            rows.append(row)
            print(f"[{len(rows)}/{len(jobs)}] {row['file']}: {row['status']} "
                  f"{row['notes']} notes {row['seconds']}s {row['error']}", flush=True)
            _write_summary(out_dir, rows)
    return rows


def _write_summary(out_dir: Path, rows: list[dict]) -> None:
    cols = ["file", "status", "notes", "measures", "seconds", "device", "error"]
    with open(out_dir / "summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["file"]))
    (out_dir / "summary.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")


def parse_gpus(spec: str | None) -> list[int | None]:
    """'0,1' -> [0, 1]; 'cpu' or 'cpu,cpu' -> CPU workers; None -> all visible CUDA devices (else one CPU worker)."""
    if spec:
        return [None if s.strip().lower() == "cpu" else int(s) for s in spec.split(",") if s.strip()]
    try:
        import torch

        n = torch.cuda.device_count()
        return list(range(n)) if n else [None]
    except Exception:  # noqa: BLE001
        return [None]

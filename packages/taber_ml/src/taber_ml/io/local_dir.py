"""LocalDirIO: JobIO adapter for CLI, tests and Kaggle batch mode."""

from __future__ import annotations

import gzip
import sys
from collections.abc import Callable
from pathlib import Path

from taber_ir.models import Analysis


class LocalDirIO:
    def __init__(
        self,
        inputs: dict[str, str | Path],
        out_dir: str | Path | None = None,
        verbose: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
    ):
        self.inputs = {k: Path(v) for k, v in inputs.items()}
        self.out_dir = Path(out_dir) if out_dir else None
        self.verbose = verbose
        self.on_progress = on_progress
        self.analysis: Analysis | None = None

    # JobIO
    def fetch_input(self, asset_id: str) -> Path:
        p = self.inputs.get(asset_id) or Path(asset_id)
        if not p.exists():
            raise FileNotFoundError(p)
        return p

    def report(self, stage: str, progress: float, message: str = "") -> None:
        if self.verbose:
            print(f"[{progress * 100:5.1f}%] {stage}: {message}", file=sys.stderr)
        if self.on_progress:
            self.on_progress(stage, progress, message)

    def is_canceled(self) -> bool:
        return False

    def submit(self, analysis: Analysis) -> None:
        self.analysis = analysis
        if self.out_dir:
            self.out_dir.mkdir(parents=True, exist_ok=True)
            save_analysis(analysis, self.out_dir / "analysis.json.gz")


def save_analysis(a: Analysis, path: str | Path) -> None:
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(a.model_dump_json())


def load_analysis(path: str | Path) -> Analysis:
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as f:  # type: ignore[operator]
        return Analysis.model_validate_json(f.read())

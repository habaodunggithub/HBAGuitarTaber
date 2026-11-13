"""Storage interface: LocalFS now, S3/R2 when public (docs ADR-008)."""

from __future__ import annotations

import gzip
import shutil
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Protocol

from taber_ir.models import Analysis


class Storage(Protocol):
    def asset_path(self, asset_id: str, filename: str) -> tuple[str, Path]: ...
    def resolve(self, storage_key: str) -> Path: ...
    def save_analysis(self, analysis_id: str, analysis: Analysis) -> str: ...
    def load_analysis(self, storage_key: str) -> Analysis: ...
    def delete(self, storage_key: str) -> None: ...


class LocalStorage:
    def __init__(self, root: Path, cache_size: int = 16):
        self.root = Path(root)
        self._cache: OrderedDict[str, Analysis] = OrderedDict()
        self._cache_size = cache_size
        self._lock = threading.Lock()

    def asset_path(self, asset_id: str, filename: str) -> tuple[str, Path]:
        ext = Path(filename).suffix.lower()[:10] or ".bin"
        key = f"assets/{asset_id}/original{ext}"
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        return key, path

    def resolve(self, storage_key: str) -> Path:
        p = (self.root / storage_key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("storage key escapes the data directory")
        return p

    def save_analysis(self, analysis_id: str, analysis: Analysis) -> str:
        key = f"analyses/{analysis_id}.json.gz"
        path = self.resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            f.write(analysis.model_dump_json())
        tmp.replace(path)
        with self._lock:
            self._cache[key] = analysis
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return key

    def load_analysis(self, storage_key: str) -> Analysis:
        with self._lock:
            if storage_key in self._cache:
                self._cache.move_to_end(storage_key)
                return self._cache[storage_key]
        with gzip.open(self.resolve(storage_key), "rt", encoding="utf-8") as f:
            a = Analysis.model_validate_json(f.read())
        with self._lock:
            self._cache[storage_key] = a
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return a

    def delete(self, storage_key: str) -> None:
        p = self.resolve(storage_key)
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            p.unlink()

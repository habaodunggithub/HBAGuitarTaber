"""Model registry with a simple VRAM-aware policy (docs §8.5).

Small models stay loaded; big ones are loaded on demand and released afterwards.
Nothing here imports torch at module import time, so the CPU-only path stays light.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .audio.f0 import get_tracker


def detect_device() -> str:
    from .device import describe

    return describe()


class ModelRegistry:
    def __init__(self, vram_budget_gb: float | None = None):
        self.vram_budget_gb = vram_budget_gb
        self._cache: dict[str, Any] = {}
        self.device = detect_device()

    def get(self, key: str, factory: Callable[[], Any]) -> Any:
        if key not in self._cache:
            self._cache[key] = factory()
        return self._cache[key]

    def release(self, key: str) -> None:
        self._cache.pop(key, None)
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    @property
    def small_gpu(self) -> bool:
        """True on GPUs with < 8 GB (the RTX 4050 laptop): big models are released after use."""
        try:
            import torch

            from .device import torch_device

            return torch_device() == "cuda" and torch.cuda.get_device_properties(0).total_memory < 8e9
        except Exception:
            return False

    def get_separator(self):
        import demucs  # noqa: F401  - ImportError here means "not installed"

        from .audio.separation import DemucsSeparator

        return self.get("separator", DemucsSeparator)

    def get_hand_tracker(self):
        from .video.hands import MediaPipeHands

        return self.get("hands", MediaPipeHands)

    def get_onset_model(self):
        import onnxruntime  # noqa: F401  - ImportError here means "not installed"

        from .audio.onsets import BasicPitchOnsets

        return self.get("onsets", BasicPitchOnsets)

    def get_string_classifier(self):
        from .strings import StringClassifier

        return self.get("strings", StringClassifier)

    def get_tracker(self, name: str = "auto"):
        return self.get(f"tracker:{name}", lambda: get_tracker(name))

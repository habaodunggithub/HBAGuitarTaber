"""Which torch device the models run on: the GPU only when this torch build can really use it.

``torch.cuda.is_available()`` only says that a driver answered. A card older than the build supports
(CUDA 13 wheels start at compute capability 7.5, so no GTX 10xx) still reports True, and then every
kernel fails with "no kernel image is available". One tiny kernel at start-up tells the two apart, and
the analysis runs on the processor instead of failing at the first model.
"""

from __future__ import annotations

import logging
from functools import lru_cache

log = logging.getLogger("taber.device")


def _supported(cap: tuple[int, int], archs: list[str]) -> bool:
    """Does a build compiled for ``archs`` (torch.cuda.get_arch_list()) run on a card of capability ``cap``?

    sm_XY runs on the same major with minor >= Y; compute_XY (PTX) is compiled by the driver for any newer card.
    """
    major, minor = cap
    if not archs:
        return True  # unknown build: let the test kernel decide
    for a in archs:
        kind, _, num = a.partition("_")
        if not num.isdigit():
            continue
        m, n = int(num[:-1]), int(num[-1])
        if kind == "sm" and m == major and n <= minor:
            return True
        if kind == "compute" and (m, n) <= (major, minor):
            return True
    return False


def _probe() -> tuple[bool, str]:
    try:
        import torch
    except ImportError:
        return False, "torch is not installed"
    try:
        if not torch.cuda.is_available():
            return False, "no CUDA GPU (or the driver is too old for this build)"
        name = torch.cuda.get_device_name(0)
        cap = torch.cuda.get_device_capability(0)
        if not _supported(cap, torch.cuda.get_arch_list()):
            return False, f"{name} (compute capability {cap[0]}.{cap[1]}) is too old for this torch build"
        x = torch.ones(8, device="cuda")
        float((x * 2).sum().item())  # a real kernel: "no kernel image" shows up here
        return True, name
    except Exception as e:  # noqa: BLE001 - any CUDA failure means "use the processor"
        return False, f"the GPU did not run a test kernel ({type(e).__name__}: {e})"


@lru_cache(maxsize=1)
def cuda_status() -> tuple[bool, str]:
    """(usable, why): whether to run on the GPU, and the GPU's name or the reason it is not used."""
    ok, why = _probe()
    log.info("models run on %s", f"the GPU ({why})" if ok else f"the processor: {why}")
    return ok, why


def torch_device() -> str:
    """"cuda" or "cpu", for every model that runs on torch."""
    return "cuda" if cuda_status()[0] else "cpu"


def describe() -> str:
    """What the worker advertises: "cuda:<name>" or "cpu"."""
    ok, why = cuda_status()
    return f"cuda:{why}" if ok else "cpu"

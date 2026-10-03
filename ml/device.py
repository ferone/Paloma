"""Compute-device layer for the ML pipeline.

ML_DEVICE (env, or --device) selects where each model family runs:

  auto  (default) a per-run micro-benchmark on one walk-forward fold times both
        families on both devices and picks the faster device PER FAMILY
  cuda  run both families on the GPU (a family whose library lacks CUDA falls
        back to the CPU, with a note)
  cpu   never touch the GPU

The decision, the GPU name and the benchmark timings are recorded in every run.
Everything degrades to the CPU when torch / CUDA / a CUDA build of XGBoost is
absent (e.g. CI), so the pipeline never requires a GPU.
"""
from __future__ import annotations

import os
from functools import lru_cache

VALID = ("auto", "cuda", "cpu")
FAMILY_KEYS = ("gb", "logit")


def requested(value: str | None = None) -> str:
    """The requested mode: explicit value, else env ML_DEVICE, else auto."""
    v = (value or os.environ.get("ML_DEVICE") or "auto").strip().lower()
    return v if v in VALID else "auto"


@lru_cache(maxsize=1)
def torch_cuda() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001 - torch absent or broken: CPU only
        return False


@lru_cache(maxsize=1)
def xgb_cuda() -> bool:
    """XGBoost built with CUDA AND a usable GPU."""
    try:
        import xgboost
        return bool(xgboost.build_info().get("USE_CUDA")) and torch_cuda()
    except Exception:  # noqa: BLE001
        return False


def family_cuda(family: str) -> bool:
    return xgb_cuda() if family == "gb" else torch_cuda()


@lru_cache(maxsize=1)
def gpu_name() -> str | None:
    if not torch_cuda():
        return None
    try:
        import torch
        return str(torch.cuda.get_device_name(0))
    except Exception:  # noqa: BLE001
        return None


def cpu_workers() -> int:
    """Parallel workers for per-shift CPU fits (env ML_WORKERS overrides)."""
    try:
        w = int(os.environ.get("ML_WORKERS", "0"))
    except ValueError:
        w = 0
    return w if w > 0 else max(1, os.cpu_count() or 1)


def torch_device(device: str):
    """torch.device for 'cuda'/'cpu' (cuda only when available)."""
    import torch
    return torch.device("cuda" if device == "cuda" and torch_cuda() else "cpu")


def resolve(mode: str, benchmark=None) -> dict:
    """Pick a device per family.

    `benchmark` is a zero-arg callable returning {family: {"cpu": sec, "cuda": sec}}
    (seconds per unit of the work the permutation test repeats); it is only
    called in auto mode when at least one family can use CUDA.
    """
    mode = requested(mode)
    devices = {f: "cpu" for f in FAMILY_KEYS}
    notes: list[str] = []
    bench = None
    if mode == "cuda":
        for f in FAMILY_KEYS:
            if family_cuda(f):
                devices[f] = "cuda"
            else:
                notes.append(f"{f}: CUDA unavailable, using the CPU")
    elif mode == "auto":
        if not any(family_cuda(f) for f in FAMILY_KEYS):
            notes.append("CUDA unavailable: CPU only")
        elif benchmark is not None:
            bench = benchmark()
            for f in FAMILY_KEYS:
                t = bench.get(f) or {}
                if family_cuda(f) and t.get("cuda") is not None and t.get("cpu") is not None and t["cuda"] < t["cpu"]:
                    devices[f] = "cuda"
            notes.append("auto: faster device per family on a one-fold micro-benchmark")
    return {
        "requested": mode,
        "devices": devices,
        "gpu": gpu_name() if any(d == "cuda" for d in devices.values()) or mode != "cpu" else None,
        "cudaAvailable": torch_cuda(),
        "workers": cpu_workers(),
        "benchmark": bench,
        "notes": notes,
    }

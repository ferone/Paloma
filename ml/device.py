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

import json
import time
from pathlib import Path

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


BENCH_CACHE_DAYS = 14


def _bench_key(extra: dict) -> str:
    """What makes a benchmark result reusable: same GPU, library versions, CPU
    workers and problem size (rows rounded to 500, features, permutations)."""
    try:
        import torch
        tv = torch.__version__
    except Exception:  # noqa: BLE001
        tv = None
    try:
        import xgboost
        xv = xgboost.__version__
    except Exception:  # noqa: BLE001
        xv = None
    parts = {"gpu": gpu_name(), "torch": tv, "xgboost": xv, "workers": cpu_workers(), **extra}
    return json.dumps(parts, sort_keys=True)


def cached_benchmark(benchmark, cache_file: Path | None, extra: dict):
    """Run `benchmark` unless a fresh result for the same hardware/problem size is
    cached in `cache_file` (saves the 10-50 s benchmark on most runs)."""
    if cache_file is None:
        return benchmark(), False
    key = _bench_key(extra)
    try:
        store = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
    except Exception:  # noqa: BLE001 - a corrupt cache is just a miss
        store = {}
    hit = store.get(key)
    if hit and time.time() - hit.get("at", 0) < BENCH_CACHE_DAYS * 86400:
        return hit["bench"], True
    bench = benchmark()
    store[key] = {"bench": bench, "at": time.time()}
    try:
        cache_file.write_text(json.dumps(store, indent=1), encoding="utf-8")
    except Exception:  # noqa: BLE001 - caching is best-effort
        pass
    return bench, False


def resolve(mode: str, benchmark=None, cache_file: Path | None = None, cache_extra: dict | None = None) -> dict:
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
            bench, reused = cached_benchmark(benchmark, cache_file, cache_extra or {})
            if reused:
                notes.append(f"auto: reused a benchmark from the last {BENCH_CACHE_DAYS} days (same GPU, libraries and problem size)")
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

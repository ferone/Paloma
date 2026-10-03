"""Calibration check for the permutation test's null (diagnostic, not run by the server).

Builds NO-SIGNAL targets with the real label series' autocorrelation - the real
y_up circularly shifted by a random offset of at least a year, so it no longer
lines up with the features - and runs the full-procedure permutation test on
each. A calibrated test rejects at about the nominal rate (5% at p < 0.05).

  python ml/calibrate_null.py --asset gold --reps 30 --n-perm 40 [--null circular|block|both] [--device auto|cuda|cpu]

Prints one line per replicate and a summary per null. Uses the same engine,
features (core + optional, NaN allowed) and device selection as training.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import device as dv  # noqa: E402
import pipeline as pl  # noqa: E402
from features import DEFAULT_DATA_DIR, H, core_features, load_matrix, select_features, trainable  # noqa: E402


def block_null_test(data, feats, n_perm, seed, devices):
    """The superseded null (20-row block permutation), same statistic, for comparison."""
    plan = pl.fold_plan(data)
    y = data["y_up"].to_numpy(dtype=float)
    real, _ = pl.wf_statistic(data, feats, plan, y, devices=devices)
    rng = np.random.default_rng(seed)
    Y = np.column_stack([pl.block_permute(y, H, rng) for _ in range(n_perm)])
    stats, _ = pl.wf_statistics(data, feats, plan, Y, devices=devices)
    return real, pl.permutation_p(real, np.array([a if a is not None else 0.5 for a in stats]))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asset", default="gold")
    ap.add_argument("--reps", type=int, default=30)
    ap.add_argument("--n-perm", type=int, default=40)
    ap.add_argument("--null", choices=["circular", "block", "both"], default="both")
    ap.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--device", choices=list(dv.VALID), default=None, help="default: env ML_DEVICE, else auto")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # cp1252 consoles on Windows

    df, meta = load_matrix(a.asset, Path(a.data_dir))
    feats, _ = select_features(df, meta)
    base = trainable(df, feats, core_features(df, meta))
    compute = dv.resolve(dv.requested(a.device), lambda: pl.benchmark_devices(base, feats, a.n_perm))
    devices = compute["devices"]
    print(f"{a.asset}: {len(base)} rows {base['date'].min():%Y-%m-%d} to {base['date'].max():%Y-%m-%d}, {len(feats)} features; "
          f"devices {devices} ({compute['requested']})", flush=True)
    y_real = base["y_up"].to_numpy()
    rng = np.random.default_rng(a.seed)
    offsets = pl.circular_shifts(len(y_real), a.reps, rng)
    nulls = ["circular", "block"] if a.null == "both" else [a.null]
    ps: dict[str, list[float]] = {k: [] for k in nulls}
    for i, off in enumerate(offsets):
        data = base.assign(y_up=np.roll(y_real, int(off)))  # no signal, same autocorrelation
        t0 = time.time()
        line = [f"rep {i + 1:2d} offset {int(off):5d}"]
        for k in nulls:
            if k == "circular":
                r = pl.permutation_test(data, feats, n_perm=a.n_perm, devices=devices)
                real, p = r["realAuc"], r["pValue"]
            else:
                real, p = block_null_test(data, feats, a.n_perm, a.seed + i, devices)
            ps[k].append(p)
            line.append(f"{k}: auc {real:.4f} p {p:.4f}")
        print(" | ".join(line) + f" ({time.time() - t0:.0f}s)", flush=True)
    for k, v in ps.items():
        arr = np.array(v)
        print(f"SUMMARY {k}: reps {len(arr)}, p<0.05 {np.mean(arr < 0.05):.1%} ({int(np.sum(arr < 0.05))}/{len(arr)}), "
              f"p<0.10 {np.mean(arr < 0.10):.1%}, median p {np.median(arr):.3f}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

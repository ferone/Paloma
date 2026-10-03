"""Feature matrix loading + feature selection for the per-asset ML pipeline.

The matrix is built in TypeScript (server/ml/features.ts) so the look-ahead rules
live in one tested place; this module only reads it. Every feature at row t uses
only data available at t. Targets (y_ret, y_up) look H rows ahead and are blank
for the most recent H rows (those rows are scored, never trained on).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "data" / "ml"
H = 20

# CORE features (non-optional: price, cross-asset, calendar) must all exist on a
# row for it to be trained on, so they set the training span. OPTIONAL features
# (feeds that start later: FRED macro, ETF flows, COT, open interest, the
# contract curve) may be missing (NaN) on early rows: the tree family handles
# NaN natively and the logistic family imputes the training-window median plus
# a missing-indicator column. An optional feature is used when it is present on
# at least MIN_OPTIONAL_ROWS of the trainable rows (~3 years: enough history for
# it to inform the later walk-forward folds) AND on the latest row.
MIN_OPTIONAL_ROWS = 756


def load_matrix(metal: str, data_dir: Path = DEFAULT_DATA_DIR) -> tuple[pd.DataFrame, dict]:
    csv = data_dir / f"features_{metal}.csv"
    meta_path = data_dir / f"features_{metal}.meta.json"
    if not csv.exists():
        raise FileNotFoundError(f"{csv} not found - run the feature export first")
    df = pd.read_csv(csv)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    df["year"] = df["date"].dt.year
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    return df, meta


def feature_specs(df: pd.DataFrame, meta: dict) -> list[dict]:
    """[{id, optional}] from the export meta (falls back to every non-target column)."""
    specs = meta.get("features")
    if specs:
        return [s for s in specs if s["id"] in df.columns]
    skip = {"date", "year", "y_ret", "y_up"}
    return [{"id": c, "optional": False} for c in df.columns if c not in skip]


def core_features(df: pd.DataFrame, meta: dict) -> list[str]:
    """Non-optional features that have any data (a column with no data at all
    can never be core: it would empty the training set)."""
    return [s["id"] for s in feature_specs(df, meta) if not s["optional"] and df[s["id"]].notna().any()]


def select_features(df: pd.DataFrame, meta: dict, min_rows: int = MIN_OPTIONAL_ROWS) -> tuple[list[str], list[dict]]:
    """Decide which features to train on; returns (used, availability report).

    The trainable base is every labeled row where all CORE features exist (the
    whole history the price/cross-asset set covers). Every core feature with data
    is used. An optional feature is used when it is present on at least
    `min_rows` base rows and on the latest row (the model could not score today
    without it); elsewhere it may be missing. `coverage` is the share of base
    rows where the feature is present.
    """
    specs = feature_specs(df, meta)
    missing_reasons: dict = meta.get("missing", {})
    core = core_features(df, meta)
    labeled = df[df["y_ret"].notna()]
    base = labeled.dropna(subset=core) if core else labeled
    latest = df.iloc[-1]
    used: list[str] = []
    report: list[dict] = []
    for s in specs:
        fid = s["id"]
        col = df[fid]
        present = col.notna()
        first = df.loc[present, "date"].min() if present.any() else None
        n_present = int(base[fid].notna().sum()) if len(base) else 0
        coverage = n_present / len(base) if len(base) else 0.0
        reason = None
        if not present.any():
            reason = missing_reasons.get(fid, "No data for this input")
        elif s["optional"] and n_present < min_rows:
            reason = f"only {n_present} trainable rows < {min_rows}"
        elif pd.isna(latest[fid]):
            reason = "missing on the latest date"
        if reason is None:
            used.append(fid)
        report.append({
            "id": fid,
            "used": reason is None,
            "core": fid in core,
            **({"reason": reason} if reason else {}),
            "coverage": round(coverage, 4),
            "firstDate": first.strftime("%Y-%m-%d") if first is not None else None,
        })
    return used, report


def trainable(df: pd.DataFrame, used: list[str], required: list[str] | None = None) -> pd.DataFrame:
    """Labeled rows where every `required` feature (default: every used one;
    the pipeline passes the core features) is present, sorted by date. Other
    used features may be NaN."""
    req = used if required is None else [f for f in required if f in used]
    out = df.dropna(subset=req + ["y_ret"]).copy()
    out["y_up"] = (out["y_ret"] > 0).astype(int)
    return out.sort_values("date").reset_index(drop=True)


def latest_row(df: pd.DataFrame, used: list[str]) -> pd.DataFrame | None:
    """The most recent row with every used feature present (the row we score)."""
    ok = df.dropna(subset=used)
    if ok.empty:
        return None
    return ok.iloc[[-1]]


def synthetic_matrix(n_years: int = 12, signal: float = 0.0, seed: int = 0, start: str = "2008-01-01") -> pd.DataFrame:
    """Synthetic daily matrix for tests: random-walk price with optional planted
    signal in feature `f0` (predicts the forward return)."""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=252 * n_years)
    n = len(dates)
    f = rng.normal(size=(n, 4))
    # Smooth f0 so the signal persists over the horizon.
    f0 = pd.Series(f[:, 0]).rolling(40, min_periods=1).mean().to_numpy()
    ret = rng.normal(scale=0.01, size=n)
    ret[1:] += signal * f0[:-1] * 0.01
    lp = np.cumsum(ret)
    y = np.full(n, np.nan)
    y[: n - H] = lp[H:] - lp[: n - H]
    df = pd.DataFrame({"date": dates, "f0": f0, "f1": f[:, 1], "f2": f[:, 2], "f3": f[:, 3], "y_ret": y})
    df["y_up"] = np.where(df["y_ret"].isna(), np.nan, (df["y_ret"] > 0).astype(float))
    df["year"] = df["date"].dt.year
    return df

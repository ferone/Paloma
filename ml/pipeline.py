"""Per-asset 20-day direction model with honest walk-forward validation.

Ported and adapted from CommodityFutures/scripts/ml (Tier 2 pipeline): there it
pooled many spread instruments; here each asset has one long outright series,
so the model is per asset and the validation is an expanding-window
walk-forward by calendar year over the WHOLE history the core features cover.

  * y_up  -> one of two families, chosen per asset by NESTED selection
             (models.py): XGBoost histogram trees ("gb", uncalibrated), or
             standardized, L2-regularized logistic regression ("logit", C=0.1,
             median imputation + missing indicators, torch Newton solver)
  * y_ret -> XGBoost regressor (expected 20d log move)
  * baseline -> the next simpler model: logistic when gradient boosting is
             chosen, the naive base-rate forecast when logistic is chosen

Optional features (late-starting feeds) may be NaN on early rows; see
features.py. Both families handle that without looking at the test rows.

MODEL-FAMILY SELECTION (nested, see select_family)
  Inside every training window the family is chosen by an inner walk-forward
  over that window's last 3 years; the outer test year never influences the
  choice, so the walk-forward scores the selection procedure itself.

VALIDATION
  Expanding window, one test year at a time, with at least MIN_TRAIN_YEARS of
  history before the first test year. The last H training rows before each test
  year are PURGED: their forward labels overlap the test year, so keeping them
  would leak test-period returns into training.

ENGINE (cutoff_predictions + run_procedure)
  Every training window in the procedure - outer folds AND inner selection
  folds - is "all rows before calendar year c, minus the last H" for some
  cutoff year c, so each (family, cutoff) is fitted once and its predictions
  for year c serve every fold that needs them (an inner test year that is the
  year just before an outer test year is the same predictions truncated by the
  purge). The fits for one cutoff take a MATRIX of label vectors (n x S): the
  real labels (S = 1) or all permutation shifts at once. The logistic family
  solves all S label columns in one batched Newton solve (GPU-friendly); the
  tree family fits one booster per column on a shared quantile sketch, in
  parallel CPU threads or sequentially on the GPU. Per-column family choice,
  inner AUCs and outer AUCs are then computed with a tie-aware batched AUC.
  This reproduces the per-fold loop exactly (deterministic fits), with each
  distinct training window fitted once instead of once per outer fold.

PERMUTATION TEST (whole walk-forward)
  The statistic is the reported walk-forward AUC itself: the mean over all test
  years of the per-year out-of-sample AUC of the full procedure (family
  selection + fit), on the same fold splits. Each null run circularly shifts
  the whole label series against the features by >= 1 year (keeps the 20-day
  overlap AND slow regimes; block-permuting 20-row blocks proved too narrow a
  null) and repeats the whole procedure, selection included - all null runs
  share one batched engine call. One-sided: p = (1 + #{null >= real}) / (1 + N);
  an AUC below 0.5 gets p > 0.5.

DEVICES (device.py)
  ML_DEVICE / --device = auto | cuda | cpu. auto micro-benchmarks one fold
  per family on both devices and picks the faster per family; the decision,
  GPU name and timings are recorded in the run. Real and null fits of a run
  always use the same device.

MULTIPLE TESTING (Bonferroni)
  The server trains one model per market in the universe and tests each, so
  the per-model threshold is alpha / m (m = --n-tests, the number of markets;
  0.05 / 6 = 0.0083). Without it, with six markets and no real skill anywhere,
  the chance that at least one passes by luck is 1 - 0.95^6 = 26%. The number
  of permutations defaults to enough that the smallest attainable p,
  1 / (N + 1), sits well below the adjusted threshold (N >= 4 / alpha_adj).

GATE
  passed iff p < 0.05 / m AND mean fold AUC >= 0.55 AND mean hit >= 0.52 AND
  the model's mean AUC beats the baseline AND the last 2 test years' mean AUC
  >= 0.50; untested with < 3 test years.

USAGE
  python ml/pipeline.py train --asset gold [--data-dir data/ml] [--n-tests 6] [--n-perm N] [--device auto|cuda|cpu]
  python ml/pipeline.py infer --metal gold [--data-dir data/ml] [--device ...]
  python ml/pipeline.py version

Emits `PROGRESS <0..1> <message>` lines on stdout and a final `RESULT <path>`
line naming the JSON the server ingests.

SECURITY: the joblib model files are produced only by this script into the
local, gitignored data/ml directory and are never loaded from elsewhere.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.inspection import permutation_importance
from sklearn.metrics import brier_score_loss, mean_squared_error, roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
import device as dv  # noqa: E402
import models as md  # noqa: E402
from features import DEFAULT_DATA_DIR, H, core_features, latest_row, load_matrix, select_features, trainable  # noqa: E402

SEED = md.SEED
MIN_TRAIN_YEARS = 5
MIN_TEST_ROWS = 60
MIN_TEST_YEARS = 3
N_PERM_MIN = 100
GATE = {"p": 0.05, "auc": 0.55, "hit": 0.52}
# Recency: the model must still beat chance on its most recent test years, so an
# edge that has faded (strong history, coin-flip lately) does not count.
RECENT_YEARS = 2
RECENT_MIN_AUC = 0.50
CAL_BINS = 10
# The per-day out-of-sample series stored with a run is downsampled beyond this.
OOS_MAX_POINTS = 8000

CPU = {"gb": "cpu", "logit": "cpu"}


def devs(devices: dict | None) -> dict:
    return {**CPU, **(devices or {})}


def adjusted_alpha(n_tests: int) -> float:
    """Bonferroni: the per-model threshold when `n_tests` markets are tested."""
    return GATE["p"] / max(1, int(n_tests))


def default_n_perm(n_tests: int) -> int:
    """Enough permutations that the smallest attainable p, 1 / (N + 1), is at
    most a quarter of the adjusted threshold (and never fewer than N_PERM_MIN)."""
    return max(N_PERM_MIN, math.ceil(4 / adjusted_alpha(n_tests)))


def progress(frac: float, msg: str) -> None:
    print(f"PROGRESS {frac:.3f} {msg}", flush=True)


# ── models ───────────────────────────────────────────────────────────────────
#
# The gradient-boosted trees are NOT Platt-calibrated: a sigmoid fitted on
# cross-validated scores can get a NEGATIVE slope when the in-sample signal is
# weak, which silently inverts the ranking (it turned a fold AUC of 0.447 into
# 0.553). The reported AUC, the gate and the permutation test must all describe
# the same scores, so the model's own log-loss probabilities are used; their
# reliability is shown out of sample in the calibration bins.

# Model families the pipeline chooses between, per asset and per training window.
FAMILIES = ("gb", "logit")
FAMILY_LABEL = {
    "gb": "gradient boosting (XGBoost)",
    "logit": "logistic regression (L2, C=0.1)",
}


def make_family(family: str, fast: bool = False, device: str = "cpu", nthread: int = 0):
    """The SAME estimator code path is used for inner selection, the
    walk-forward, the permutation test and the saved model."""
    return md.TorchLogit(device=device) if family == "logit" else md.XgbModel(device=device, fast=fast, nthread=nthread)


def make_reg(fast: bool = False, device: str = "cpu"):
    return md.XgbModel(device=device, fast=fast, regression=True)


def make_baseline(device: str = "cpu"):
    return md.TorchLogit(device=device)


# ── walk-forward splits ──────────────────────────────────────────────────────

def test_years(data: pd.DataFrame, min_train_years: int = MIN_TRAIN_YEARS) -> list[int]:
    """Calendar years eligible as out-of-sample test years."""
    years = sorted(int(y) for y in data["year"].unique())
    if not years:
        return []
    first = years[0]
    return [y for y in years if y - first >= min_train_years and (data["year"] == y).sum() >= MIN_TEST_ROWS]


def purged_split(data: pd.DataFrame, ty: int, h: int = H) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """Train = rows before year `ty` minus the last h rows (their labels reach into
    the test year); test = rows in `ty`. `data` must be sorted by date."""
    before = data[data["year"] < ty]
    purged = min(h, len(before))
    train = before.iloc[: len(before) - purged]
    test = data[data["year"] == ty]
    return train, test, purged


def cutoff_split(years: np.ndarray, c: int, h: int = H) -> tuple[int, np.ndarray]:
    """Positional form of purged_split on date-sorted rows: the training window
    is rows [0, end) and the predicted rows are those of year c."""
    first = int(np.searchsorted(years, c, side="left"))
    last = int(np.searchsorted(years, c, side="right"))
    return max(0, first - min(h, first)), np.arange(first, last)


def safe_auc(y: np.ndarray, p: np.ndarray) -> float | None:
    return float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None


def spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < 3:
        return None
    ra = pd.Series(a).rank().to_numpy()
    rb = pd.Series(b).rank().to_numpy()
    if ra.std() == 0 or rb.std() == 0:
        return None
    return float(np.corrcoef(ra, rb)[0, 1])


def r4(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 4)


def nan_none(x: float) -> float | None:
    return None if x is None or not np.isfinite(x) else float(x)


# ── model-family selection (nested, training data only) ─────────────────────
#
# Which family generalizes better differs by asset (copper: the logistic model
# beat gradient boosting out of sample). Choosing the family by looking at the
# walk-forward test years would make those years part of the fit, so the choice
# is made INSIDE each training window by an inner walk-forward over its last
# INNER_YEARS calendar years (same purge), and the outer test year only ever
# scores the family chosen without it. The selection is therefore part of the
# procedure being validated - and the permutation test re-runs it on every
# shifted label set (see permutation_test).

INNER_YEARS = 3
MIN_INNER_TRAIN = 250


def inner_years(train: pd.DataFrame) -> list[int]:
    """The last INNER_YEARS full-enough calendar years of a training window."""
    years = [y for y in sorted(int(v) for v in train["year"].unique()) if (train["year"] == y).sum() >= MIN_TEST_ROWS]
    return years[1:][-INNER_YEARS:]  # never the first year: it has no history to train on


def fold_plan(data: pd.DataFrame) -> list[tuple[int, pd.DataFrame, pd.DataFrame, int]]:
    """The outer walk-forward folds (test year, purged train, test, rows purged).
    Computed once from the real data and reused unchanged by the permutation
    test, so real and shifted runs are scored on identical splits."""
    plan = []
    for ty in test_years(data):
        train, test, purged = purged_split(data, ty)
        if train["y_up"].nunique() < 2 or len(train) < 250:
            continue
        plan.append((ty, train, test, purged))
    return plan


def _inner_cutoffs(train: pd.DataFrame, years: np.ndarray) -> list[int]:
    """Inner selection years of a training window whose own training part is long enough."""
    return [iy for iy in inner_years(train) if cutoff_split(years, iy)[0] >= MIN_INNER_TRAIN]


# ── engine ───────────────────────────────────────────────────────────────────

def _feature_matrix(data: pd.DataFrame, feats: list[str]) -> np.ndarray:
    return data[feats].to_numpy(dtype=np.float64)


def cutoff_predictions(X: np.ndarray, years: np.ndarray, cutoffs, Y: np.ndarray, devices: dict | None = None,
                       fast: bool = False, workers: int | None = None, timings: dict | None = None,
                       on_progress=None) -> dict:
    """{(family, c): predictions for the rows of year c (m_c x S)} for every
    cutoff year c, each family fitted on rows before c (purged) with every label
    column of Y (n x S). A label column with one class in a window gets NaN."""
    d = devs(devices)
    Y = np.asarray(Y, dtype=np.float64)
    if Y.ndim == 1:
        Y = Y[:, None]
    S = Y.shape[1]
    workers = dv.cpu_workers() if workers is None else workers
    splits = {c: cutoff_split(years, c) for c in sorted(set(int(c) for c in cutoffs))}
    out: dict = {}

    def one_class(end: int) -> np.ndarray:
        ytr = Y[:end]
        return (ytr.min(axis=0) == ytr.max(axis=0)) if end else np.ones(S, dtype=bool)

    t0 = time.time()
    for c, (end, pred) in splits.items():
        if end == 0 or not len(pred):
            out[("logit", c)] = np.full((len(pred), S), np.nan)
            continue
        p = md.logit_fit_predict(X[:end], Y[:end], X[pred], d["logit"])
        p[:, one_class(end)] = np.nan
        out[("logit", c)] = p
    t1 = time.time()

    # gb: one task per (cutoff, chunk of label columns), biggest windows first
    n_cut = max(1, len(splits))
    w = 1 if d["gb"] == "cuda" else max(1, workers)
    per_cut = max(1, math.ceil(4 * w / n_cut))
    chunk = max(1, math.ceil(S / per_cut))
    tasks, keys = [], []
    for c, (end, pred) in sorted(splits.items(), key=lambda kv: -kv[1][0]):
        if end == 0 or not len(pred):
            out[("gb", c)] = np.full((len(pred), S), np.nan)
            continue
        out[("gb", c)] = np.full((len(pred), S), np.nan)
        for s0 in range(0, S, chunk):
            cols = list(range(s0, min(S, s0 + chunk)))
            tasks.append((X[:end], Y[:end], cols, X[pred]))
            keys.append((c, cols))
    for (c, cols), res in zip(keys, md.gb_run_tasks(tasks, d["gb"], fast, w, on_progress)):
        out[("gb", c)][:, cols] = res
    t2 = time.time()
    if timings is not None:
        timings["logit"] = timings.get("logit", 0.0) + (t1 - t0)
        timings["gb"] = timings.get("gb", 0.0) + (t2 - t1)
    return out


def plan_cutoffs(plan, years: np.ndarray) -> list[int]:
    cs = set()
    for ty, train, _, _ in plan:
        cs.add(int(ty))
        cs.update(_inner_cutoffs(train, years))
    return sorted(cs)


def run_procedure(data: pd.DataFrame, plan, P: dict, Y: np.ndarray) -> dict:
    """The full per-fold procedure for every label column at once: inner
    family selection (mean inner-walk-forward AUC; ties and windows without
    inner folds go to logistic), then the chosen family's out-of-sample
    predictions and AUC for the outer test year."""
    Y = np.asarray(Y, dtype=np.float64)
    if Y.ndim == 1:
        Y = Y[:, None]
    S = Y.shape[1]
    years = data["year"].to_numpy()
    fold_auc, fold_gb, fold_inner, fold_p = [], [], [], []
    for ty, train, _, _ in plan:
        cut = len(train)  # the purged training window is rows [0, cut)
        scores = {f: [] for f in FAMILIES}
        for iy in _inner_cutoffs(train, years):
            _, pred = cutoff_split(years, iy)
            m = int(np.sum(pred < cut))  # inner test = year iy inside the window (purge-truncated)
            yte = Y[pred[:m]]
            for fam in FAMILIES:
                scores[fam].append(md.batched_auc(yte, P[(fam, iy)][:m]))
        mean = {}
        for fam in FAMILIES:
            if scores[fam]:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    mean[fam] = np.nanmean(np.vstack(scores[fam]), axis=0)
            else:
                mean[fam] = np.full(S, np.nan)
        is_gb = np.isfinite(mean["gb"]) & np.isfinite(mean["logit"]) & (mean["gb"] > mean["logit"])
        _, pred = cutoff_split(years, ty)
        p = np.where(is_gb[None, :], P[("gb", ty)], P[("logit", ty)])
        fold_auc.append(md.batched_auc(Y[pred], p))
        fold_gb.append(is_gb)
        fold_inner.append(mean)
        fold_p.append(p)
    aucs = np.vstack(fold_auc) if fold_auc else np.empty((0, S))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        stat = np.nanmean(aucs, axis=0) if len(aucs) else np.full(S, np.nan)
    return {"aucs": aucs, "isGb": np.vstack(fold_gb) if fold_gb else np.empty((0, S), dtype=bool),
            "inner": fold_inner, "p": fold_p, "stat": stat}


def wf_statistics(data: pd.DataFrame, feats: list[str], plan, Y: np.ndarray, fast: bool = False,
                  devices: dict | None = None, workers: int | None = None, timings: dict | None = None,
                  on_progress=None) -> tuple[list[float | None], list[list[str]]]:
    """Mean walk-forward AUC of the full procedure for every label column of Y
    (n x S, aligned with `data`), over the fixed `plan`; plus the family chosen
    per fold for each column."""
    years = data["year"].to_numpy()
    P = cutoff_predictions(_feature_matrix(data, feats), years, plan_cutoffs(plan, years), Y, devices, fast, workers,
                           timings, on_progress)
    proc = run_procedure(data, plan, P, Y)
    fams = [["gb" if g else "logit" for g in proc["isGb"][:, s]] for s in range(proc["isGb"].shape[1])]
    return [nan_none(x) for x in proc["stat"]], fams


def wf_statistic(data: pd.DataFrame, feats: list[str], plan, y: np.ndarray, fast: bool = False,
                 devices: dict | None = None) -> tuple[float | None, list[str]]:
    """Single label vector: (statistic, family chosen per fold)."""
    stats, fams = wf_statistics(data, feats, plan, np.asarray(y)[:, None], fast, devices)
    return stats[0], fams[0]


def select_family(train: pd.DataFrame, feats: list[str], fast: bool = False,
                  y: np.ndarray | None = None, devices: dict | None = None) -> tuple[str, dict]:
    """Pick the family with the best mean inner-walk-forward AUC on `train`
    (labels `y`, default train["y_up"]). Ties - and windows too short for any
    inner fold - go to the simpler logistic model. Returns (family, scores)."""
    t = train if y is None else train.assign(y_up=y)
    years = t["year"].to_numpy()
    Y = t["y_up"].to_numpy(dtype=np.float64)[:, None]
    cut = _inner_cutoffs(t, years)
    P = cutoff_predictions(_feature_matrix(t, feats), years, cut, Y, devices, fast)
    mean = {}
    for fam in FAMILIES:
        xs = [md.batched_auc(Y[cutoff_split(years, iy)[1]], P[(fam, iy)])[0] for iy in cut]
        xs = [x for x in xs if np.isfinite(x)]
        mean[fam] = float(np.mean(xs)) if xs else None
    scores = {f: r4(v) for f, v in mean.items()}
    if mean["gb"] is None or mean["logit"] is None:
        return "logit", scores
    return ("gb" if mean["gb"] > mean["logit"] else "logit"), scores


def mean_fold_auc(aucs: list[float | None]) -> float | None:
    xs = [a for a in aucs if a is not None]
    return float(np.mean(xs)) if xs else None


def oos_mean_auc(oos: pd.DataFrame) -> float | None:
    """Mean over test years of the per-year AUC (unrounded): the walk-forward
    AUC the gate checks and the permutation test's statistic."""
    return mean_fold_auc([safe_auc(g["y"].to_numpy().astype(int), g["p"].to_numpy()) for _, g in oos.groupby("testYear", sort=True)])


def walk_forward(data: pd.DataFrame, feats: list[str], fast: bool = False, on_fold=None, devices: dict | None = None,
                 timings: dict | None = None):
    """Returns (folds, oos frame, last-fold artefacts for importance).

    Per fold: choose the family on the training window only, fit it, score the
    test year (the engine, S = 1). The comparator ("baseline") is the next
    simpler model: the logistic regression when the chosen family is gradient
    boosting, and the naive base-rate forecast (the training window's up-share,
    a constant: AUC 0.5, hit = always calling the majority side) when the
    chosen family is itself the logistic regression."""
    d = devs(devices)
    plan = fold_plan(data)
    years = data["year"].to_numpy()
    y = data["y_up"].to_numpy(dtype=np.float64)
    X = _feature_matrix(data, feats)
    P = cutoff_predictions(X, years, plan_cutoffs(plan, years), y[:, None], d, fast, timings=timings)
    proc = run_procedure(data, plan, P, y[:, None])
    folds, oos_parts = [], []
    last = None
    for k, (ty, train, test, purged) in enumerate(plan):
        Xtr, ytr, Xte, yte = train[feats], train["y_up"].to_numpy(), test[feats], test["y_up"].to_numpy()
        family = "gb" if proc["isGb"][k, 0] else "logit"
        inner = {f: r4(nan_none(proc["inner"][k][f][0])) for f in FAMILIES}
        p = proc["p"][k][:, 0]
        if family == "gb":
            pb = P[("logit", ty)][:, 0]
            baseline_kind = "logistic"
        else:
            pb = np.full(len(yte), float(ytr.mean()))
            baseline_kind = "naive"
        rp = make_reg(fast, d["gb"]).fit(Xtr, train["y_ret"]).predict(Xte)
        yret = test["y_ret"].to_numpy()
        folds.append({
            "testYear": int(ty),
            "nTrain": int(len(train)),
            "nTest": int(len(test)),
            "purged": int(purged),
            "family": family,
            "innerAuc": inner,
            "baselineKind": baseline_kind,
            "auc": r4(safe_auc(yte, p)),
            "hit": r4(((p > 0.5).astype(int) == yte).mean()),
            "brier": r4(brier_score_loss(yte, p)),
            "baseRate": r4(yte.mean()),
            "baselineAuc": r4(safe_auc(yte, pb)),
            "baselineHit": r4(((pb > 0.5).astype(int) == yte).mean()),
            "rmse": r4(math.sqrt(mean_squared_error(yret, rp))),
            "ic": r4(spearman(rp, yret)),
        })
        oos_parts.append(pd.DataFrame({"date": test["date"].to_numpy(), "testYear": int(ty), "p": p, "pb": pb, "y": yte, "ret": yret, "retPred": rp}))
        if k == len(plan) - 1:
            # the same fit the engine made for this fold (deterministic, single-threaded)
            clf = make_family(family, fast, d[family], nthread=1).fit(Xtr, ytr)
            last = {"clf": clf, "Xte": Xte, "yte": yte, "year": int(ty)}
        if on_fold:
            on_fold(k + 1, len(plan), ty)
    oos = pd.concat(oos_parts, ignore_index=True) if oos_parts else pd.DataFrame(columns=["date", "testYear", "p", "pb", "y", "ret", "retPred"])
    return folds, oos, last


def summarize(folds: list[dict], oos: pd.DataFrame) -> dict:
    def avg(key):
        xs = [f[key] for f in folds if f[key] is not None]
        return r4(np.mean(xs)) if xs else None

    pooled = safe_auc(oos["y"].to_numpy().astype(int), oos["p"].to_numpy()) if len(oos) else None
    kinds = sorted({f.get("baselineKind", "logistic") for f in folds})
    return {
        "folds": len(folds),
        "familyCounts": {fam: sum(1 for f in folds if f.get("family") == fam) for fam in FAMILIES},
        "baselineKind": kinds[0] if len(kinds) == 1 else ("mixed" if kinds else None),
        # the permutation statistic: mean of the unrounded per-year AUCs
        "auc": r4(oos_mean_auc(oos)) if len(oos) else avg("auc"),
        "hit": avg("hit"),
        "brier": avg("brier"),
        "baseRate": avg("baseRate"),
        "baselineAuc": avg("baselineAuc"),
        "baselineHit": avg("baselineHit"),
        "rmse": avg("rmse"),
        "ic": avg("ic"),
        "pooledAuc": r4(pooled),
        **recent_auc(folds),
    }


def recent_auc(folds: list[dict]) -> dict:
    """Mean AUC of the last RECENT_YEARS test years (a partial current year counts:
    it is what the model faces now)."""
    scored = sorted((f for f in folds if f.get("auc") is not None), key=lambda f: f["testYear"])[-RECENT_YEARS:]
    if not scored:
        return {}
    return {"recentAuc": r4(float(np.mean([f["auc"] for f in scored]))), "recentYears": [f["testYear"] for f in scored]}


# ── permutation test ─────────────────────────────────────────────────────────

def block_permute(y: np.ndarray, block: int, rng: np.random.Generator) -> np.ndarray:
    """Shuffle labels in contiguous blocks of `block` rows (keeps the overlap
    autocorrelation of H-day labels inside each block)."""
    n = len(y)
    starts = np.arange(0, n, block)
    order = rng.permutation(len(starts))
    return np.concatenate([y[starts[i]: starts[i] + block] for i in order])


MIN_SHIFT = 252  # rows: a null shift is at least a year (far beyond the 20-day horizon)


def circular_shifts(n: int, n_perm: int, rng: np.random.Generator, min_shift: int = MIN_SHIFT) -> np.ndarray:
    """Distinct circular offsets in [min_shift, n - min_shift] (both directions
    at least a year away from the true alignment). Fewer candidates than
    n_perm -> every candidate once."""
    lo, hi = min_shift, n - min_shift
    if hi < lo:
        return np.array([], dtype=int)
    cand = np.arange(lo, hi + 1)
    return np.sort(rng.choice(cand, size=min(n_perm, len(cand)), replace=False))


def permutation_p(real: float, null: np.ndarray) -> float:
    """One-sided (larger AUC = more skill): p = (1 + #{null >= real}) / (1 + N).
    An observed AUC below the null's centre (0.5) therefore gets p > 0.5."""
    return float((np.sum(null >= real) + 1) / (len(null) + 1))


def permutation_test(data: pd.DataFrame, feats: list[str], n_perm: int = N_PERM_MIN, fast: bool = False,
                     devices: dict | None = None, timings: dict | None = None, on_progress=None) -> dict | None:
    """The statistic is EXACTLY the walk-forward AUC the report and gate use:
    the mean over all outer test years of the per-year AUC of the full
    procedure (inner family selection included), on the same fold splits.

    NULL: the whole label series is CIRCULARLY SHIFTED against the features by
    a random offset of at least a year (MIN_SHIFT) in either direction. That
    keeps the label series' entire autocorrelation - the 20-day overlap AND the
    slow multi-month regimes and yearly up-shares - and only breaks its
    alignment with the features. (An earlier version permuted 20-row blocks:
    that keeps the overlap but scrambles regimes longer than a block, which
    made the null too narrow and the p-values anti-conservative; see
    calibrate_null.py.) Each null run repeats the whole procedure, selection
    included, so p is valid under selection. All shifts go through ONE batched
    engine call (label matrix n x N)."""
    plan = fold_plan(data)
    if not plan:
        return None
    y = data["y_up"].to_numpy(dtype=np.float64)
    real, real_fams = wf_statistic(data, feats, plan, y, fast, devices)
    if real is None:
        return None
    rng = np.random.default_rng(SEED)
    shifts = circular_shifts(len(y), n_perm, rng)
    if not len(shifts):
        return None
    n_perm = len(shifts)
    Yn = np.column_stack([np.roll(y, int(s)) for s in shifts])
    stats, fams = wf_statistics(data, feats, plan, Yn, fast, devices, timings=timings, on_progress=on_progress)
    arr = np.array([a if a is not None else 0.5 for a in stats])
    p_value = permutation_p(real, arr)
    null_fams = [f for fs in fams for f in fs]
    return {
        "statistic": "mean walk-forward AUC over all test years (full procedure incl. family selection)",
        "testYears": [int(t) for t, *_ in plan],
        "holdoutYear": int(plan[-1][0]),
        "foldFamilies": real_fams,
        "nullFamilyShare": {fam: r4(sum(1 for f in null_fams if f == fam) / max(1, len(null_fams))) for fam in FAMILIES},
        "realAuc": r4(real),
        "nullAucs": [r4(x) for x in arr.tolist()],
        "nullMean": r4(arr.mean()),
        "null95": r4(np.quantile(arr, 0.95)),
        "nPerm": int(n_perm),
        "pValue": round(p_value, 6),  # 6 dp: near the adjusted threshold 4 dp would round p onto it
        "method": f"circular shift of the whole label series against the features (offsets of {MIN_SHIFT}+ rows either way; keeps all label autocorrelation); each run repeats the full walk-forward incl. model-family selection",
        "shifts": [int(s) for s in shifts],
    }


# ── device micro-benchmark (ML_DEVICE=auto) ─────────────────────────────────

def benchmark_devices(data: pd.DataFrame, feats: list[str], n_perm: int, fast: bool = False) -> dict:
    """Time the work the permutation test repeats, on one fold (the largest
    training window), per family and device. Units: seconds for that fold's
    fits for ALL n_perm shifts (logit: one batched solve, measured on up to 256
    label columns and scaled; gb: per-fit throughput - CPU with every worker
    thread busy, GPU sequential - times n_perm)."""
    plan = fold_plan(data)
    if not plan:
        return {}
    years = data["year"].to_numpy()
    ty = plan[-1][0]
    end, pred = cutoff_split(years, ty)
    X = _feature_matrix(data, feats)
    Xtr, Xpr = X[:end], X[pred]
    y = data["y_up"].to_numpy(dtype=np.float64)
    shifts = circular_shifts(len(y), 256, np.random.default_rng(SEED)) if len(y) > 2 * MIN_SHIFT else np.arange(1, 9)
    Yall = np.column_stack([np.roll(y, int(s)) for s in shifts])[:end]
    out: dict = {"fold": int(ty), "trainRows": int(end), "features": len(feats), "nPerm": int(n_perm)}

    nl = min(Yall.shape[1], 256)
    lg: dict = {"columns": nl}
    for dev in ("cpu", "cuda"):
        if dev == "cuda" and not dv.torch_cuda():
            lg[dev] = None
            continue
        md.logit_fit_predict(Xtr[:300], Yall[:300, :2], Xpr[:5], dev)  # warm-up (CUDA context, kernels)
        t = time.perf_counter()
        md.logit_fit_predict(Xtr, Yall[:, :nl], Xpr, dev)
        lg[dev] = round((time.perf_counter() - t) * n_perm / nl, 4)
    out["logit"] = lg

    w = dv.cpu_workers()
    gb: dict = {"workers": w}
    k = min(Yall.shape[1], 2 * w)
    md.gb_fit_predict(Xtr[:300], Yall[:300, :1], Xpr[:5], "cpu", fast, 1)  # warm-up
    t = time.perf_counter()
    md.gb_fit_predict(Xtr, Yall[:, :k], Xpr, "cpu", fast, w)
    gb["cpu"] = round((time.perf_counter() - t) / k * n_perm, 4)
    if dv.xgb_cuda():
        md.gb_fit_predict(Xtr[:300], Yall[:300, :1], Xpr[:5], "cuda", fast, 1)
        kc = min(Yall.shape[1], 3)
        t = time.perf_counter()
        md.gb_fit_predict(Xtr, Yall[:, :kc], Xpr, "cuda", fast, 1)
        gb["cuda"] = round((time.perf_counter() - t) / kc * n_perm, 4)
    else:
        gb["cuda"] = None
    out["gb"] = gb
    return out


# ── gate ─────────────────────────────────────────────────────────────────────

BASELINE_LABEL = {
    "logistic": "Beats logistic baseline (AUC)",
    "naive": "Beats naive base-rate baseline (AUC)",
    "mixed": "Beats the simpler baseline per fold (AUC)",
}


def gate(summary: dict, perm: dict | None, n_tests: int = 1) -> dict:
    folds = summary["folds"]
    auc, hit, bauc = summary["auc"], summary["hit"], summary["baselineAuc"]
    p = perm["pValue"] if perm else None
    alpha_adj = adjusted_alpha(n_tests)
    mt = {"method": "bonferroni", "tests": max(1, int(n_tests)), "alpha": GATE["p"], "alphaAdjusted": round(alpha_adj, 6)}
    p_label = f"Permutation p-value (Bonferroni, {mt['tests']} markets)" if mt["tests"] > 1 else "Permutation p-value"
    checks = [
        {"id": "folds", "label": "Out-of-sample test years", "value": folds, "threshold": MIN_TEST_YEARS, "ok": folds >= MIN_TEST_YEARS},
        {"id": "pValue", "label": p_label, "value": p, "threshold": mt["alphaAdjusted"], "ok": p is not None and p < alpha_adj},
        {"id": "auc", "label": "Mean walk-forward AUC", "value": auc, "threshold": GATE["auc"], "ok": auc is not None and auc >= GATE["auc"]},
        {"id": "hit", "label": "Mean hit rate", "value": hit, "threshold": GATE["hit"], "ok": hit is not None and hit >= GATE["hit"]},
        {"id": "baseline", "label": BASELINE_LABEL.get(summary.get("baselineKind") or "logistic", BASELINE_LABEL["mixed"]), "value": bauc, "threshold": None,
         "ok": auc is not None and bauc is not None and auc > bauc},
    ]
    recent = summary.get("recentAuc")
    if recent is not None:  # absent on runs summarised before the recency rule
        years = summary.get("recentYears") or []
        checks.append({"id": "recent", "label": f"Recent test years mean AUC ({', '.join(str(y) for y in years)})", "value": recent,
                       "threshold": RECENT_MIN_AUC, "ok": recent >= RECENT_MIN_AUC})
    if folds < MIN_TEST_YEARS:
        return {"status": "untested", "reasons": [f"only {folds} test year(s) < {MIN_TEST_YEARS}"], "checks": checks, "multipleTesting": mt}
    if perm is None:
        return {"status": "untested", "reasons": ["permutation test could not run"], "checks": checks, "multipleTesting": mt}
    reasons = []
    for c in checks:
        if c["ok"]:
            continue
        if c["id"] == "pValue":
            if mt["tests"] > 1:
                reasons.append(f"p {p:.5f} ≥ {alpha_adj:.5f} (0.05 / {mt['tests']} markets, Bonferroni)")
            else:
                reasons.append(f"p {p:.3f} ≥ {GATE['p']:.2f}")
        elif c["id"] == "auc":
            reasons.append(f"AUC {auc:.3f} < {GATE['auc']:.2f}" if auc is not None else "AUC undefined")
        elif c["id"] == "hit":
            reasons.append(f"hit {hit:.1%} < {GATE['hit']:.0%}" if hit is not None else "hit rate undefined")
        elif c["id"] == "recent":
            reasons.append(f"recent {len(summary.get('recentYears') or [])} test years mean AUC {summary['recentAuc']:.3f} < {RECENT_MIN_AUC:.2f} (edge has faded)")
        elif c["id"] == "baseline":
            reasons.append(f"AUC {auc:.3f} ≤ baseline {bauc:.3f}" if auc is not None and bauc is not None else "baseline comparison undefined")
    return {"status": "passed" if not reasons else "failed", "reasons": reasons, "checks": checks, "multipleTesting": mt}


# ── calibration, importance, bands ──────────────────────────────────────────

def calibration_bins(p: np.ndarray, y: np.ndarray, n_bins: int = CAL_BINS) -> list[dict]:
    edges = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, n_bins - 1)
    out = []
    for b in range(n_bins):
        m = idx == b
        cnt = int(m.sum())
        out.append({
            "lo": r4(edges[b]), "hi": r4(edges[b + 1]),
            "meanPredicted": r4(p[m].mean()) if cnt else None,
            "observed": r4(y[m].mean()) if cnt else None,
            "count": cnt,
        })
    return out


def wilson(k: float, n: int, z: float = 1.2816) -> tuple[float, float] | None:
    """Wilson interval for a proportion (z=1.2816 -> 80%)."""
    if n <= 0:
        return None
    ph = k / n
    den = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / den
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den
    return max(0.0, c - h), min(1.0, c + h)


def p_band(p: float, bins: list[dict], min_count: int = 20) -> tuple[float | None, float | None]:
    """80% interval of the realized up-frequency when the model historically gave
    a probability in the same bin as `p` (out-of-sample)."""
    for b in bins:
        if b["lo"] <= p <= b["hi"] and b["count"] >= min_count and b["observed"] is not None:
            w = wilson(b["observed"] * b["count"], b["count"])
            return (r4(w[0]), r4(w[1])) if w else (None, None)
    return None, None


def importance(last: dict | None, feats: list[str], fast: bool = False) -> list[dict]:
    if not last or len(np.unique(last["yte"])) < 2:
        return []
    # n_jobs=1: the models are multi-threaded / on the GPU themselves
    r = permutation_importance(
        last["clf"], last["Xte"], last["yte"], scoring="roc_auc",
        n_repeats=5 if fast else 10, random_state=SEED, n_jobs=1,
    )
    rows = [{"feature": f, "mean": r4(m), "std": r4(s)} for f, m, s in zip(feats, r.importances_mean, r.importances_std)]
    return sorted(rows, key=lambda x: -(x["mean"] or 0))


def oos_series(oos: pd.DataFrame, max_points: int = OOS_MAX_POINTS) -> dict:
    """The per-day walk-forward out-of-sample series, columnar (downsampled to
    every k-th day only beyond max_points)."""
    if not len(oos):
        return {"date": [], "p": [], "y": [], "testYear": [], "step": 1}
    step = max(1, math.ceil(len(oos) / max_points))
    o = oos.iloc[::step]
    return {
        "date": [pd.Timestamp(d).strftime("%Y-%m-%d") for d in o["date"]],
        "p": [r4(x) for x in o["p"]],
        "y": [int(x) for x in o["y"]],
        "testYear": [int(x) for x in o["testYear"]],
        "step": int(step),
    }


def apply_devices(bundle: dict, mode: str) -> dict:
    """Place a loaded bundle's models on this machine's devices: the run's
    recorded device per family unless ML_DEVICE=cpu or CUDA is unavailable."""
    recorded = (bundle.get("compute") or {}).get("devices") or {}
    want = {f: ("cpu" if dv.requested(mode) == "cpu" else recorded.get(f, "cpu")) for f in FAMILIES}
    for key in ("clf", "baseline", "reg"):
        m = bundle.get(key)
        if isinstance(m, md.XgbModel):
            m.set_device(want["gb"])
        elif isinstance(m, md.TorchLogit):
            m.device = "cuda" if want["logit"] == "cuda" and dv.torch_cuda() else "cpu"
    return want


def predict_latest(bundle: dict, df: pd.DataFrame) -> dict:
    feats = bundle["features"]
    row = latest_row(df, feats)
    if row is None:
        raise ValueError("no row has every model feature present")
    p = float(bundle["clf"].predict_proba(row[feats])[:, 1][0])
    move = float(bundle["reg"].predict(row[feats])[0])
    lo, hi = p_band(p, bundle["calibration"])
    q = bundle.get("residualQuantiles")
    return {
        "date": row["date"].iloc[0].strftime("%Y-%m-%d"),
        "pUp": r4(p),
        "pUpLow": lo,
        "pUpHigh": hi,
        "expectedMove": r4(math.expm1(move)),
        "lower": r4(math.expm1(move + q["q10"])) if q else None,
        "upper": r4(math.expm1(move + q["q90"])) if q else None,
    }


def model_path(metal: str, data_dir: Path) -> Path:
    return data_dir / f"model_{metal}.joblib"


def lib_versions() -> dict:
    out = {"python": sys.version.split()[0], "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__}
    try:
        import xgboost
        out["xgboost"] = xgboost.__version__
    except Exception:  # noqa: BLE001
        out["xgboost"] = None
    try:
        import torch
        out["torch"] = torch.__version__
    except Exception:  # noqa: BLE001
        out["torch"] = None
    out["cuda"] = dv.torch_cuda()
    out["gpu"] = dv.gpu_name()
    return out


# ── commands ─────────────────────────────────────────────────────────────────

def do_train(metal: str, data_dir: Path, n_perm: int | None = None, fast: bool = False, n_tests: int = 1,
             device: str | None = None) -> dict:
    t0 = time.time()
    if n_perm is None:
        n_perm = default_n_perm(n_tests)
    progress(0.02, f"Loading {metal} feature matrix")
    df, meta = load_matrix(metal, data_dir)
    feats, availability = select_features(df, meta)
    if not feats:
        raise ValueError("no usable features")
    core = [f for f in core_features(df, meta) if f in feats]
    data = trainable(df, feats, core)
    progress(0.04, f"{len(data)} labeled rows {data['date'].min():%Y-%m-%d} to {data['date'].max():%Y-%m-%d}, {len(feats)} features ({len(core)} core)")

    tb = time.time()
    mode = dv.requested(device)
    compute = dv.resolve(mode, lambda: benchmark_devices(data, feats, n_perm, fast))
    d = compute["devices"]
    bench_sec = time.time() - tb
    progress(0.06, f"Devices: gradient boosting on {d['gb']}, logistic on {d['logit']} ({mode}"
                   f"{', ' + compute['gpu'] if compute['gpu'] else ''})")

    fam_t: dict = {}

    def on_fold(k, total, ty):
        progress(0.06 + 0.12 * k / max(total, 1), f"Walk-forward fold {k}/{total} (test {ty})")

    tw = time.time()
    folds, oos, last = walk_forward(data, feats, fast, on_fold, d, fam_t)
    summary = summarize(folds, oos)
    wf_sec = time.time() - tw

    progress(0.2, f"Permutation test ({n_perm} circular shifts, full procedure)")

    def on_perm(done, total):
        progress(0.2 + 0.62 * done / max(total, 1), f"Permutation test: {done}/{total} tree batches")

    tp = time.time()
    perm_t: dict = {}
    perm = permutation_test(data, feats, n_perm, fast, d, perm_t, on_perm)
    perm_sec = time.time() - tp
    g = gate(summary, perm, n_tests)
    progress(0.83, "Permutation importance on the latest fold")
    imp = importance(last, feats, fast)
    cal = calibration_bins(oos["p"].to_numpy(), oos["y"].to_numpy()) if len(oos) else []
    resid = (oos["ret"] - oos["retPred"]).to_numpy() if len(oos) else np.array([])
    rq = {"q10": r4(np.quantile(resid, 0.1)), "q90": r4(np.quantile(resid, 0.9))} if len(resid) >= 50 else None

    progress(0.88, "Choosing the model family on all labeled rows (inner walk-forward)")
    tf = time.time()
    X, y = data[feats], data["y_up"].to_numpy()
    family, inner = select_family(data, feats, fast, devices=d)
    selection = {
        "family": family,
        "label": FAMILY_LABEL[family],
        "innerAuc": inner,
        "innerYears": inner_years(data),
        "foldFamilies": summary["familyCounts"],
        "method": f"per training window, the family with the higher mean AUC over an inner walk-forward of its last {INNER_YEARS} years (purged); ties go to logistic",
    }
    progress(0.9, f"Fitting final models on all labeled rows ({FAMILY_LABEL[family]})")
    clf = make_family(family, fast, d[family]).fit(X, y)
    reg = make_reg(fast, d["gb"]).fit(X, data["y_ret"])
    baseline = make_baseline(d["logit"]).fit(X, y)
    final_sec = time.time() - tf
    trained_at = datetime.now(timezone.utc).isoformat()
    bundle = {
        "metal": metal, "features": feats, "H": H, "clf": clf, "family": family, "reg": reg, "baseline": baseline,
        "calibration": cal, "residualQuantiles": rq, "gate": g, "trainedAt": trained_at,
        "labelThrough": data["date"].max().strftime("%Y-%m-%d"), "compute": {"devices": d},
    }
    mp = model_path(metal, data_dir)
    joblib.dump(bundle, mp)
    prediction = predict_latest(bundle, df)

    libs = lib_versions()
    test_ys = [f["testYear"] for f in folds]
    span = {
        "from": data["date"].min().strftime("%Y-%m-%d"),
        "to": bundle["labelThrough"],
        "rows": int(len(data)),
        "testFrom": min(test_ys) if test_ys else None,
        "testTo": max(test_ys) if test_ys else None,
        "oosRows": int(len(oos)),
    }
    metrics = {
        "summary": summary, "folds": folds, "permutation": perm, "gate": g, "selection": selection, "residualQuantiles": rq,
        "nRows": int(len(data)),
        "dataFrom": span["from"],
        "dataThrough": df["date"].max().strftime("%Y-%m-%d"),
        "labelThrough": bundle["labelThrough"],
        "span": span,
        "durationSec": round(time.time() - t0, 1),
        "sklearnVersion": sklearn.__version__,
        "xgboostVersion": libs["xgboost"],
        "torchVersion": libs["torch"],
        "compute": {
            **compute,
            "timings": {
                "wallSec": round(time.time() - t0, 1),
                "benchmarkSec": round(bench_sec, 1),
                "walkForwardSec": round(wf_sec, 1),
                "permutationSec": round(perm_sec, 1),
                "finalFitSec": round(final_sec, 1),
                "permutationFamilySec": {k: round(v, 1) for k, v in perm_t.items()},
            },
        },
        "oos": oos_series(oos),
    }
    progress(1.0, f"{metal}: {g['status'].upper()} ({family}, AUC {summary['auc']}, p {perm['pValue'] if perm else None}, "
                  f"{metrics['durationSec']} s)")
    model_desc = {
        "gb": f"XGBoost hist trees ({md.gb_rounds(fast)} rounds, depth 3, lr 0.05, min_child_weight 5; NaN handled natively; uncalibrated log-loss probabilities)",
        "logit": "Standardized L2 logistic regression (C=0.1; training-window median imputation + missing indicators; torch Newton solver)",
    }[family]
    return {
        "kind": "train", "metal": metal, "horizon": H, "trainedAt": trained_at,
        "params": {"horizon": H, "nPerm": n_perm, "nTests": max(1, int(n_tests)), "minTrainYears": MIN_TRAIN_YEARS,
                   "family": family, "device": mode,
                   "model": f"{model_desc}, chosen by nested selection between gradient boosting and logistic regression; XGBoost regressor for the move",
                   "baseline": "logistic regression when gradient boosting is chosen; naive base-rate (training up-share) when logistic is chosen"},
        "featuresUsed": feats, "availability": availability, "metrics": metrics,
        "importance": imp, "calibration": cal, "modelPath": str(mp), "prediction": prediction,
    }


def do_infer(metal: str, data_dir: Path, device: str | None = None) -> dict:
    mp = model_path(metal, data_dir)
    if not mp.exists():
        raise FileNotFoundError(f"no saved model at {mp}")
    bundle = joblib.load(mp)
    if not isinstance(bundle.get("clf"), (md.XgbModel, md.TorchLogit)):
        raise ValueError("saved model predates the XGBoost/torch pipeline; retrain")
    used = apply_devices(bundle, device or "")
    df, _ = load_matrix(metal, data_dir)
    missing = [f for f in bundle["features"] if f not in df.columns]
    if missing:
        raise ValueError(f"feature matrix lacks model features: {missing}")
    pred = predict_latest(bundle, df)
    return {"kind": "infer", "metal": metal, "horizon": H, "trainedAt": bundle["trainedAt"],
            "modelPath": str(mp), "gate": bundle["gate"], "prediction": pred, "devices": used}


ASSET_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


def asset_id(value: str) -> str:
    """argparse type: a lowercase, path-safe asset id (e.g. gold, silver, bitcoin)."""
    if not ASSET_ID_RE.match(value):
        raise argparse.ArgumentTypeError(f"invalid asset id: {value!r}")
    return value


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["train", "infer", "version"])
    # Any asset id from shared/universe.ts (the Node runner validates it); the id
    # only names files (features_<id>.csv, model_<id>.joblib), so keep it path-safe.
    ap.add_argument("--metal", "--asset", dest="metal", type=asset_id)
    ap.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    ap.add_argument("--n-perm", type=int, default=None, help="default: enough to resolve the adjusted alpha")
    ap.add_argument("--n-tests", type=int, default=1, help="markets tested (Bonferroni family size)")
    ap.add_argument("--device", choices=list(dv.VALID), default=None, help="default: env ML_DEVICE, else auto")
    ap.add_argument("--fast", action="store_true", help="smaller models (tests only)")
    a = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # cp1252 consoles on Windows
    if a.command == "version":
        print(json.dumps(lib_versions()))
        return 0
    if not a.metal:
        ap.error("--metal/--asset is required")
    data_dir = Path(a.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    if a.command == "train":
        result = do_train(a.metal, data_dir, a.n_perm, a.fast, a.n_tests, a.device)
    else:
        result = do_infer(a.metal, data_dir, a.device)
    out = data_dir / f"{a.command}_{a.metal}.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"RESULT {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Per-asset 20-day direction model with honest walk-forward validation.

Ported and adapted from CommodityFutures/scripts/ml (Tier 2 pipeline): there it
pooled many spread instruments; here each asset has one long outright series,
so the model is per asset and the validation is an expanding-window
walk-forward by calendar year.

  * y_up  -> one of two families, chosen per asset by NESTED selection:
             HistGradientBoostingClassifier (uncalibrated, see make_clf), or
             standardized, L2-regularized LogisticRegression (C=0.1)
  * y_ret -> GradientBoostingRegressor (expected 20d log move)
  * baseline -> the next simpler model: logistic when gradient boosting is
             chosen, the naive base-rate forecast when logistic is chosen

MODEL-FAMILY SELECTION (nested, see select_family)
  Inside every training window the family is chosen by an inner walk-forward
  over that window's last 3 years; the outer test year never influences the
  choice, so the walk-forward scores the selection procedure itself.

VALIDATION
  Expanding window, one test year at a time, with at least MIN_TRAIN_YEARS of
  history before the first test year. The last H training rows before each test
  year are PURGED: their forward labels overlap the test year, so keeping them
  would leak test-period returns into training.

PERMUTATION TEST (whole walk-forward)
  The statistic is the reported walk-forward AUC itself: the mean over all test
  years of the per-year out-of-sample AUC of the full procedure (fit_fold:
  family selection + fit), on the same fold splits. Each null run circularly
  shifts the whole label series against the features by >= 1 year (keeps the
  20-day overlap AND slow regimes; block-permuting 20-row blocks proved too
  narrow a null) and repeats the whole procedure, selection
  included. One-sided: p = (1 + #{null >= real}) / (1 + N); an AUC below 0.5
  gets p > 0.5.

MULTIPLE TESTING (Bonferroni)
  The server trains one model per market in the universe and tests each, so
  the per-model threshold is alpha / m (m = --n-tests, the number of markets;
  0.05 / 6 = 0.0083). Without it, with six markets and no real skill anywhere,
  the chance that at least one passes by luck is 1 - 0.95^6 = 26%. The number
  of permutations defaults to enough that the smallest attainable p,
  1 / (N + 1), sits well below the adjusted threshold (N >= 4 / alpha_adj).

GATE
  passed iff p < 0.05 / m AND mean fold AUC >= 0.55 AND mean hit >= 0.52 AND
  the model's mean AUC beats the baseline; untested with < 3 test years.

USAGE
  python ml/pipeline.py train --asset gold [--data-dir data/ml] [--n-tests 6] [--n-perm N]
  python ml/pipeline.py infer --metal gold [--data-dir data/ml]
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
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import GradientBoostingRegressor, HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, mean_squared_error, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import DEFAULT_DATA_DIR, H, latest_row, load_matrix, select_features, trainable  # noqa: E402

SEED = 42
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

def make_clf(fast: bool = False):
    """Gradient-boosted trees (histogram variant: same model class, ~30x faster,
    which is what makes the full-procedure permutation test affordable).

    NOT Platt-calibrated: a sigmoid fitted on cross-validated scores can get a
    NEGATIVE slope when the in-sample signal is weak, which silently inverts the
    ranking (it turned a fold AUC of 0.447 into 0.553). The reported AUC, the
    gate and the permutation test must all describe the same scores, so the
    model's own log-loss probabilities are used; the reliability of those
    probabilities is shown out of sample in the calibration bins."""
    return HistGradientBoostingClassifier(
        max_iter=60 if fast else 150, max_depth=3, learning_rate=0.05, early_stopping=False, random_state=SEED
    )


def make_reg(fast: bool = False):
    return GradientBoostingRegressor(
        n_estimators=60 if fast else 150, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=SEED
    )


def make_baseline():
    return make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000))


# Model families the pipeline chooses between, per asset and per training window.
FAMILIES = ("gb", "logit")
FAMILY_LABEL = {
    "gb": "gradient boosting",
    "logit": "logistic regression (L2, C=0.1)",
}


def make_family(family: str, fast: bool = False):
    """The SAME estimator is used for inner selection, the walk-forward, the
    permutation test and the saved model - no lighter stand-ins."""
    return make_baseline() if family == "logit" else make_clf(fast)


# ── walk-forward ─────────────────────────────────────────────────────────────

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


# ── model-family selection (nested, training data only) ─────────────────────
#
# Which family generalizes better differs by asset (copper: the logistic model
# beat gradient boosting out of sample). Choosing the family by looking at the
# walk-forward test years would make those years part of the fit, so the choice
# is made INSIDE each training window by an inner walk-forward over its last
# INNER_YEARS calendar years (same purge), and the outer test year only ever
# scores the family chosen without it. The selection is therefore part of the
# procedure being validated - and the permutation test re-runs it on every
# shuffled label set (see permutation_test).

INNER_YEARS = 3
MIN_INNER_TRAIN = 250


def inner_years(train: pd.DataFrame) -> list[int]:
    """The last INNER_YEARS full-enough calendar years of a training window."""
    years = [y for y in sorted(int(v) for v in train["year"].unique()) if (train["year"] == y).sum() >= MIN_TEST_ROWS]
    return years[1:][-INNER_YEARS:]  # never the first year: it has no history to train on


def select_family(train: pd.DataFrame, feats: list[str], fast: bool = False,
                  y: np.ndarray | None = None) -> tuple[str, dict]:
    """Pick the family with the best mean inner-walk-forward AUC on `train`
    (labels `y`, default train["y_up"]). Ties - and windows too short for any
    inner fold - go to the simpler logistic model. Returns (family, scores)."""
    t = train if y is None else train.assign(y_up=y)
    scores: dict[str, list[float]] = {f: [] for f in FAMILIES}
    for iy in inner_years(t):
        itr, ite, _ = purged_split(t, iy)
        ytr, yte = itr["y_up"].to_numpy(), ite["y_up"].to_numpy()
        if len(itr) < MIN_INNER_TRAIN or len(np.unique(ytr)) < 2 or len(np.unique(yte)) < 2:
            continue
        for fam in FAMILIES:
            m = make_family(fam, fast).fit(itr[feats], ytr)
            scores[fam].append(float(roc_auc_score(yte, m.predict_proba(ite[feats])[:, 1])))
    mean = {f: (float(np.mean(v)) if v else None) for f, v in scores.items()}
    if mean["gb"] is None or mean["logit"] is None:
        return "logit", {f: r4(v) for f, v in mean.items()}
    return ("gb" if mean["gb"] > mean["logit"] else "logit"), {f: r4(v) for f, v in mean.items()}


def fold_plan(data: pd.DataFrame) -> list[tuple[int, pd.DataFrame, pd.DataFrame, int]]:
    """The outer walk-forward folds (test year, purged train, test, rows purged).
    Computed once from the real data and reused unchanged by the permutation
    test, so real and shuffled runs are scored on identical splits."""
    plan = []
    for ty in test_years(data):
        train, test, purged = purged_split(data, ty)
        if train["y_up"].nunique() < 2 or len(train) < 250:
            continue
        plan.append((ty, train, test, purged))
    return plan


def fit_fold(train: pd.DataFrame, test: pd.DataFrame, feats: list[str], ytr: np.ndarray, fast: bool = False):
    """THE per-fold procedure: choose the family on the training window (labels
    `ytr`), fit it, predict the test year. Used by walk_forward (real labels)
    and by every permutation run (shuffled labels) - one code path, so the
    reported AUC and the permutation statistic are the same quantity."""
    family, inner = select_family(train, feats, fast, y=ytr)
    clf = make_family(family, fast).fit(train[feats], ytr)
    return family, inner, clf, clf.predict_proba(test[feats])[:, 1]


def mean_fold_auc(aucs: list[float | None]) -> float | None:
    xs = [a for a in aucs if a is not None]
    return float(np.mean(xs)) if xs else None


def oos_mean_auc(oos: pd.DataFrame) -> float | None:
    """Mean over test years of the per-year AUC (unrounded): the walk-forward
    AUC the gate checks and the permutation test's statistic."""
    return mean_fold_auc([safe_auc(g["y"].to_numpy().astype(int), g["p"].to_numpy()) for _, g in oos.groupby("testYear", sort=True)])


def walk_forward(data: pd.DataFrame, feats: list[str], fast: bool = False, on_fold=None):
    """Returns (folds, oos frame, last-fold artefacts for importance).

    Per fold: choose the family on the training window only (select_family),
    fit it, score the test year. The comparator ("baseline") is the next
    simpler model: the logistic regression when the chosen family is gradient
    boosting, and the naive base-rate forecast (the training window's up-share,
    a constant: AUC 0.5, hit = always calling the majority side) when the
    chosen family is itself the logistic regression."""
    folds, oos_parts = [], []
    last = None
    plan = fold_plan(data)
    years = test_years(data)
    for k, (ty, train, test, purged) in enumerate(plan):
        Xtr, ytr, Xte, yte = train[feats], train["y_up"].to_numpy(), test[feats], test["y_up"].to_numpy()
        family, inner, clf, p = fit_fold(train, test, feats, ytr, fast)
        if family == "gb":
            pb = make_baseline().fit(Xtr, ytr).predict_proba(Xte)[:, 1]
            baseline_kind = "logistic"
        else:
            pb = np.full(len(yte), float(ytr.mean()))
            baseline_kind = "naive"
        reg = make_reg(fast).fit(Xtr, train["y_ret"])
        rp = reg.predict(Xte)
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
        last = {"clf": clf, "Xte": Xte, "yte": yte, "year": int(ty)}
        if on_fold:
            on_fold(k + 1, len(plan) or len(years), ty)
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


def wf_statistic(data: pd.DataFrame, feats: list[str], plan, y: np.ndarray, fast: bool = False) -> tuple[float | None, list[str]]:
    """Mean walk-forward AUC of the full procedure (family selection + fit, via
    fit_fold) on labels `y` (aligned with `data`), over the fixed `plan`.
    Returns (statistic, family chosen per fold)."""
    ys = pd.Series(y, index=data.index)
    aucs, fams = [], []
    for _, train, test, _ in plan:
        family, _, _, p = fit_fold(train, test, feats, ys.loc[train.index].to_numpy(), fast)
        aucs.append(safe_auc(ys.loc[test.index].to_numpy().astype(int), p))
        fams.append(family)
    return mean_fold_auc(aucs), fams


def permutation_p(real: float, null: np.ndarray) -> float:
    """One-sided (larger AUC = more skill): p = (1 + #{null >= real}) / (1 + N).
    An observed AUC below the null's centre (0.5) therefore gets p > 0.5."""
    return float((np.sum(null >= real) + 1) / (len(null) + 1))


def permutation_test(data: pd.DataFrame, feats: list[str], n_perm: int = N_PERM_MIN, fast: bool = False) -> dict | None:
    """The statistic is EXACTLY the walk-forward AUC the report and gate use:
    the mean over all outer test years of the per-year AUC of the full
    procedure (inner family selection included), on the same fold splits.

    NULL: the whole label series is CIRCULARLY SHIFTED against the features by
    a random offset of at least a year (MIN_SHIFT) in either direction. That
    keeps the label series' entire autocorrelation - the 20-day overlap AND the
    slow multi-month regimes and yearly up-shares - and only breaks its
    alignment with the features. (An earlier version permuted 20-row blocks:
    that keeps the overlap but scrambles regimes longer than a block, which
    made the null too narrow and the p-values anti-conservative; see the
    calibration check in test_pipeline / data notes.) Each null run repeats
    the whole procedure, selection included, so p is valid under selection."""
    plan = fold_plan(data)
    if not plan:
        return None
    y = data["y_up"].to_numpy()
    real, real_fams = wf_statistic(data, feats, plan, y, fast)
    if real is None:
        return None
    rng = np.random.default_rng(SEED)
    shifts = circular_shifts(len(y), n_perm, rng)
    if not len(shifts):
        return None
    n_perm = len(shifts)
    perms = [np.roll(y, int(s)) for s in shifts]
    try:
        from joblib import Parallel, delayed, parallel_config
        # one thread per worker: the tree models are multi-threaded themselves
        with parallel_config(backend="loky", inner_max_num_threads=1):
            runs = Parallel(n_jobs=-1)(delayed(wf_statistic)(data, feats, plan, yp, fast) for yp in perms)
    except Exception as e:  # pragma: no cover - platform quirk fallback
        print(f"  [perm] parallel unavailable ({e}); sequential fallback", flush=True)
        runs = [wf_statistic(data, feats, plan, yp, fast) for yp in perms]
    arr = np.array([a if a is not None else 0.5 for a, _ in runs])
    p_value = permutation_p(real, arr)
    null_fams = [f for _, fs in runs for f in fs]
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
    r = permutation_importance(
        last["clf"], last["Xte"], last["yte"], scoring="roc_auc",
        n_repeats=5 if fast else 10, random_state=SEED, n_jobs=-1,
    )
    rows = [{"feature": f, "mean": r4(m), "std": r4(s)} for f, m, s in zip(feats, r.importances_mean, r.importances_std)]
    return sorted(rows, key=lambda x: -(x["mean"] or 0))


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


# ── commands ─────────────────────────────────────────────────────────────────

def do_train(metal: str, data_dir: Path, n_perm: int | None = None, fast: bool = False, n_tests: int = 1) -> dict:
    t0 = time.time()
    if n_perm is None:
        n_perm = default_n_perm(n_tests)
    progress(0.02, f"Loading {metal} feature matrix")
    df, meta = load_matrix(metal, data_dir)
    feats, availability = select_features(df, meta)
    if not feats:
        raise ValueError("no usable features")
    data = trainable(df, feats)
    progress(0.05, f"{len(data)} labeled rows, {len(feats)} features")

    def on_fold(k, total, ty):
        progress(0.05 + 0.5 * k / max(total, 1), f"Walk-forward fold {k}/{total} (test {ty})")

    folds, oos, last = walk_forward(data, feats, fast, on_fold)
    summary = summarize(folds, oos)
    progress(0.56, f"Permutation test ({n_perm} block shuffles)")
    perm = permutation_test(data, feats, n_perm, fast)
    g = gate(summary, perm, n_tests)
    progress(0.82, "Permutation importance on the latest fold")
    imp = importance(last, feats, fast)
    cal = calibration_bins(oos["p"].to_numpy(), oos["y"].to_numpy()) if len(oos) else []
    resid = (oos["ret"] - oos["retPred"]).to_numpy() if len(oos) else np.array([])
    rq = {"q10": r4(np.quantile(resid, 0.1)), "q90": r4(np.quantile(resid, 0.9))} if len(resid) >= 50 else None

    progress(0.88, "Choosing the model family on all labeled rows (inner walk-forward)")
    X, y = data[feats], data["y_up"].to_numpy()
    family, inner = select_family(data, feats, fast)
    selection = {
        "family": family,
        "label": FAMILY_LABEL[family],
        "innerAuc": inner,
        "innerYears": inner_years(data),
        "foldFamilies": summary["familyCounts"],
        "method": f"per training window, the family with the higher mean AUC over an inner walk-forward of its last {INNER_YEARS} years (purged); ties go to logistic",
    }
    progress(0.9, f"Fitting final models on all labeled rows ({FAMILY_LABEL[family]})")
    clf = make_family(family, fast).fit(X, y)
    reg = make_reg(fast).fit(X, data["y_ret"])
    baseline = make_baseline().fit(X, y)
    trained_at = datetime.now(timezone.utc).isoformat()
    bundle = {
        "metal": metal, "features": feats, "H": H, "clf": clf, "family": family, "reg": reg, "baseline": baseline,
        "calibration": cal, "residualQuantiles": rq, "gate": g, "trainedAt": trained_at,
        "labelThrough": data["date"].max().strftime("%Y-%m-%d"),
    }
    mp = model_path(metal, data_dir)
    joblib.dump(bundle, mp)
    prediction = predict_latest(bundle, df)

    metrics = {
        "summary": summary, "folds": folds, "permutation": perm, "gate": g, "selection": selection, "residualQuantiles": rq,
        "nRows": int(len(data)),
        "dataFrom": data["date"].min().strftime("%Y-%m-%d"),
        "dataThrough": df["date"].max().strftime("%Y-%m-%d"),
        "labelThrough": bundle["labelThrough"],
        "durationSec": round(time.time() - t0, 1),
        "sklearnVersion": sklearn.__version__,
    }
    progress(1.0, f"{metal}: {g['status'].upper()} ({family}, AUC {summary['auc']}, p {perm['pValue'] if perm else None})")
    model_desc = {
        "gb": "HistGradientBoostingClassifier (150 iterations, depth 3, lr 0.05; uncalibrated log-loss probabilities)",
        "logit": "StandardScaler + LogisticRegression (L2, C=0.1)",
    }[family]
    return {
        "kind": "train", "metal": metal, "horizon": H, "trainedAt": trained_at,
        "params": {"horizon": H, "nPerm": n_perm, "nTests": max(1, int(n_tests)), "minTrainYears": MIN_TRAIN_YEARS,
                   "family": family,
                   "model": f"{model_desc}, chosen by nested selection between gradient boosting and logistic regression; GradientBoostingRegressor for the move",
                   "baseline": "logistic regression when gradient boosting is chosen; naive base-rate (training up-share) when logistic is chosen"},
        "featuresUsed": feats, "availability": availability, "metrics": metrics,
        "importance": imp, "calibration": cal, "modelPath": str(mp), "prediction": prediction,
    }


def do_infer(metal: str, data_dir: Path) -> dict:
    mp = model_path(metal, data_dir)
    if not mp.exists():
        raise FileNotFoundError(f"no saved model at {mp}")
    bundle = joblib.load(mp)
    df, _ = load_matrix(metal, data_dir)
    missing = [f for f in bundle["features"] if f not in df.columns]
    if missing:
        raise ValueError(f"feature matrix lacks model features: {missing}")
    pred = predict_latest(bundle, df)
    return {"kind": "infer", "metal": metal, "horizon": H, "trainedAt": bundle["trainedAt"],
            "modelPath": str(mp), "gate": bundle["gate"], "prediction": pred}


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
    ap.add_argument("--fast", action="store_true", help="smaller models (tests only)")
    a = ap.parse_args(argv)
    if a.command == "version":
        print(json.dumps({"python": sys.version.split()[0], "sklearn": sklearn.__version__,
                          "numpy": np.__version__, "pandas": pd.__version__}))
        return 0
    if not a.metal:
        ap.error("--metal/--asset is required")
    data_dir = Path(a.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    result = do_train(a.metal, data_dir, a.n_perm, a.fast, a.n_tests) if a.command == "train" else do_infer(a.metal, data_dir)
    out = data_dir / f"{a.command}_{a.metal}.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"RESULT {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

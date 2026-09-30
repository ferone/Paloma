"""Per-asset 20-day direction model with honest walk-forward validation.

Ported and adapted from CommodityFutures/scripts/ml (Tier 2 pipeline): there it
pooled many spread instruments; here each asset has one long outright series,
so the model is per asset and the validation is an expanding-window
walk-forward by calendar year.

  * y_up  -> GradientBoostingClassifier, Platt-calibrated (sigmoid, cv=3)
  * y_ret -> GradientBoostingRegressor (expected 20d log move)
  * baseline -> standardized, L2-regularized LogisticRegression (C=0.1)

VALIDATION
  Expanding window, one test year at a time, with at least MIN_TRAIN_YEARS of
  history before the first test year. The last H training rows before each test
  year are PURGED: their forward labels overlap the test year, so keeping them
  would leak test-period returns into training.

PERMUTATION TEST (most recent test year)
  The real out-of-sample AUC is compared against a null built by refitting on
  block-permuted training labels (blocks of H rows keep the overlap structure,
  so the null is not artificially weak). p = (#null >= real + 1) / (N + 1).

GATE
  passed iff p < 0.05 AND mean fold AUC >= 0.55 AND mean hit >= 0.52 AND the
  model's mean AUC beats the logistic baseline; untested with < 3 test years.

USAGE
  python ml/pipeline.py train --metal gold [--data-dir data/ml] [--n-perm 100]
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
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
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
N_PERM = 100
GATE = {"p": 0.05, "auc": 0.55, "hit": 0.52}
CAL_BINS = 10


def progress(frac: float, msg: str) -> None:
    print(f"PROGRESS {frac:.3f} {msg}", flush=True)


# ── models ───────────────────────────────────────────────────────────────────

def make_clf(fast: bool = False):
    gb = GradientBoostingClassifier(
        n_estimators=60 if fast else 150, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=SEED
    )
    return CalibratedClassifierCV(gb, method="sigmoid", cv=3)


def make_reg(fast: bool = False):
    return GradientBoostingRegressor(
        n_estimators=60 if fast else 150, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=SEED
    )


def make_baseline():
    return make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000))


def make_perm_clf(fast: bool = False):
    # Lighter uncalibrated model for the permutation loop; used for BOTH the real
    # and the shuffled fits so the comparison stays fair. (Calibration is a
    # monotone map, so it would not change AUC.)
    return GradientBoostingClassifier(
        n_estimators=40 if fast else 80, max_depth=3, learning_rate=0.08, subsample=0.8, random_state=SEED
    )


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


def walk_forward(data: pd.DataFrame, feats: list[str], fast: bool = False, on_fold=None):
    """Returns (folds, oos frame, last-fold artefacts for importance)."""
    folds, oos_parts = [], []
    last = None
    years = test_years(data)
    for k, ty in enumerate(years):
        train, test, purged = purged_split(data, ty)
        if train["y_up"].nunique() < 2 or len(train) < 250:
            continue
        Xtr, ytr, Xte, yte = train[feats], train["y_up"].to_numpy(), test[feats], test["y_up"].to_numpy()
        clf = make_clf(fast).fit(Xtr, ytr)
        p = clf.predict_proba(Xte)[:, 1]
        base = make_baseline().fit(Xtr, ytr)
        pb = base.predict_proba(Xte)[:, 1]
        reg = make_reg(fast).fit(Xtr, train["y_ret"])
        rp = reg.predict(Xte)
        yret = test["y_ret"].to_numpy()
        folds.append({
            "testYear": int(ty),
            "nTrain": int(len(train)),
            "nTest": int(len(test)),
            "purged": int(purged),
            "auc": r4(safe_auc(yte, p)),
            "hit": r4(((p > 0.5).astype(int) == yte).mean()),
            "brier": r4(brier_score_loss(yte, p)),
            "baseRate": r4(yte.mean()),
            "baselineAuc": r4(safe_auc(yte, pb)),
            "baselineHit": r4(((pb > 0.5).astype(int) == yte).mean()),
            "rmse": r4(math.sqrt(mean_squared_error(yret, rp))),
            "ic": r4(spearman(rp, yret)),
        })
        oos_parts.append(pd.DataFrame({"date": test["date"].to_numpy(), "p": p, "pb": pb, "y": yte, "ret": yret, "retPred": rp}))
        last = {"clf": clf, "Xte": Xte, "yte": yte, "year": int(ty)}
        if on_fold:
            on_fold(k + 1, len(years), ty)
    oos = pd.concat(oos_parts, ignore_index=True) if oos_parts else pd.DataFrame(columns=["date", "p", "pb", "y", "ret", "retPred"])
    return folds, oos, last


def summarize(folds: list[dict], oos: pd.DataFrame) -> dict:
    def avg(key):
        xs = [f[key] for f in folds if f[key] is not None]
        return r4(np.mean(xs)) if xs else None

    pooled = safe_auc(oos["y"].to_numpy().astype(int), oos["p"].to_numpy()) if len(oos) else None
    return {
        "folds": len(folds),
        "auc": avg("auc"),
        "hit": avg("hit"),
        "brier": avg("brier"),
        "baseRate": avg("baseRate"),
        "baselineAuc": avg("baselineAuc"),
        "baselineHit": avg("baselineHit"),
        "rmse": avg("rmse"),
        "ic": avg("ic"),
        "pooledAuc": r4(pooled),
    }


# ── permutation test ─────────────────────────────────────────────────────────

def block_permute(y: np.ndarray, block: int, rng: np.random.Generator) -> np.ndarray:
    """Shuffle labels in contiguous blocks of `block` rows (keeps the overlap
    autocorrelation of H-day labels inside each block)."""
    n = len(y)
    starts = np.arange(0, n, block)
    order = rng.permutation(len(starts))
    return np.concatenate([y[starts[i]: starts[i] + block] for i in order])


def _perm_auc(Xtr, yp, Xte, yte, fast) -> float:
    c = make_perm_clf(fast).fit(Xtr, yp)
    return float(roc_auc_score(yte, c.predict_proba(Xte)[:, 1]))


def permutation_test(data: pd.DataFrame, feats: list[str], n_perm: int = N_PERM, fast: bool = False) -> dict | None:
    years = test_years(data)
    if not years:
        return None
    ty = years[-1]
    train, test, _ = purged_split(data, ty)
    ytr, yte = train["y_up"].to_numpy(), test["y_up"].to_numpy()
    if len(np.unique(ytr)) < 2 or len(np.unique(yte)) < 2:
        return None
    Xtr, Xte = train[feats], test[feats]
    real = _perm_auc(Xtr, ytr, Xte, yte, fast)
    rng = np.random.default_rng(SEED)
    perms = [block_permute(ytr, H, rng) for _ in range(n_perm)]
    try:
        from joblib import Parallel, delayed
        null = Parallel(n_jobs=-1)(delayed(_perm_auc)(Xtr, yp, Xte, yte, fast) for yp in perms)
    except Exception as e:  # pragma: no cover - platform quirk fallback
        print(f"  [perm] parallel unavailable ({e}); sequential fallback", flush=True)
        null = [_perm_auc(Xtr, yp, Xte, yte, fast) for yp in perms]
    arr = np.array(null)
    p_value = float((np.sum(arr >= real) + 1) / (n_perm + 1))
    return {
        "holdoutYear": int(ty),
        "realAuc": r4(real),
        "nullAucs": [r4(x) for x in arr.tolist()],
        "nullMean": r4(arr.mean()),
        "null95": r4(np.quantile(arr, 0.95)),
        "nPerm": int(n_perm),
        "pValue": r4(p_value),
        "method": f"block permutation of training labels (blocks of {H} rows)",
    }


# ── gate ─────────────────────────────────────────────────────────────────────

def gate(summary: dict, perm: dict | None) -> dict:
    folds = summary["folds"]
    auc, hit, bauc = summary["auc"], summary["hit"], summary["baselineAuc"]
    p = perm["pValue"] if perm else None
    checks = [
        {"id": "folds", "label": "Out-of-sample test years", "value": folds, "threshold": MIN_TEST_YEARS, "ok": folds >= MIN_TEST_YEARS},
        {"id": "pValue", "label": "Permutation p-value", "value": p, "threshold": GATE["p"], "ok": p is not None and p < GATE["p"]},
        {"id": "auc", "label": "Mean walk-forward AUC", "value": auc, "threshold": GATE["auc"], "ok": auc is not None and auc >= GATE["auc"]},
        {"id": "hit", "label": "Mean hit rate", "value": hit, "threshold": GATE["hit"], "ok": hit is not None and hit >= GATE["hit"]},
        {"id": "baseline", "label": "Beats logistic baseline (AUC)", "value": bauc, "threshold": None,
         "ok": auc is not None and bauc is not None and auc > bauc},
    ]
    if folds < MIN_TEST_YEARS:
        return {"status": "untested", "reasons": [f"only {folds} test year(s) < {MIN_TEST_YEARS}"], "checks": checks}
    if perm is None:
        return {"status": "untested", "reasons": ["permutation test could not run"], "checks": checks}
    reasons = []
    for c in checks:
        if c["ok"]:
            continue
        if c["id"] == "pValue":
            reasons.append(f"p {p:.3f} ≥ {GATE['p']:.2f}")
        elif c["id"] == "auc":
            reasons.append(f"AUC {auc:.3f} < {GATE['auc']:.2f}" if auc is not None else "AUC undefined")
        elif c["id"] == "hit":
            reasons.append(f"hit {hit:.1%} < {GATE['hit']:.0%}" if hit is not None else "hit rate undefined")
        elif c["id"] == "baseline":
            reasons.append(f"AUC {auc:.3f} ≤ baseline {bauc:.3f}" if auc is not None and bauc is not None else "baseline comparison undefined")
    return {"status": "passed" if not reasons else "failed", "reasons": reasons, "checks": checks}


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

def do_train(metal: str, data_dir: Path, n_perm: int = N_PERM, fast: bool = False) -> dict:
    t0 = time.time()
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
    g = gate(summary, perm)
    progress(0.82, "Permutation importance on the latest fold")
    imp = importance(last, feats, fast)
    cal = calibration_bins(oos["p"].to_numpy(), oos["y"].to_numpy()) if len(oos) else []
    resid = (oos["ret"] - oos["retPred"]).to_numpy() if len(oos) else np.array([])
    rq = {"q10": r4(np.quantile(resid, 0.1)), "q90": r4(np.quantile(resid, 0.9))} if len(resid) >= 50 else None

    progress(0.9, "Fitting final models on all labeled rows")
    X, y = data[feats], data["y_up"].to_numpy()
    clf = make_clf(fast).fit(X, y)
    reg = make_reg(fast).fit(X, data["y_ret"])
    baseline = make_baseline().fit(X, y)
    trained_at = datetime.now(timezone.utc).isoformat()
    bundle = {
        "metal": metal, "features": feats, "H": H, "clf": clf, "reg": reg, "baseline": baseline,
        "calibration": cal, "residualQuantiles": rq, "gate": g, "trainedAt": trained_at,
        "labelThrough": data["date"].max().strftime("%Y-%m-%d"),
    }
    mp = model_path(metal, data_dir)
    joblib.dump(bundle, mp)
    prediction = predict_latest(bundle, df)

    metrics = {
        "summary": summary, "folds": folds, "permutation": perm, "gate": g, "residualQuantiles": rq,
        "nRows": int(len(data)),
        "dataFrom": data["date"].min().strftime("%Y-%m-%d"),
        "dataThrough": df["date"].max().strftime("%Y-%m-%d"),
        "labelThrough": bundle["labelThrough"],
        "durationSec": round(time.time() - t0, 1),
        "sklearnVersion": sklearn.__version__,
    }
    progress(1.0, f"{metal}: {g['status'].upper()} (AUC {summary['auc']}, p {perm['pValue'] if perm else None})")
    return {
        "kind": "train", "metal": metal, "horizon": H, "trainedAt": trained_at,
        "params": {"horizon": H, "nPerm": n_perm, "minTrainYears": MIN_TRAIN_YEARS,
                   "model": "GradientBoostingClassifier (150 trees, depth 3, lr 0.05) + sigmoid calibration (cv=3); GradientBoostingRegressor for the move",
                   "baseline": "StandardScaler + LogisticRegression (L2, C=0.1)"},
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
    ap.add_argument("--n-perm", type=int, default=N_PERM)
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
    result = do_train(a.metal, data_dir, a.n_perm, a.fast) if a.command == "train" else do_infer(a.metal, data_dir)
    out = data_dir / f"{a.command}_{a.metal}.json"
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"RESULT {out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Tests for the walk-forward / purge / gate logic on synthetic data.

Run with `python -m pytest ml -q` or standalone: `python ml/test_pipeline.py`.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline as pl  # noqa: E402
from features import H, select_features, synthetic_matrix, trainable  # noqa: E402


def _data(**kw) -> pd.DataFrame:
    df = synthetic_matrix(**kw)
    return trainable(df, ["f0", "f1", "f2", "f3"])


def test_test_years_require_min_train_years():
    data = _data(n_years=10, start="2010-01-01")
    years = pl.test_years(data)
    assert years[0] == 2010 + pl.MIN_TRAIN_YEARS
    assert all(y - 2010 >= pl.MIN_TRAIN_YEARS for y in years)


def test_purge_removes_label_overlap():
    data = _data(n_years=10, start="2010-01-01")
    for ty in pl.test_years(data):
        train, test, purged = pl.purged_split(data, ty)
        assert purged == H
        before = data[data["year"] < ty]
        # exactly the last H pre-test rows are dropped
        assert len(train) == len(before) - H
        assert train["date"].max() < before["date"].iloc[-H]
        # no training row's H-row forward window reaches the first test row
        last_train_pos = data.index.get_loc(train.index[-1])
        first_test_pos = data.index.get_loc(test.index[0])
        assert last_train_pos + H < first_test_pos
        assert train["year"].max() < ty
        assert (test["year"] == ty).all()


def test_block_permute_keeps_blocks_and_multiset():
    rng = np.random.default_rng(0)
    y = np.arange(95)
    p = pl.block_permute(y, 20, rng)
    assert sorted(p.tolist()) == y.tolist()
    # contiguous runs of the original blocks survive
    blocks = [tuple(y[i:i + 20]) for i in range(0, 95, 20)]
    s = p.tolist()
    for b in blocks:
        i = s.index(b[0])
        assert tuple(s[i:i + len(b)]) == b


def _summary(**kw):
    base = {"folds": 10, "auc": 0.6, "hit": 0.56, "brier": 0.24, "baseRate": 0.5, "baselineAuc": 0.52,
            "baselineHit": 0.5, "rmse": 0.05, "ic": 0.1, "pooledAuc": 0.6}
    base.update(kw)
    return base


def test_gate_logic():
    perm_ok = {"pValue": 0.01}
    assert pl.gate(_summary(), perm_ok)["status"] == "passed"
    g = pl.gate(_summary(auc=0.53), perm_ok)
    assert g["status"] == "failed" and any("AUC 0.530 < 0.55" in r for r in g["reasons"])
    assert pl.gate(_summary(), {"pValue": 0.2})["status"] == "failed"
    assert pl.gate(_summary(hit=0.51), perm_ok)["status"] == "failed"
    assert pl.gate(_summary(baselineAuc=0.61), perm_ok)["status"] == "failed"
    assert pl.gate(_summary(folds=2), perm_ok)["status"] == "untested"
    assert pl.gate(_summary(), None)["status"] == "untested"


def test_gate_bonferroni_over_markets():
    # p = 0.0099 passes alone but not when six markets are tested (0.05 / 6 = 0.0083).
    perm = {"pValue": 0.0099}
    assert pl.gate(_summary(), perm, n_tests=1)["status"] == "passed"
    g = pl.gate(_summary(), perm, n_tests=6)
    assert g["status"] == "failed"
    assert g["multipleTesting"] == {"method": "bonferroni", "tests": 6, "alpha": 0.05, "alphaAdjusted": 0.008333}
    check = next(c for c in g["checks"] if c["id"] == "pValue")
    assert check["threshold"] == 0.008333 and not check["ok"]
    assert any("Bonferroni" in r for r in g["reasons"])
    assert pl.gate(_summary(), {"pValue": 0.002}, n_tests=6)["status"] == "passed"
    # the permutation count can resolve the adjusted threshold: 1 / (N + 1) <= alpha_adj / 4
    n = pl.default_n_perm(6)
    assert 1 / (n + 1) <= pl.adjusted_alpha(6) / 4
    assert pl.default_n_perm(1) == pl.N_PERM_MIN


def test_calibration_bins_and_wilson():
    p = np.array([0.05, 0.15, 0.55, 0.56, 0.95])
    y = np.array([0, 0, 1, 0, 1])
    bins = pl.calibration_bins(p, y)
    assert len(bins) == 10 and sum(b["count"] for b in bins) == 5
    assert bins[5]["count"] == 2 and bins[5]["observed"] == 0.5
    lo, hi = pl.wilson(50, 100)
    assert lo < 0.5 < hi


def test_feature_selection_drops_empty_and_late_features():
    df = synthetic_matrix(n_years=8)
    df["opt_empty"] = np.nan
    df["opt_late"] = np.where(df.index > len(df) * 0.8, 1.0, np.nan)
    df["opt_stale"] = np.where(df.index < len(df) - 5, 1.0, np.nan)
    meta = {"features": [{"id": f, "optional": False} for f in ["f0", "f1", "f2", "f3"]]
            + [{"id": f, "optional": True} for f in ["opt_empty", "opt_late", "opt_stale"]],
            "missing": {"opt_empty": "COT not loaded yet"}}
    used, report = select_features(df, meta)
    assert used == ["f0", "f1", "f2", "f3"]
    by = {r["id"]: r for r in report}
    assert by["opt_empty"]["reason"] == "COT not loaded yet"
    assert by["opt_late"]["reason"].startswith("coverage")
    assert by["opt_stale"]["reason"] == "missing on the latest date"


def test_end_to_end_train_and_infer_on_synthetic_signal():
    df = synthetic_matrix(n_years=11, signal=3.0, seed=1)
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        out = df.drop(columns=["year"]).copy()
        out["date"] = out["date"].dt.strftime("%Y-%m-%d")
        out.to_csv(dd / "features_gold.csv", index=False)
        (dd / "features_gold.meta.json").write_text(json.dumps(
            {"features": [{"id": f, "optional": False} for f in ["f0", "f1", "f2", "f3"]], "missing": {}}))
        res = pl.do_train("gold", dd, n_perm=20, fast=True)
        m = res["metrics"]
        assert m["summary"]["folds"] >= pl.MIN_TEST_YEARS
        assert all(f["purged"] == H for f in m["folds"])
        assert m["permutation"]["nPerm"] == 20
        assert res["metrics"]["gate"]["status"] in ("passed", "failed")
        # planted signal must be learnable out of sample
        assert m["summary"]["auc"] > 0.55
        assert res["importance"][0]["feature"] == "f0"
        pred = res["prediction"]
        assert 0 <= pred["pUp"] <= 1 and pred["date"] == out["date"].iloc[-1]
        inf = pl.do_infer("gold", dd)
        assert inf["prediction"]["pUp"] == pred["pUp"]


def test_no_signal_is_not_passed():
    df = synthetic_matrix(n_years=11, signal=0.0, seed=3)
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        out = df.drop(columns=["year"]).copy()
        out["date"] = out["date"].dt.strftime("%Y-%m-%d")
        out.to_csv(dd / "features_silver.csv", index=False)
        (dd / "features_silver.meta.json").write_text(json.dumps({"features": [], "missing": {}}))
        res = pl.do_train("silver", dd, n_perm=20, fast=True)
        assert res["metrics"]["gate"]["status"] != "passed"


def test_accepts_any_path_safe_asset_id():
    # Any universe asset id reaches the pipeline; only path-safe ids are accepted.
    for ok in ["gold", "silver", "bitcoin", "copper", "platinum", "palladium"]:
        assert pl.asset_id(ok) == ok
    for bad in ["../x", "Gold", "", "a b", "x" * 40]:
        try:
            pl.asset_id(bad)
        except Exception:  # noqa: BLE001
            continue
        raise AssertionError(f"accepted {bad!r}")


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"ok   {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {e!r}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)

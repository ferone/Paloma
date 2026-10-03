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
import device as dv  # noqa: E402
import models as md  # noqa: E402
import pipeline as pl  # noqa: E402
from features import H, MIN_OPTIONAL_ROWS, core_features, select_features, synthetic_matrix, trainable  # noqa: E402

try:
    import pytest
    cuda_only = pytest.mark.skipif(not dv.torch_cuda(), reason="CUDA unavailable")
    xgb_cuda_only = pytest.mark.skipif(not dv.xgb_cuda(), reason="XGBoost CUDA unavailable")
except ImportError:  # standalone run without pytest: unavailable-device tests become no-ops
    def cuda_only(f):
        return f if dv.torch_cuda() else (lambda: None)

    def xgb_cuda_only(f):
        return f if dv.xgb_cuda() else (lambda: None)


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


def test_family_selection_uses_training_data_only():
    data = _data(n_years=10, start="2010-01-01", signal=3.0, seed=2)
    ty = pl.test_years(data)[-1]
    train, test, _ = pl.purged_split(data, ty)
    # inner years come from the training window and never include the test year
    iy = pl.inner_years(train)
    assert len(iy) == pl.INNER_YEARS and max(iy) < ty
    fam, scores = pl.select_family(train, ["f0", "f1", "f2", "f3"], fast=True)
    assert fam in pl.FAMILIES and set(scores) == set(pl.FAMILIES)
    # scrambling the TEST year's labels cannot change the choice made for it
    scrambled = data.copy()
    mask = scrambled["year"] == ty
    scrambled.loc[mask, "y_up"] = 1 - scrambled.loc[mask, "y_up"]
    train2, _, _ = pl.purged_split(scrambled, ty)
    assert pl.select_family(train2, ["f0", "f1", "f2", "f3"], fast=True) == (fam, scores)
    # a linear planted signal: the linear family wins the inner comparison
    assert fam == "logit"


def test_walk_forward_baseline_matches_family():
    data = _data(n_years=9, start="2010-01-01", signal=3.0, seed=2)
    folds, _, _ = pl.walk_forward(data, ["f0", "f1", "f2", "f3"], fast=True)
    assert folds
    for f in folds:
        assert f["family"] in pl.FAMILIES
        if f["family"] == "logit":
            # naive base-rate comparator: a constant forecast ranks nothing
            assert f["baselineKind"] == "naive" and f["baselineAuc"] == 0.5
        else:
            assert f["baselineKind"] == "logistic"
    s = pl.summarize(folds, pd.DataFrame({"y": [], "p": []}))
    assert sum(s["familyCounts"].values()) == len(folds)
    g = pl.gate({**_summary(), "baselineKind": "naive"}, {"pValue": 0.001}, n_tests=6)
    assert next(c for c in g["checks"] if c["id"] == "baseline")["label"].startswith("Beats naive")


FEATS = ["f0", "f1", "f2", "f3"]


def test_permutation_statistic_is_the_reported_walk_forward_auc():
    data = _data(n_years=9, start="2010-01-01", signal=3.0, seed=2)
    folds, oos, _ = pl.walk_forward(data, FEATS, fast=True)
    summary = pl.summarize(folds, oos)
    perm = pl.permutation_test(data, FEATS, n_perm=8, fast=True)
    # same quantity, same splits, same family choices
    assert perm["realAuc"] == summary["auc"]
    assert perm["testYears"] == [f["testYear"] for f in folds]
    assert perm["foldFamilies"] == [f["family"] for f in folds]
    k = sum(1 for x in perm["nullAucs"] if x >= perm["realAuc"])
    assert perm["pValue"] == round((1 + k) / (1 + perm["nPerm"]), 6)


def test_permutation_p_is_one_sided():
    null = np.random.default_rng(0).normal(0.5, 0.02, 200)
    assert pl.permutation_p(0.45, null) > 0.5
    assert pl.permutation_p(0.60, null) == 1 / 201


def test_anti_predictive_model_gets_large_p():
    # The planted relation flips sign after the training history: every model
    # learns "f0 up -> up" and is then wrong in every test year (AUC < 0.5).
    data = _data(n_years=9, start="2010-01-01", signal=4.0, seed=5)
    flip = data["year"] >= 2010 + pl.MIN_TRAIN_YEARS
    data.loc[flip, "y_up"] = 1 - data.loc[flip, "y_up"]
    folds, oos, _ = pl.walk_forward(data, FEATS, fast=True)
    summary = pl.summarize(folds, oos)
    assert summary["auc"] < 0.5
    perm = pl.permutation_test(data, FEATS, n_perm=20, fast=True)
    assert perm["realAuc"] == summary["auc"]
    assert perm["pValue"] > 0.5


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
    assert by["opt_late"]["reason"].startswith("only") and by["opt_late"]["reason"].endswith(f"< {MIN_OPTIONAL_ROWS}")
    assert by["opt_stale"]["reason"] == "missing on the latest date"
    assert by["f0"]["core"] and not by["opt_late"]["core"]


def test_late_optional_feature_is_used_without_truncating_the_history():
    # An optional feed that starts halfway through is used (enough rows), and the
    # trainable rows still start where the CORE features start.
    df = synthetic_matrix(n_years=10)
    df["opt_mid"] = np.where(df.index >= len(df) // 2, df["f1"], np.nan)
    meta = {"features": [{"id": f, "optional": False} for f in FEATS] + [{"id": "opt_mid", "optional": True}], "missing": {}}
    used, report = select_features(df, meta)
    assert used == FEATS + ["opt_mid"]
    data = trainable(df, used, core_features(df, meta))
    assert data["date"].min() == df["date"].min()
    assert data["opt_mid"].isna().sum() == len(df) // 2
    # both families score every test row despite the NaNs (trees natively, logit by imputation)
    folds, oos, _ = pl.walk_forward(data, used, fast=True)
    assert folds and oos["p"].notna().all()
    stat, fams = pl.wf_statistic(data, used, pl.fold_plan(data), data["y_up"].to_numpy(), fast=True)
    assert abs(stat - pl.oos_mean_auc(oos)) < 1e-12


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


def test_gate_recency_rule():
    perm_ok = {"pValue": 0.001}
    # strong overall, but the last two test years are below chance -> fails on recency only
    g = pl.gate(_summary(recentAuc=0.488, recentYears=[2025, 2026]), perm_ok)
    assert g["status"] == "failed"
    assert any("edge has faded" in r for r in g["reasons"]) and len(g["reasons"]) == 1
    assert any(c["id"] == "recent" and not c["ok"] for c in g["checks"])
    # recent years at or above chance -> passes
    assert pl.gate(_summary(recentAuc=0.50, recentYears=[2025, 2026]), perm_ok)["status"] == "passed"
    # runs summarised before the rule (no recentAuc) are gated as before
    assert all(c["id"] != "recent" for c in pl.gate(_summary(), perm_ok)["checks"])


def test_recent_auc_uses_the_last_two_test_years():
    folds = [{"testYear": y, "auc": a} for y, a in [(2022, 0.70), (2025, 0.478), (2024, 0.71), (2026, 0.498)]]
    r = pl.recent_auc(folds)
    assert r["recentYears"] == [2025, 2026]
    assert abs(r["recentAuc"] - 0.488) < 1e-4


# ── engine, models and devices ───────────────────────────────────────────────

def _xy(n_years=9, seed=2, signal=3.0, nan_share=0.0):
    data = _data(n_years=n_years, start="2010-01-01", signal=signal, seed=seed)
    X = data[FEATS].to_numpy(dtype=float)
    if nan_share:
        rng = np.random.default_rng(seed)
        X[rng.random(X.shape) < nan_share] = np.nan
        X[: len(X) // 3, 3] = np.nan  # a late-starting column
    return data, X, data["y_up"].to_numpy(dtype=float)


def _sk_logit():
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    return make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                         LogisticRegression(C=0.1, tol=1e-12, max_iter=10000))


def test_torch_logit_matches_sklearn_logistic_regression():
    for nan_share in (0.0, 0.05):
        _, X, y = _xy(nan_share=nan_share)
        tr, te = slice(0, 1500), slice(1500, None)
        ps = _sk_logit().fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        pt = md.TorchLogit(device="cpu").fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        assert np.abs(ps - pt).max() < 1e-6, nan_share
        assert abs(pl.safe_auc(y[te], ps) - pl.safe_auc(y[te], pt)) < 1e-3
    # and against the sklearn default solver tolerance the AUC still agrees within 1e-3
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    _, X, y = _xy()
    pd_ = make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000)).fit(X[:1500], y[:1500]).predict_proba(X[1500:])[:, 1]
    pt = md.TorchLogit().fit(X[:1500], y[:1500]).predict_proba(X[1500:])[:, 1]
    assert abs(pl.safe_auc(y[1500:], pd_) - pl.safe_auc(y[1500:], pt)) < 1e-3


def test_logit_prep_is_fitted_on_training_rows_only():
    _, X, _ = _xy(nan_share=0.05)
    prep = md.LogitPrep().fit(X[:1000])
    Z1 = prep.transform(X[1000:1100])
    X2 = X.copy()
    X2[1000:] = X2[1000:] * 50 + 7  # change everything after the training rows
    prep2 = md.LogitPrep().fit(X2[:1000])
    assert np.allclose(prep2.median_, prep.median_) and np.allclose(prep2.mean_, prep.mean_)
    assert Z1.shape[1] == X.shape[1] + len(prep.indicators_)
    assert 3 in prep.indicators_.tolist()


def test_batched_logit_equals_per_shift_logit():
    _, X, y = _xy(nan_share=0.03)
    shifts = [300, 450, 777, 1000, 1500]
    Y = np.column_stack([y] + [np.roll(y, s) for s in shifts])
    P = md.logit_fit_predict(X[:1600], Y[:1600], X[1600:], "cpu")
    for j in range(Y.shape[1]):
        pj = md.logit_fit_predict(X[:1600], Y[:1600, j:j + 1], X[1600:], "cpu")[:, 0]
        assert np.abs(P[:, j] - pj).max() < 1e-9


@cuda_only
def test_logit_cuda_matches_cpu_batched():
    _, X, y = _xy(nan_share=0.03)
    Y = np.column_stack([np.roll(y, s) for s in range(300, 2300, 50)])
    pc = md.logit_fit_predict(X[:1600], Y[:1600], X[1600:], "cpu")
    pg = md.logit_fit_predict(X[:1600], Y[:1600], X[1600:], "cuda")
    assert np.abs(pc - pg).max() < 1e-6
    a_c, a_g = md.batched_auc(Y[1600:], pc), md.batched_auc(Y[1600:], pg)
    assert np.nanmax(np.abs(a_c - a_g)) < 1e-4


def test_gb_parallel_batches_equal_single_fits():
    _, X, y = _xy(nan_share=0.03)
    Y = np.column_stack([np.roll(y, s) for s in (0, 400, 900, 1300)])
    P = md.gb_fit_predict(X[:1600], Y[:1600], X[1600:], "cpu", fast=True, workers=3)
    for j in range(Y.shape[1]):
        pj = md.XgbModel(device="cpu", fast=True, nthread=1).fit(X[:1600], Y[:1600, j]).predict_proba(X[1600:])[:, 1]
        assert np.abs(P[:, j] - pj).max() < 1e-7


@xgb_cuda_only
def test_xgboost_cuda_close_to_cpu():
    # GPU and CPU histogram sketches differ slightly, so trees are not bit-identical;
    # the predictions must still agree closely (one run always uses ONE device).
    _, X, y = _xy(nan_share=0.03)
    pc = md.XgbModel(device="cpu", nthread=1).fit(X[:1600], y[:1600]).predict_proba(X[1600:])[:, 1]
    pg = md.XgbModel(device="cuda").fit(X[:1600], y[:1600]).predict_proba(X[1600:])[:, 1]
    assert np.corrcoef(pc, pg)[0, 1] > 0.98
    assert np.abs(pc - pg).mean() < 0.03
    assert abs(pl.safe_auc(y[1600:], pc) - pl.safe_auc(y[1600:], pg)) < 0.02


def test_batched_auc_equals_sklearn_with_ties():
    from sklearn.metrics import roc_auc_score
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, size=(300, 5))
    p = np.round(rng.random((300, 5)), 1)  # many ties
    a = md.batched_auc(y, p)
    for j in range(5):
        assert abs(a[j] - roc_auc_score(y[:, j], p[:, j])) < 1e-12
    assert np.isnan(md.batched_auc(np.ones(10), rng.random(10))[0])


def _reference_statistic(data, feats, plan, y):
    """The pre-engine per-fold loop (select the family by an inner walk-forward
    on each training window, fit, score), used to prove the deduplicated,
    batched engine computes exactly the same procedure."""
    ys = pd.Series(y, index=data.index)
    aucs, fams = [], []
    for _, train, test, _ in plan:
        t = train.assign(y_up=ys.loc[train.index].to_numpy())
        scores = {f: [] for f in pl.FAMILIES}
        for iy in pl.inner_years(t):
            itr, ite, _ = pl.purged_split(t, iy)
            ytr, yte = itr["y_up"].to_numpy(), ite["y_up"].to_numpy()
            if len(itr) < pl.MIN_INNER_TRAIN or len(np.unique(ytr)) < 2 or len(np.unique(yte)) < 2:
                continue
            for fam in pl.FAMILIES:
                m = pl.make_family(fam, True, "cpu", nthread=1).fit(itr[feats], ytr)
                scores[fam].append(pl.safe_auc(yte, m.predict_proba(ite[feats])[:, 1]))
        mean = {f: (np.mean(v) if v else None) for f, v in scores.items()}
        fam = "gb" if mean["gb"] is not None and mean["logit"] is not None and mean["gb"] > mean["logit"] else "logit"
        p = pl.make_family(fam, True, "cpu", nthread=1).fit(train[feats], t["y_up"].to_numpy()).predict_proba(test[feats])[:, 1]
        aucs.append(pl.safe_auc(ys.loc[test.index].to_numpy().astype(int), p))
        fams.append(fam)
    return pl.mean_fold_auc(aucs), fams


def test_engine_equals_the_per_fold_procedure_for_every_label_column():
    data = _data(n_years=10, start="2010-01-01", signal=1.5, seed=4)
    plan = pl.fold_plan(data)
    y = data["y_up"].to_numpy(dtype=float)
    Y = np.column_stack([y, np.roll(y, 300), np.roll(y, 1100)])
    stats, fams = pl.wf_statistics(data, FEATS, plan, Y, fast=True)
    for j in range(Y.shape[1]):
        ref_stat, ref_fams = _reference_statistic(data, FEATS, plan, Y[:, j])
        assert abs(stats[j] - ref_stat) < 1e-9, j
        assert fams[j] == ref_fams, j


def test_cutoff_split_equals_purged_split_on_the_whole_history():
    data = _data(n_years=12, start="2001-01-01")
    years = data["year"].to_numpy()
    for ty in pl.test_years(data):
        train, test, purged = pl.purged_split(data, ty)
        end, pred = pl.cutoff_split(years, ty)
        assert end == len(train) and purged == H
        assert (data.index[pred] == test.index).all()
        # the 20-day label overlap is dropped: the last training label ends before the test year
        assert end + H <= pred[0]


def test_device_resolution(monkeypatch):
    assert dv.requested("CPU") == "cpu" and dv.requested("bogus") == "auto"
    r = dv.resolve("cpu", lambda: (_ for _ in ()).throw(AssertionError("no benchmark in cpu mode")))
    assert r["devices"] == {"gb": "cpu", "logit": "cpu"} and r["benchmark"] is None
    monkeypatch.setattr(dv, "family_cuda", lambda f: True)
    r = dv.resolve("auto", lambda: {"gb": {"cpu": 1.0, "cuda": 3.0}, "logit": {"cpu": 2.0, "cuda": 0.5}})
    assert r["devices"] == {"gb": "cpu", "logit": "cuda"}
    assert r["benchmark"]["logit"]["cuda"] == 0.5
    monkeypatch.setattr(dv, "family_cuda", lambda f: False)
    r = dv.resolve("auto", lambda: (_ for _ in ()).throw(AssertionError("no benchmark without CUDA")))
    assert r["devices"] == {"gb": "cpu", "logit": "cpu"} and "CUDA unavailable" in r["notes"][0]
    r = dv.resolve("cuda")
    assert r["devices"] == {"gb": "cpu", "logit": "cpu"} and len(r["notes"]) == 2


def test_train_records_devices_span_timings_and_oos_series():
    df = synthetic_matrix(n_years=11, signal=3.0, seed=1)
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        out = df.drop(columns=["year"]).copy()
        out["date"] = out["date"].dt.strftime("%Y-%m-%d")
        out.to_csv(dd / "features_gold.csv", index=False)
        (dd / "features_gold.meta.json").write_text(json.dumps(
            {"features": [{"id": f, "optional": False} for f in FEATS], "missing": {}}))
        res = pl.do_train("gold", dd, n_perm=10, fast=True, device="cpu")
        m = res["metrics"]
        c = m["compute"]
        assert c["requested"] == "cpu" and c["devices"] == {"gb": "cpu", "logit": "cpu"}
        assert c["timings"]["wallSec"] >= c["timings"]["permutationSec"] > 0
        assert set(c["timings"]["permutationFamilySec"]) == {"gb", "logit"}
        assert m["span"]["from"] == m["dataFrom"] and m["span"]["rows"] == m["nRows"]
        assert m["span"]["testFrom"] == m["folds"][0]["testYear"]
        o = m["oos"]
        assert len(o["date"]) == len(o["p"]) == len(o["y"]) == len(o["testYear"]) == m["span"]["oosRows"]
        assert o["testYear"][0] == m["folds"][0]["testYear"] and int(o["date"][0][:4]) == o["testYear"][0]
        assert abs(pl.safe_auc(np.array(o["y"]), np.array(o["p"])) - m["summary"]["pooledAuc"]) < 2e-3
        inf = pl.do_infer("gold", dd, device="cpu")
        assert inf["prediction"]["pUp"] == res["prediction"]["pUp"] and inf["devices"] == {"gb": "cpu", "logit": "cpu"}


def test_oos_series_downsamples_only_when_large():
    oos = pd.DataFrame({"date": pd.bdate_range("2010-01-01", periods=100), "p": 0.5, "y": 1, "testYear": 2010})
    assert pl.oos_series(oos)["step"] == 1 and len(pl.oos_series(oos)["date"]) == 100
    s = pl.oos_series(oos, max_points=30)
    assert s["step"] == 4 and len(s["date"]) == 25


if __name__ == "__main__":
    class _MP:  # minimal monkeypatch for the standalone runner
        def __init__(self):
            self.undo = []

        def setattr(self, obj, name, value):
            self.undo.append((obj, name, getattr(obj, name)))
            setattr(obj, name, value)

    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        mp = _MP()
        try:
            t(mp) if t.__code__.co_argcount else t()
            print(f"ok   {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {e!r}")
        finally:
            for obj, name, value in reversed(mp.undo):
                setattr(obj, name, value)
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


def test_device_benchmark_cache(tmp_path):
    calls = []

    def bench():
        calls.append(1)
        return {"gb": {"cpu": 1.0, "cuda": 2.0}, "logit": {"cpu": 2.0, "cuda": 0.1}}

    f = tmp_path / "device-benchmark.json"
    extra = {"rows": 6000, "features": 31, "nPerm": 480, "fast": False}
    b1, reused1 = dv.cached_benchmark(bench, f, extra)
    b2, reused2 = dv.cached_benchmark(bench, f, extra)
    assert not reused1 and reused2 and b1 == b2 and len(calls) == 1
    # a different problem size is a miss
    _, reused3 = dv.cached_benchmark(bench, f, {**extra, "rows": 2000})
    assert not reused3 and len(calls) == 2
    # no cache file -> always runs
    _, reused4 = dv.cached_benchmark(bench, None, extra)
    assert not reused4 and len(calls) == 3

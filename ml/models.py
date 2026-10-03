"""Model families for the per-asset direction model, on CPU or GPU.

gb     XGBoost histogram trees (binary:logistic), missing values handled
       natively. Fitted per label vector (one booster per permutation shift);
       on the CPU many fits run in parallel threads (XGBoost releases the GIL),
       on the GPU sequentially. The quantile sketch of a training window is
       built ONCE and reused for every label vector of that window (only the
       labels change between permutation shifts) - identical results, ~20% less
       work per fit.

logit  Standardized, L2-regularized logistic regression, equivalent to
       scikit-learn's LogisticRegression(C=0.1) on StandardScaler output:
           minimize  sum_i logloss_i + 1/(2C) * ||w||^2    (intercept unpenalized)
       Missing values: median imputation + one missing-indicator column per
       feature that has gaps in the training window (both fitted on the training
       rows only), like SimpleImputer(strategy="median", add_indicator=True).
       Solved by Newton's method with per-column step halving, BATCHED over
       label vectors: Y is an n x S matrix (one column per permutation shift),
       every column has its own coefficients, gradient and Hessian
       (S x k x k, built in chunks), and all S systems are solved together
       with one batched torch.linalg.solve. On the GPU the Hessian products run
       in float32 (consumer GPUs have ~1/64 float64 throughput) while the
       gradient, loss and solve stay float64: Newton's fixed point is set by
       the float64 gradient, so the optimum is float64-accurate.

SECURITY: fitted models are pickled only into the local data/ml directory.
"""
from __future__ import annotations

import warnings

import numpy as np
from sklearn.base import BaseEstimator, ClassifierMixin

import device as dv

SEED = 42
LOGIT_C = 0.1
GB_ROUNDS = 150
GB_ROUNDS_FAST = 60


# ── batched AUC (tie-aware, = sklearn roc_auc_score per column) ──────────────

def batched_auc(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    """AUC per column of `p` (m x S) against labels `y` (m x S, or m for all
    columns). NaN where a column has one class or NaN scores. Mann-Whitney
    with average ranks for ties, which is exactly roc_auc_score."""
    from scipy.stats import rankdata
    p = np.asarray(p, dtype=float)
    if p.ndim == 1:
        p = p[:, None]
    y = np.asarray(y, dtype=float)
    if y.ndim == 1:
        y = np.broadcast_to(y[:, None], p.shape)
    m = p.shape[0]
    out = np.full(p.shape[1], np.nan)
    if m == 0:
        return out
    n1 = y.sum(axis=0)
    n0 = m - n1
    ok = (n1 > 0) & (n0 > 0) & ~np.isnan(p).any(axis=0)
    if ok.any():
        r = rankdata(p[:, ok], axis=0)
        out[ok] = ((r * y[:, ok]).sum(axis=0) - n1[ok] * (n1[ok] + 1) / 2) / (n1[ok] * n0[ok])
    return out


# ── logistic family ──────────────────────────────────────────────────────────

class LogitPrep:
    """Median imputation + missing indicators + standardization, fitted on the
    training rows only (no look at the rows being predicted)."""

    def fit(self, X: np.ndarray) -> "LogitPrep":
        X = np.asarray(X, dtype=np.float64)
        miss = np.isnan(X)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN column -> nan median
            med = np.nanmedian(X, axis=0) if len(X) else np.zeros(X.shape[1])
        self.median_ = np.where(np.isnan(med), 0.0, med)
        self.indicators_ = np.where(miss.any(axis=0))[0]
        Z = self._impute(X)
        self.mean_ = Z.mean(axis=0) if len(Z) else np.zeros(Z.shape[1])
        sd = Z.std(axis=0) if len(Z) else np.ones(Z.shape[1])
        self.scale_ = np.where(sd > 0, sd, 1.0)  # constant columns: scale 1 (as StandardScaler)
        return self

    def _impute(self, X: np.ndarray) -> np.ndarray:
        miss = np.isnan(X)
        filled = np.where(miss, self.median_, X)
        return np.hstack([filled, miss[:, self.indicators_].astype(np.float64)])

    def transform(self, X: np.ndarray) -> np.ndarray:
        Z = self._impute(np.asarray(X, dtype=np.float64))
        return (Z - self.mean_) / self.scale_


def solve_logit(Z: np.ndarray, Y: np.ndarray, C: float = LOGIT_C, device: str = "cpu",
                tol: float = 1e-9, max_iter: int = 100) -> np.ndarray:
    """L2 logistic regression for every column of Y at once.

    Z: n x d standardized design (no intercept column), Y: n x S labels in {0,1}.
    Returns B: S x (d+1), coefficients then intercept, per label column."""
    import torch
    tdev = dv.torch_device(device)
    f64 = torch.float64
    hdt = torch.float32 if tdev.type == "cuda" else f64
    Z = np.asarray(Z, dtype=np.float64)
    Y = np.asarray(Y, dtype=np.float64)
    if Y.ndim == 1:
        Y = Y[:, None]
    n, d = Z.shape
    S = Y.shape[1]
    Zt = torch.cat([torch.as_tensor(Z, dtype=f64, device=tdev), torch.ones(n, 1, dtype=f64, device=tdev)], dim=1)
    Zh = Zt.to(hdt)
    Yt = torch.as_tensor(Y, dtype=f64, device=tdev)
    k = d + 1
    lam = torch.full((k,), 1.0 / C, dtype=f64, device=tdev)
    lam[-1] = 0.0
    B = torch.zeros(S, k, dtype=f64, device=tdev)
    eye_lam = torch.diag(lam)
    # chunk of label columns per Hessian product: keep the c x k x n intermediate <= ~256 MB
    chunk = max(1, int((1 << 28) // (max(1, k * n) * (4 if hdt == torch.float32 else 8))))

    def loss(Bm):
        eta = Zt @ Bm.T
        return (torch.nn.functional.softplus(eta) - Yt * eta).sum(dim=0) + 0.5 * (lam * Bm * Bm).sum(dim=1)

    cur = loss(B)
    for _ in range(max_iter):
        eta = Zt @ B.T
        p = torch.sigmoid(eta)
        G = (p - Yt).T @ Zt + lam * B                       # S x k (float64)
        W = (p * (1 - p)).to(hdt)                           # n x S
        H = torch.empty(S, k, k, dtype=f64, device=tdev)
        ZhT = Zh.T.unsqueeze(0)                             # 1 x k x n
        for s0 in range(0, S, chunk):
            s1 = min(S, s0 + chunk)
            H[s0:s1] = ((ZhT * W[:, s0:s1].T.unsqueeze(1)) @ Zh).to(f64)
        H += eye_lam
        step = torch.linalg.solve(H, G.unsqueeze(-1)).squeeze(-1)
        t = torch.ones(S, 1, dtype=f64, device=tdev)
        for _ in range(30):  # per-column step halving: never accept a higher loss
            Bn = B - t * step
            new = loss(Bn)
            bad = new > cur + 1e-12 * (1 + cur.abs())
            if not bool(bad.any()):
                break
            t = torch.where(bad.unsqueeze(1), t / 2, t)
        B, cur = Bn, new
        if float((t * step).abs().max()) < tol:
            break
    return B.cpu().numpy()


def logit_proba(Z: np.ndarray, B: np.ndarray, device: str = "cpu") -> np.ndarray:
    """P(y=1) for design Z (m x d) under coefficients B (S x (d+1)): m x S."""
    import torch
    tdev = dv.torch_device(device)
    Zt = torch.as_tensor(np.asarray(Z, dtype=np.float64), device=tdev)
    Bt = torch.as_tensor(np.asarray(B, dtype=np.float64), device=tdev)
    return torch.sigmoid(Zt @ Bt[:, :-1].T + Bt[:, -1]).cpu().numpy()


def logit_fit_predict(Xtr: np.ndarray, Ytr: np.ndarray, Xpr: np.ndarray, device: str = "cpu", C: float = LOGIT_C) -> np.ndarray:
    """Batched: fit one logistic model per column of Ytr (prep fitted on Xtr), predict Xpr -> m x S."""
    prep = LogitPrep().fit(Xtr)
    B = solve_logit(prep.transform(Xtr), Ytr, C, device)
    return logit_proba(prep.transform(Xpr), B, device)


class TorchLogit(ClassifierMixin, BaseEstimator):
    """Single-label estimator over the same solver (scikit-learn compatible:
    used for the saved model, permutation importance and inference)."""

    def __init__(self, C: float = LOGIT_C, device: str = "cpu"):
        self.C = C
        self.device = device

    def fit(self, X, y):
        X = np.asarray(X, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        self.prep_ = LogitPrep().fit(X)
        B = solve_logit(self.prep_.transform(X), y[:, None], self.C, self.device)[0]
        self.coef_, self.intercept_ = B[:-1], float(B[-1])
        self.classes_ = np.array([0, 1])
        self.n_features_in_ = X.shape[1]
        return self

    def predict_proba(self, X):
        Z = self.prep_.transform(np.asarray(X, dtype=np.float64))
        p = logit_proba(Z, np.append(self.coef_, self.intercept_)[None, :], self.device)[:, 0]
        return np.column_stack([1 - p, p])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] > 0.5).astype(int)


# ── gradient-boosting family (XGBoost) ───────────────────────────────────────

def xgb_params(device: str, nthread: int, regression: bool = False) -> dict:
    """Comparable to the former HistGradientBoostingClassifier(depth 3, lr 0.05):
    min_child_weight 5 ~ its min_samples_leaf 20 at p(1-p) = 0.25."""
    p = {
        "objective": "reg:squarederror" if regression else "binary:logistic",
        "tree_method": "hist",
        "device": "cuda" if device == "cuda" and dv.xgb_cuda() else "cpu",
        "max_depth": 3,
        "eta": 0.05,
        "nthread": max(1, int(nthread)),
        "seed": SEED,
        "verbosity": 0,
    }
    if regression:
        p["subsample"] = 0.8  # as the former GradientBoostingRegressor
    else:
        p["min_child_weight"] = 5
    return p


def gb_rounds(fast: bool) -> int:
    return GB_ROUNDS_FAST if fast else GB_ROUNDS


def _xgb_predict(booster, X: np.ndarray) -> np.ndarray:
    import xgboost as xgb
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return booster.predict(xgb.DMatrix(np.asarray(X, dtype=np.float32), missing=np.nan))


def gb_fit_predict_columns(Xtr: np.ndarray, Ytr: np.ndarray, cols, Xpr: np.ndarray, device: str, fast: bool, nthread: int = 1) -> np.ndarray:
    """Fit one booster per label column in `cols` on a SHARED quantile sketch
    of Xtr; returns m x len(cols) predictions (NaN for a one-class column)."""
    import xgboost as xgb
    params = xgb_params(device, nthread)
    out = np.full((len(Xpr), len(cols)), np.nan)
    dm = None
    for j, c in enumerate(cols):
        y = Ytr[:, c]
        if np.unique(y).size < 2:
            continue
        if dm is None:
            dm = xgb.QuantileDMatrix(np.asarray(Xtr, dtype=np.float32), label=y, missing=np.nan, nthread=params["nthread"])
        else:
            dm.set_label(y)
        booster = xgb.train(params, dm, num_boost_round=gb_rounds(fast))
        out[:, j] = _xgb_predict(booster, Xpr)
    return out


def gb_run_tasks(tasks: list[tuple], device: str, fast: bool, workers: int = 1, on_progress=None) -> list[np.ndarray]:
    """Run gb fit/predict tasks (Xtr, Ytr, cols, Xpr) -> one m x len(cols) array
    each, in task order. Every fit is single-threaded (nthread=1), so results do
    not depend on how the tasks are scheduled. CPU: a pool of `workers` threads
    (XGBoost releases the GIL while training). GPU: sequential.
    `on_progress(done, total)` is called as tasks finish."""
    total = len(tasks)
    dev = "cuda" if device == "cuda" and dv.xgb_cuda() else "cpu"
    w = 1 if dev == "cuda" else max(1, min(int(workers), total or 1))
    if w == 1:
        out = []
        for i, (Xtr, Ytr, cols, Xpr) in enumerate(tasks):
            out.append(gb_fit_predict_columns(Xtr, Ytr, cols, Xpr, dev, fast, 1))
            if on_progress:
                on_progress(i + 1, total)
        return out
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out: list = [None] * total
    with ThreadPoolExecutor(max_workers=w) as ex:
        futs = {ex.submit(gb_fit_predict_columns, t[0], t[1], t[2], t[3], "cpu", fast, 1): i for i, t in enumerate(tasks)}
        for done, f in enumerate(as_completed(futs), start=1):
            out[futs[f]] = f.result()
            if on_progress and (done == total or done % max(1, total // 20) == 0):
                on_progress(done, total)
    return out


def gb_fit_predict(Xtr: np.ndarray, Ytr: np.ndarray, Xpr: np.ndarray, device: str, fast: bool, workers: int = 1) -> np.ndarray:
    """One booster per column of Ytr -> m x S (columns split across workers)."""
    Ytr = np.asarray(Ytr, dtype=np.float64)
    if Ytr.ndim == 1:
        Ytr = Ytr[:, None]
    S = Ytr.shape[1]
    w = 1 if device == "cuda" else max(1, min(int(workers), S))
    parts = [list(range(i, S, w)) for i in range(w)]
    out = np.full((len(Xpr), S), np.nan)
    for cols, res in zip(parts, gb_run_tasks([(Xtr, Ytr, cs, Xpr) for cs in parts], device, fast, w)):
        out[:, cols] = res
    return out


class XgbModel(ClassifierMixin, BaseEstimator):
    """Single-label XGBoost model on the same code path as the batched fits."""

    def __init__(self, device: str = "cpu", fast: bool = False, regression: bool = False, nthread: int = 0):
        self.device = device
        self.fast = fast
        self.regression = regression
        self.nthread = nthread

    def fit(self, X, y):
        import xgboost as xgb
        params = xgb_params(self.device, self.nthread or dv.cpu_workers(), self.regression)
        dm = xgb.QuantileDMatrix(np.asarray(X, dtype=np.float32), label=np.asarray(y, dtype=np.float64), missing=np.nan,
                                 nthread=params["nthread"])
        self.booster_ = xgb.train(params, dm, num_boost_round=gb_rounds(self.fast))
        self.classes_ = np.array([0, 1])
        self.n_features_in_ = np.asarray(X).shape[1]
        return self

    def set_device(self, device: str) -> "XgbModel":
        """Move a fitted (possibly unpickled) booster to `device` (CPU when CUDA is unavailable)."""
        self.device = "cuda" if device == "cuda" and dv.xgb_cuda() else "cpu"
        self.booster_.set_param({"device": self.device})
        return self

    def predict_proba(self, X):
        p = _xgb_predict(self.booster_, X)
        return np.column_stack([1 - p, p])

    def predict(self, X):
        p = _xgb_predict(self.booster_, X)
        return p if self.regression else (p > 0.5).astype(int)

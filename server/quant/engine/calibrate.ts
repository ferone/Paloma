/**
 * Calibration helpers (PURE — engine layer, no IO/Date). They NORMALIZE the
 * season/fund factor scales so the factor uses its (−1, 1) range instead of
 * pinning at ±1 (k too small) or sitting near 0 (k too large). The scale is read
 * from the empirical magnitude DISTRIBUTION of the factor's driver — |Δseason|
 * for `kSeason`, |F| for `kFund` — which is RETURN-AGNOSTIC.
 *
 * We deliberately do NOT pick the k that maximizes realized OOS P&L: with ~12
 * years of data that selection leaks and overfits, which is unsafe for an
 * automated trade decision. The sensitivity sweep (scripts/calibrate.ts) only
 * CONFIRMS that OOS behavior is a robust plateau around the normalized value; it
 * never argmax-tunes. See `Config.version` discipline when adopting new scales.
 */

/** Linear-interpolated quantiles of |values| (p in [0,1]). Non-finite/zero ignored. */
export function absQuantiles(values: number[], ps: number[]): number[] {
  const xs = values
    .map(Math.abs)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (xs.length === 0) return ps.map(() => 0);
  return ps.map((p) => {
    const idx = Math.min(xs.length - 1, Math.max(0, p * (xs.length - 1)));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
  });
}

/**
 * Robust normalization scale = the p-th percentile of |values| (default 0.8). A
 * high percentile means the factor saturates (|factor| = 1) only on the top
 * ~(1 − p) most extreme observations and is informative elsewhere. Degenerate
 * input → 1 (the neutral default, identical to the uncalibrated behavior).
 */
export function calibrateScale(values: number[], percentile = 0.8): number {
  const [q] = absQuantiles(values, [percentile]);
  return q > 0 ? Number(q.toFixed(6)) : 1;
}

/** Fraction of |values| that would SATURATE the factor at ±1 for a given scale k. */
export function saturationRate(values: number[], k: number): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0 || k <= 0) return 0;
  const n = xs.filter((v) => Math.abs(v) >= k).length;
  return Number((n / xs.length).toFixed(4));
}

/**
 * Ornstein–Uhlenbeck structure of a spread, estimated as a discrete AR(1) by
 * OLS on the trailing window of an ALREADY as-of-gated series:
 *
 *   x_{t+1} = a + b·x_t + ε   ⇒   theta = −ln(b) per day,
 *   halfLife = ln(2)/theta,   mu = a/(1−b),   sigmaEq = sd(ε)/√(1−b²).
 *
 * EngineQT uses the fit three ways (all gates/inputs, never score multipliers):
 *  - `ouTradability`: a spread with no reversion structure (b ≥ 1) or a half-life
 *    outside a-priori bounds is NOT a mean-reversion trade — conservative blocker.
 *  - `adaptiveLookback`: the z lookback scales with the spread's OWN half-life
 *    instead of one global N.
 *  - `expectedReversionDays`: how long |z| should take to decay to the target —
 *    surfaced on the ticket next to the horizon H.
 *
 * PURE math (no IO/Date). Only 2 parameters are fit, by OLS, never to P&L; the
 * half-life bounds are documented config constants (QtParamsSchema).
 */

export interface OuFit {
  /** Observations used (≤ window). */
  n: number;
  /** AR(1) slope + intercept (OLS). */
  b: number;
  a: number;
  /** Long-run mean a/(1−b); NaN when b ≥ 1 (no fixed point). */
  mu: number;
  /** Reversion speed per day −ln(b); NaN when b ∉ (0, 1). */
  theta: number;
  /** ln(2)/theta; Infinity when not mean-reverting. */
  halfLife: number;
  /** Equilibrium std of the process sd(ε)/√(1−b²); NaN when b ≥ 1. */
  sigmaEq: number;
  /** OLS R² of the AR(1) regression. */
  r2: number;
}

/** Fit on the trailing `window` values. Null when fewer than `minObs` points. */
export function ouFit(values: number[], window: number, minObs: number): OuFit | null {
  const xs = values.slice(-window);
  if (xs.length < minObs) return null;
  // OLS of y = x_{t+1} on x = x_t.
  const n = xs.length - 1;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += xs[i + 1];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = xs[i + 1] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null; // constant series — no regression
  const b = sxy / sxx;
  const a = my - b * mx;
  // Residual variance + R².
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = xs[i + 1] - (a + b * xs[i]);
    sse += e * e;
  }
  const r2 = syy === 0 ? 1 : 1 - sse / syy;
  const reverting = b > 0 && b < 1;
  const theta = reverting ? -Math.log(b) : NaN;
  const halfLife = reverting ? Math.LN2 / -Math.log(b) : Infinity;
  const mu = b < 1 ? a / (1 - b) : NaN;
  const sigmaEq = reverting ? Math.sqrt(sse / Math.max(1, n - 2)) / Math.sqrt(1 - b * b) : NaN;
  return { n: xs.length, b, a, mu, theta, halfLife, sigmaEq, r2 };
}

export interface OuTradability {
  tradable: boolean;
  halfLife: number | null;
  reason: string;
}

/**
 * Gate: tradable iff a fit exists, 0 < b < 1, and the half-life sits inside the
 * a-priori bounds. Insufficient data ⇒ NOT tradable ("don't manufacture
 * reversion from thin data" — mirrors the regime filter's stance).
 */
export function ouTradability(fit: OuFit | null, bounds: { min: number; max: number }): OuTradability {
  if (!fit) return { tradable: false, halfLife: null, reason: "insufficient data for an OU fit" };
  if (!(fit.b > 0 && fit.b < 1) || !Number.isFinite(fit.halfLife)) {
    return { tradable: false, halfLife: null, reason: "no mean-reversion structure (AR(1) b ≥ 1 — trending/random walk)" };
  }
  if (fit.halfLife < bounds.min) {
    return {
      tradable: false,
      halfLife: fit.halfLife,
      reason: `half-life ${fit.halfLife.toFixed(1)}d < ${bounds.min}d — microstructure noise, not a tradable reversion`,
    };
  }
  if (fit.halfLife > bounds.max) {
    return {
      tradable: false,
      halfLife: fit.halfLife,
      reason: `half-life ${fit.halfLife.toFixed(1)}d > ${bounds.max}d — too slow to converge within the horizon`,
    };
  }
  return { tradable: true, halfLife: fit.halfLife, reason: `half-life ${fit.halfLife.toFixed(1)}d within [${bounds.min}, ${bounds.max}]d` };
}

/** N_eff = clamp(round(k·halfLife), nMin, nMax); `fallback` (cfg.N) when unfittable. */
export function adaptiveLookback(fit: OuFit | null, k: number, nMin: number, nMax: number, fallback: number): number {
  if (!fit || !Number.isFinite(fit.halfLife)) return fallback;
  return Math.min(nMax, Math.max(nMin, Math.round(k * fit.halfLife)));
}

/**
 * Expected days for |z| to decay to `targetZ` (default 0.5) under the fitted OU:
 * ln(|z|/targetZ)/theta. Null when not reverting or already inside the target.
 */
export function expectedReversionDays(z: number, fit: OuFit | null, targetZ = 0.5): number | null {
  if (!fit || !Number.isFinite(fit.theta) || Number.isNaN(fit.theta)) return null;
  const absZ = Math.abs(z);
  if (absZ <= targetZ) return null;
  return Math.log(absZ / targetZ) / fit.theta;
}

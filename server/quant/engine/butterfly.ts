import { rollingZScore } from "./zscore.js";

/**
 * Butterfly curvature on a contango-aware curve (EngineMR — Mikel's method #1).
 *
 * A 3-month butterfly compares near/middle/far. On a clean carry (contango) curve
 * the forward price is near-linear, so the MIDDLE month sits ~on the straight line
 * between the wings and the "bow" is ~0. Curvature measures how far the middle bows
 * off that line:
 *
 *   curvature = mid − (near + far) / 2
 *
 * A registry butterfly instrument uses weights `[+1, −2, +1]`, so its combined
 * spread value is `near − 2·mid + far = −2·curvature`. That means a butterfly
 * instrument feeds the SAME pure convergence engine and its z-score already IS the
 * curvature-reversion signal — this module only makes the geometry explicit + adds
 * a look-ahead-safe reversion read. PURE.
 */

/** The bow of the middle month off the near–far line. >0 = bulge up, <0 = sag. */
export function flyCurvature(near: number, mid: number, far: number): number {
  return mid - (near + far) / 2;
}

/** Recover curvature from a `[+1,−2,+1]` butterfly spread value (= −2·curvature). */
export function curvatureFromSpread(butterflySpread: number): number {
  return -butterflySpread / 2;
}

/** Per-date curvature from aligned near/mid/far closes (arrays must be equal length). */
export function flyCurvatureSeries(near: number[], mid: number[], far: number[]): number[] {
  const n = Math.min(near.length, mid.length, far.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(flyCurvature(near[i], mid[i], far[i]));
  return out;
}

export interface FlyReversion {
  curvature: number; // latest bow
  z: number; // how stretched the bow is vs its own rolling history
  /** Mean-reversion side for the MIDDLE month: fade the bow (z>0 ⇒ mid rich ⇒ short mid). */
  direction: "long-mid" | "short-mid" | "flat";
}

/**
 * Look-ahead-safe reversion read on a curvature series: the rolling z of the bow.
 * The caller passes only curvatures ≤ asOf. Null when there's insufficient history.
 * Fades the bow back to centre (the contango-reversion thesis). PURE.
 */
export function flyReversion(curvature: number[], n = 60): FlyReversion | null {
  if (curvature.length === 0) return null;
  const z = rollingZScore(curvature, n);
  if (Number.isNaN(z)) return null;
  const last = curvature[curvature.length - 1];
  const direction = z > 0.5 ? "short-mid" : z < -0.5 ? "long-mid" : "flat";
  return { curvature: last, z, direction };
}

import { calibrateScale } from "./calibrate.js";
import { clamp } from "./math.js";

/**
 * Volatility-regime factor (config v3). The convergence engine fades stretched
 * spreads expecting mean-reversion — which is RELIABLE in a calm regime and
 * TREACHEROUS in a volatility blow-up. So this factor dampens the score when the
 * spread's own volatility is elevated vs its typical level, and gives a mild lift
 * when it is unusually calm. It is a CONFIDENCE dampener, never a direction.
 *
 * Volatility = stdev of ABSOLUTE first-differences (not % returns) so it is robust
 * for zero-crossing crush/calendar/inter/seasonal spreads alike; it is normalized
 * by the instrument's OWN typical level (p80 of its rolling HV) so the factor is
 * scale-free across the universe — the same discipline as kSeason/kFund (p80
 * normalization, NEVER argmax to P&L). PURE + look-ahead-safe: the caller passes
 * only `spreads ≤ asOf`, and the trailing-lookback scale uses only that history.
 */

/** Stdev of absolute first-differences over [endExclusive-window, endExclusive). */
function hvWindow(spreads: number[], endExclusive: number, window: number): number | null {
  const lo = endExclusive - window;
  if (lo < 1 || endExclusive > spreads.length) return null;
  const diffs: number[] = [];
  for (let i = lo; i < endExclusive; i++) diffs.push(spreads[i] - spreads[i - 1]);
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const v = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length;
  return Math.sqrt(v);
}

/** Current spread volatility: stdev of |Δspread| over the last `window` diffs. PURE. */
export function spreadHv(spreads: number[], window = 20): number | null {
  return hvWindow(spreads, spreads.length, window);
}

/**
 * The instrument's TYPICAL volatility — p80 of its rolling HV over a trailing
 * `lookback` (default ~1y), so the scale is recent-regime relevant and the cost is
 * bounded (O(lookback·window)) even when called per-date in a walk-forward. PURE.
 */
export function spreadVolScale(spreads: number[], window = 20, lookback = 252): number {
  const n = spreads.length;
  const hvs: number[] = [];
  for (let end = Math.max(window + 1, n - lookback); end <= n; end++) {
    const h = hvWindow(spreads, end, window);
    if (h != null && h > 0) hvs.push(h);
  }
  return calibrateScale(hvs);
}

/**
 * Volatility-regime factor ∈ [−1, 1]. Centered at the typical (p80) level: calm ⇒
 * positive (lift), blow-up ⇒ negative (dampen). `kVol` (default 1) scales
 * sensitivity. 0 when there's not enough history. PURE.
 */
export function volFactor(spreads: number[], kVol = 1, window = 20): number {
  const cur = spreadHv(spreads, window);
  if (cur == null) return 0;
  const scale = spreadVolScale(spreads, window);
  if (!(scale > 0)) return 0;
  return clamp((scale - cur) / (scale * (kVol || 1)), -1, 1);
}

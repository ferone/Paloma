/**
 * Pure numeric primitives for the signal engine (SPEC §4).
 *
 * The engine layer is PURE: no IO, no Date.now, no DB, no network. It may only
 * depend on `lib/types`. These helpers are deterministic functions of their
 * inputs, which is what makes look-ahead safety and backtest/live parity
 * structural rather than a matter of discipline.
 */

/** Clamp x to [min, max]. Used by season_factor / fund_factor (SPEC §4). */
export function clamp(x: number, min: number, max: number): number {
  if (Number.isNaN(x)) return NaN;
  return Math.min(max, Math.max(min, x));
}

/**
 * Convergence base score (SPEC §4.4):
 *   base = 100 / (1 + exp(-2·(|z| - 1.5)))
 * Worked examples: |z|=1.5 → 50, |z|=2 ≈ 73, |z|=3 ≈ 95. Symmetric in sign(z).
 */
export function baseScore(z: number): number {
  return 100 / (1 + Math.exp(-2 * (Math.abs(z) - 1.5)));
}

/**
 * Factor multiplier envelope (SPEC §4.4):
 *   mult = 0.5 + 0.7·(factor + 1)/2,  factor ∈ [-1, 1] → mult ∈ [0.5, 1.2]
 * Shared by seasonMult, fundMult, and (later) the gated forecastMult.
 */
export function factorMultiplier(factor: number): number {
  return 0.5 + (0.7 * (factor + 1)) / 2;
}

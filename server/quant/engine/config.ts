import type { Config } from "../types/index.js";

/**
 * Default engine configuration (SPEC §4). ALL thresholds are config, never
 * hard-coded in the math.
 *
 * v2 (calibrated): the season factor is now PER-INSTRUMENT self-normalized in
 * `scoreAsOf` (Δseason ÷ the instrument's own p80 |drift| scale), so `kSeason`
 * is a DIMENSIONLESS global multiplier — 1.0 saturates only the top ~20% of an
 * instrument's drift days, regardless of whether its spread is in cents or in
 * dollars (a single absolute `kSeason` could not fit a cents calendar AND a
 * $-crush whose Δseason is ~10³× larger). `kFund` = 0.789 is the p80 of |F|
 * across the universe (F is already a bounded, comparable index, so its scale is
 * GLOBAL). See `lib/engine/calibrate.ts` + `scripts/calibrate.ts`.
 */
export const DEFAULT_CONFIG: Config = {
  version: 3,
  N: 60,
  H: 20,
  kSeason: 1, // dimensionless multiplier of the per-instrument seasonal scale
  kFund: 0.789, // normalized: p80 of |F| across the universe
  kVol: 1, // v3: dimensionless sensitivity of the volatility-regime dampener (p80-normalized)
  tiers: { strong: 70, moderate: 45, watch: 25 },
  avoidThreshold: -0.25,
  costs: { commission: 0, bidAsk: 0, slippage: 0 },
};

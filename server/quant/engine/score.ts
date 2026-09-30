import type { AsOfView, Config, EngineId, SignalRow } from "../types/index.js";
import { rollingZScore } from "./zscore.js";
import { buildClimatology, dayOfYear, seasonalDrift, seasonalDriftScale, seasonFactor } from "./climatology.js";
import { currentFundamentalIndex, fundFactor } from "./fundamentals.js";
import { convergenceScore } from "./convergence.js";
import { volFactor } from "./volatility.js";
import { classifyTier } from "./tiers.js";

/**
 * Top-level engine entry: score a single spread as-of the view's date.
 *
 * PURE function of (AsOfView, Config) → SignalRow. The view is already
 * look-ahead-gated, so this composition inherits look-ahead safety for free.
 * Returns null when there is insufficient history for a z-score.
 *
 * `engine` is the selectable-engine tag: it is OMITTED from the row for the
 * default `"v3"` (so v3 output stays byte-identical) and only stamped for other
 * engines. The scoring MATH is identical across engines — engine behaviour is the
 * config (`cfg`) and the downstream plug-ins, never a branch inside this core.
 */
export function scoreAsOf(pairId: string, view: AsOfView, cfg: Config, engine: EngineId = "v3"): SignalRow | null {
  const prices = view.prices;
  if (prices.length === 0) return null;

  const spreads = prices.map((p) => p.spread);
  const last = prices[prices.length - 1];

  const z = rollingZScore(spreads, cfg.N);
  if (Number.isNaN(z)) return null; // insufficient lookback window

  const clim = buildClimatology(prices);
  const d = dayOfYear(last.date);
  const deltaSeason = seasonalDrift(clim, d, cfg.H);
  // Per-instrument self-normalization: divide Δseason by THIS instrument's own
  // typical drift scale (p80 of |drift| across its as-of climatology), so the
  // season factor is scale-free for any instrument (cents calendar or $-crush).
  // `cfg.kSeason` is the dimensionless global knob (default 1 = saturate the top ~20%).
  const sScale = seasonalDriftScale(clim, cfg.H) * cfg.kSeason;
  const sFactor = seasonFactor(z, deltaSeason, sScale);

  const F = currentFundamentalIndex(view.funds);
  const fFactor = fundFactor(z, F, cfg.kFund);

  // Volatility-regime dampener (v3): mean-reversion fades are less reliable in a
  // vol blow-up → vFactor < 0 dampens the score; calm → mild lift. Look-ahead-safe
  // (computed only from the gated `spreads`). `cfg.kVol` scales sensitivity.
  const vFactor = volFactor(spreads, cfg.kVol ?? 1);

  const { base, score } = convergenceScore(z, sFactor, fFactor, vFactor);
  const { tier, avoidOverride } = classifyTier(score, sFactor, fFactor, cfg);

  return {
    pairId,
    date: last.date,
    spread: last.spread,
    z,
    seasonFactor: sFactor,
    fundFactor: fFactor,
    volFactor: vFactor,
    base,
    score,
    tier,
    avoidOverride,
    configVersion: cfg.version,
    // Stamp the engine ONLY for non-default engines, so a v3 row has no `engine`
    // key at all (byte-identical to before this field existed).
    ...(engine !== "v3" ? { engine } : {}),
  };
}

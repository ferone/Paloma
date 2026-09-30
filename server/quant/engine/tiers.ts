import { Tier } from "../types/index.js";
import type { Config } from "../types/index.js";

/**
 * Tier classification + AVOID override (SPEC §4.4–4.5).
 *
 * Bands: STRONG ≥ 70 · MODERATE 45–70 · WATCH 25–45 · AVOID below.
 *
 * AVOID override: if `season_factor < avoidThreshold` AND `fund_factor <
 * avoidThreshold`, tag AVOID regardless of score — the deviation runs AGAINST
 * the calendar AND is fundamentally justified (exactly the trap to skip).
 */
export function classifyTier(
  score: number,
  seasonFactor: number,
  fundFactor: number,
  cfg: Config,
): { tier: Tier; avoidOverride: boolean } {
  if (seasonFactor < cfg.avoidThreshold && fundFactor < cfg.avoidThreshold) {
    return { tier: Tier.AVOID, avoidOverride: true };
  }
  if (score >= cfg.tiers.strong) return { tier: Tier.STRONG, avoidOverride: false };
  if (score >= cfg.tiers.moderate) return { tier: Tier.MODERATE, avoidOverride: false };
  if (score >= cfg.tiers.watch) return { tier: Tier.WATCH, avoidOverride: false };
  return { tier: Tier.AVOID, avoidOverride: false };
}

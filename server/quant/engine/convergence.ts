import { baseScore, factorMultiplier, clamp } from "./math.js";

export interface ConvergenceBreakdown {
  base: number;
  seasonMult: number;
  fundMult: number;
  volMult: number;
  score: number;
}

/**
 * Convergence score with transparent factor breakdown (SPEC §4.4; config v3 adds
 * the volatility-regime dampener):
 *   base       = 100 / (1 + exp(-2·(|z| - 1.5)))
 *   seasonMult = 0.5 + 0.7·(season_factor + 1)/2
 *   fundMult   = 0.5 + 0.7·(fund_factor   + 1)/2
 *   volMult    = clamp(1 + 0.4·vol_factor, 0.6, 1.1)   (CENTERED at 1: neutral vol is a
 *                no-op; a blow-up (vol_factor<0) dampens to ≤0.6; calm lifts to ≤1.1)
 *   score      = clamp(base · seasonMult · fundMult · volMult, 0, 100)
 *
 * volMult is deliberately NOT `factorMultiplier` (which centers neutral at 0.85 and
 * would deflate EVERY score): the vol dampener must leave the v2 calibration intact
 * when volatility is typical, and only bite in a genuine blow-up.
 */
export function convergenceScore(
  z: number,
  seasonFactor: number,
  fundFactor: number,
  volFactor = 0,
): ConvergenceBreakdown {
  const base = baseScore(z);
  const seasonMult = factorMultiplier(seasonFactor);
  const fundMult = factorMultiplier(fundFactor);
  const volMult = clamp(1 + 0.4 * volFactor, 0.6, 1.1);
  const score = clamp(base * seasonMult * fundMult * volMult, 0, 100);
  return { base, seasonMult, fundMult, volMult, score };
}

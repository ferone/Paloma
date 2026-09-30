import { clamp } from "./math.js";
import type { FundamentalRelease, FundamentalRef } from "../types/index.js";

/**
 * Forward-filled fundamentals index as of the view (SPEC §3): the value of the
 * most recent release by `effectiveDate`. The funds passed in are already
 * publication-gated by `features/buildAsOf`, so "most recent" cannot leak a
 * report published in the future. `value` is the signed normalized index
 * (positive = supports a WIDER spread). Returns 0 when no release is available.
 */
export function currentFundamentalIndex(funds: FundamentalRelease[]): number {
  if (funds.length === 0) return 0;
  let latest = funds[0];
  for (const f of funds) if (f.effectiveDate > latest.effectiveDate) latest = f;
  return latest.value;
}

/**
 * Fundamental justification factor (SPEC §4.3):
 *   fund_factor = −clamp(sign(z)·F_t/k_f, −1, 1).
 * Fundamentals CONFIRMING the deviation (same sign as z) push the factor
 * negative (the move is "justified" → score down); fundamentals CONTRADICTING
 * it push positive (unexplained mispricing → score up).
 */
export function fundFactor(z: number, F: number, kFund: number): number {
  return -clamp((Math.sign(z) * F) / kFund, -1, 1);
}

/**
 * EngineMR (#5): group an instrument's fundamental refs by impact HORIZON
 * (short / medium / long), an organising lens for the fundamentals panel. This is
 * TAGGING ONLY — it does NOT change `F` or `fundFactor` (per-commodity auto-tuning
 * would overfit thin samples). Untagged refs fall under "medium" by default. PURE.
 */
export function groupByHorizon(refs: FundamentalRef[]): Record<"short" | "medium" | "long", FundamentalRef[]> {
  const out: Record<"short" | "medium" | "long", FundamentalRef[]> = { short: [], medium: [], long: [] };
  for (const r of refs) out[r.horizon ?? "medium"].push(r);
  return out;
}

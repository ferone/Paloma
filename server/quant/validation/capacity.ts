/**
 * Capacity / liquidity estimate (P4). Answers "can you actually trade this edge
 * at size?" from the instrument's own volume history. PURE (types only).
 *
 * HONEST SCOPE: the only liquidity datum the store carries is summed leg volume
 * (a proxy for the spread's tradeable depth — the spread itself quotes its own,
 * usually thinner, book). So this reports real, measurable facts — median ADV, a
 * liquidity tier, and a CONSERVATIVE suggested max size (a small % of ADV) — and
 * deliberately does NOT fabricate a $ slippage figure, which would require real
 * bid/ask data we do not have. The participation cap is the standard execution
 * rule of thumb, surfaced as guidance, not a guarantee.
 */

export type LiquidityTier = "deep" | "moderate" | "thin" | "unknown";

export interface CapacityEstimate {
  medianAdv: number; // median recent daily (summed-leg) volume
  tier: LiquidityTier;
  /** Conservative tradeable size = participationCap × medianAdv, floored. */
  suggestedMaxContracts: number;
  participationCap: number; // the % of ADV used (default 0.5%)
  sampleDays: number;
  note: string;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param volumes recent daily summed-leg volumes (most-recent slice is fine)
 * @param lookback how many trailing days to median over (default 120)
 * @param participationCap fraction of ADV considered tradeable (default 0.005)
 */
export function capacityEstimate(
  volumes: number[],
  lookback = 120,
  participationCap = 0.005,
): CapacityEstimate {
  const recent = volumes.filter((v) => Number.isFinite(v) && v > 0).slice(-lookback);
  const medianAdv = Math.round(median(recent));
  let tier: LiquidityTier;
  if (recent.length === 0) tier = "unknown";
  else if (medianAdv >= 10_000) tier = "deep";
  else if (medianAdv >= 2_000) tier = "moderate";
  else tier = "thin";

  const suggestedMaxContracts = Math.max(0, Math.floor(medianAdv * participationCap));
  const note =
    tier === "unknown"
      ? "No volume history — capacity unknown."
      : tier === "thin"
        ? `Thin: ~${medianAdv.toLocaleString()} contracts/day (summed legs). Size carefully; the spread book is thinner than the legs.`
        : `${tier === "deep" ? "Deep" : "Moderate"}: ~${medianAdv.toLocaleString()} contracts/day (summed legs). Suggested max ~${suggestedMaxContracts.toLocaleString()} (${(participationCap * 100).toFixed(1)}% of ADV); leg volume overstates the spread's own depth.`;

  return { medianAdv, tier, suggestedMaxContracts, participationCap, sampleDays: recent.length, note };
}

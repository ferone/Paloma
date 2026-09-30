import type { AsOfView, PricePoint, FundamentalRelease } from "../types/index.js";

/**
 * Construct the as-of view for date `asOf` (ISO YYYY-MM-DD). This is THE
 * look-ahead gate (SPEC §3, §5):
 *  - prices are truncated to `date ≤ asOf`;
 *  - fundamentals are gated by PUBLICATION date (`pubTimestamp`), NOT
 *    `effectiveDate` — a report about period P that is published after `asOf`
 *    is invisible, even though its reference period may precede `asOf`.
 *
 * Daily granularity: a report published on the as-of date is included (the
 * engine runs post-settle, after the 3:00 PM ET USDA release). Sub-daily
 * precision is a P5 refinement once `asOf` carries a settlement timestamp.
 */
export function buildAsOf(
  asOf: string,
  prices: PricePoint[],
  funds: FundamentalRelease[],
): AsOfView {
  return {
    asOf,
    prices: prices.filter((p) => p.date <= asOf),
    funds: funds.filter((f) => f.pubTimestamp.slice(0, 10) <= asOf),
  };
}

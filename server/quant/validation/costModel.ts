/**
 * Realistic trading-cost model. All figures are DOLLARS per contract per
 * round-trip (enter + exit). Defaults are 0 (matches the engine config); callers
 * doing validation should pass realistic figures so the edge is tested net of
 * frictions. PURE.
 */
export interface CostConfig {
  commission: number; // $ per round-trip per contract (both sides)
  bidAsk: number; // $ paid crossing the spread (round-trip)
  slippage: number; // $ adverse fill vs. signal price (round-trip)
}

export const ZERO_COST: CostConfig = { commission: 0, bidAsk: 0, slippage: 0 };

/** A modest realistic default for CME livestock/grain spreads (~$35 round-trip). */
export const DEFAULT_COST: CostConfig = { commission: 5, bidAsk: 20, slippage: 10 };

export function roundTripCost(cfg: CostConfig): number {
  return cfg.commission + cfg.bidAsk + cfg.slippage;
}

/** Net a gross $ P&L for one round-trip trade. PURE. */
export function netPnl(grossPnl: number, cfg: CostConfig): number {
  return grossPnl - roundTripCost(cfg);
}

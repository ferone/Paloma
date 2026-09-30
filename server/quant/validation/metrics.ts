/**
 * Performance metrics for a sequence of per-trade $ P&Ls (e.g. one seasonal
 * trade per year). PURE — no annualization assumptions beyond per-trade ratios,
 * which suits low-frequency seasonal strategies. The Sharpe here is a per-trade
 * Sharpe (mean/std); for ~1 trade/year that is effectively annual.
 */
export interface PerfMetrics {
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  stdPnl: number;
  sharpe: number;
  profitFactor: number; // capped at 999 when no losses
  tStat: number;
  maxDrawdown: number; // most negative peak-to-trough of the equity curve ($)
}

const PF_CAP = 999;

export function equityCurve(pnls: number[]): number[] {
  const eq: number[] = [];
  let cum = 0;
  for (const p of pnls) {
    cum += p;
    eq.push(Number(cum.toFixed(4)));
  }
  return eq;
}

export function maxDrawdown(pnls: number[]): number {
  let peak = 0;
  let cum = 0;
  let maxDd = 0;
  for (const p of pnls) {
    cum += p;
    if (cum > peak) peak = cum;
    const dd = cum - peak;
    if (dd < maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(2));
}

export function performance(pnls: number[]): PerfMetrics {
  const trades = pnls.length;
  const wins = pnls.filter((p) => p > 0).length;
  const totalPnl = pnls.reduce((s, p) => s + p, 0);
  const avg = trades ? totalPnl / trades : 0;
  const variance =
    trades > 1 ? pnls.reduce((s, p) => s + (p - avg) ** 2, 0) / (trades - 1) : 0;
  const std = Math.sqrt(variance);
  const grossWin = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((s, p) => s + p, 0));

  return {
    trades,
    wins,
    winRate: trades ? Number((wins / trades).toFixed(4)) : 0,
    totalPnl: Number(totalPnl.toFixed(2)),
    avgPnl: Number(avg.toFixed(2)),
    stdPnl: Number(std.toFixed(2)),
    sharpe: std === 0 ? 0 : Number((avg / std).toFixed(4)),
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? PF_CAP : 0) : Number((grossWin / grossLoss).toFixed(4)),
    tStat: std === 0 ? 0 : Number((avg / (std / Math.sqrt(trades))).toFixed(4)),
    maxDrawdown: maxDrawdown(pnls),
  };
}

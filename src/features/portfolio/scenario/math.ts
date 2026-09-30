// Scenario (backtest) math, migrated from the legacy src/lib/portfolio-math.ts
// and usePortfolioSimulator. All returns are fractions (0.1 = 10%).

export interface Bar {
  date: string
  close: number
}

export interface Allocation {
  symbol: string
  /** Fraction of the initial amount (weights sum to 1). */
  weight: number
}

export type Rebalance = 'none' | 'monthly' | 'quarterly'

export interface ScenarioResult {
  data: { date: string; value: number }[]
  finalValue: number
  totalReturn: number
  cagr: number | null
  maxDrawdown: number
  volatility: number | null
  sharpe: number | null
  /** Dates common to every leg (the simulation calendar). */
  observations: number
}

export function cagr(start: number, end: number, years: number): number | null {
  if (years <= 0 || start <= 0) return null
  return (end / start) ** (1 / years) - 1
}

/** Most negative peak-to-trough decline (≤ 0). */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity
  let worst = 0
  for (const v of values) {
    peak = Math.max(peak, v)
    if (peak > 0) worst = Math.min(worst, v / peak - 1)
  }
  return worst
}

export function dailyReturns(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i++) out.push(values[i] / values[i - 1] - 1)
  return out
}

export function annualizedVolatility(returns: number[]): number | null {
  if (returns.length < 2) return null
  const m = returns.reduce((a, b) => a + b, 0) / returns.length
  const v = returns.reduce((s, r) => s + (r - m) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(v) * Math.sqrt(252)
}

export function sharpeRatio(returns: number[], riskFree = 0): number | null {
  const vol = annualizedVolatility(returns)
  if (!vol) return null
  const annual = (returns.reduce((a, b) => a + b, 0) / returns.length) * 252
  return (annual - riskFree) / vol
}

/**
 * Simulate `amount` invested on the first common date in `allocations`,
 * buy-and-hold or rebalanced to target weights at each month/quarter end.
 * Legs are aligned on dates present in every series (no look-ahead fill).
 */
export function simulate(
  amount: number,
  allocations: Allocation[],
  series: Record<string, Bar[]>,
  start: string,
  end: string,
  rebalance: Rebalance = 'none',
  riskFree = 0,
): ScenarioResult | null {
  if (allocations.length === 0) return null
  const maps = allocations.map((a) => new Map((series[a.symbol] ?? []).filter((b) => b.date >= start && b.date <= end && b.close > 0).map((b) => [b.date, b.close])))
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort()
  if (dates.length < 2) return null

  let units = allocations.map((a, i) => (amount * a.weight) / maps[i].get(dates[0])!)
  const data: { date: string; value: number }[] = []
  for (let t = 0; t < dates.length; t++) {
    const d = dates[t]
    const value = units.reduce((s, u, i) => s + u * maps[i].get(d)!, 0)
    data.push({ date: d, value })
    const next = dates[t + 1]
    const period = rebalance === 'monthly' ? 7 : 0
    const boundary =
      next &&
      ((rebalance === 'monthly' && next.slice(0, period) !== d.slice(0, period)) ||
        (rebalance === 'quarterly' && Math.floor((Number(next.slice(5, 7)) - 1) / 3) !== Math.floor((Number(d.slice(5, 7)) - 1) / 3)))
    if (boundary) units = allocations.map((a, i) => (value * a.weight) / maps[i].get(d)!)
  }

  const values = data.map((p) => p.value)
  const finalValue = values[values.length - 1]
  const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 86_400_000)
  const rets = dailyReturns(values)
  return {
    data,
    finalValue,
    totalReturn: finalValue / amount - 1,
    cagr: cagr(amount, finalValue, years),
    maxDrawdown: maxDrawdown(values),
    volatility: annualizedVolatility(rets),
    sharpe: sharpeRatio(rets, riskFree),
    observations: dates.length,
  }
}

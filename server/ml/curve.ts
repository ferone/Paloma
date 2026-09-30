import type { ContractBar, ContractRow } from '../db/shared-repo.js'
import type { CurvePoint } from './features.js'

/**
 * Last date a contract is treated as "front": the day before first notice when
 * known, else the last trade date, else ~5 days before the contract month.
 */
export function rollCutoff(c: ContractRow): string {
  if (c.firstNotice) return c.firstNotice
  if (c.lastTrade) return c.lastTrade
  const d = new Date(Date.UTC(c.year, c.month - 1, 1))
  d.setUTCDate(d.getUTCDate() - 5)
  return d.toISOString().slice(0, 10)
}

/**
 * Build the daily front-three curve (1st, 2nd, 3rd active contract) from
 * per-contract settles. Only contracts in `activeMonths` and not yet past
 * their roll cutoff on that date are eligible, so the curve at t uses only
 * bars dated t.
 */
export function buildCurveSeries(bars: ContractBar[], contracts: ContractRow[], activeMonths: number[]): CurvePoint[] {
  const eligible = contracts
    .filter((c) => activeMonths.includes(c.month))
    .sort((a, b) => a.year - b.year || a.month - b.month)
  const cutoff = new Map(eligible.map((c) => [c.symbol, rollCutoff(c)]))
  const order = new Map(eligible.map((c, i) => [c.symbol, i]))
  const byDate = new Map<string, ContractBar[]>()
  for (const b of bars) {
    if (!order.has(b.symbol) || !(b.close > 0)) continue
    const arr = byDate.get(b.date) ?? []
    arr.push(b)
    byDate.set(b.date, arr)
  }
  const meta = new Map(eligible.map((c) => [c.symbol, c]))
  const out: CurvePoint[] = []
  for (const [date, bs] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const live = bs
      .filter((b) => date < cutoff.get(b.symbol)!)
      .sort((a, b) => order.get(a.symbol)! - order.get(b.symbol)!)
    if (live.length < 2) continue
    const m1 = meta.get(live[0].symbol)!
    const m2 = meta.get(live[1].symbol)!
    out.push({
      date,
      c1: live[0].close,
      c2: live[1].close,
      c3: live[2]?.close ?? null,
      monthsApart: m2.year * 12 + m2.month - (m1.year * 12 + m1.month),
    })
  }
  return out
}

import type { ContractBar, ContractRow } from '../db/shared-repo.js'
import { pickFronts } from '../marketdata/continuous.js'
import type { CurvePoint, OiPoint } from './features.js'

/**
 * Daily open interest of a futures root from per-contract bars: `front` is the
 * OI of the front month as the marketdata domain defines it (the most-held
 * contract before its first-notice / last-trade day, never rolling back), and
 * `total` the sum over every contract that reported OI that day. Dates with no
 * reported OI are omitted. The values are as of each date's settlement; the
 * feature builder uses them only from the next day.
 */
export function buildOiSeries(bars: ContractBar[], contracts: ContractRow[]): OiPoint[] {
  const withOi = bars.filter((b) => b.openInterest != null && Number.isFinite(b.openInterest) && b.openInterest > 0)
  if (!withOi.length) return []
  const total = new Map<string, number>()
  for (const b of withOi) total.set(b.date, (total.get(b.date) ?? 0) + b.openInterest!)
  const front = new Map(pickFronts(withOi, contracts).map((b) => [b.date, b.openInterest]))
  return [...total.keys()].sort().map((date) => ({ date, front: front.get(date) ?? null, total: total.get(date)! }))
}

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

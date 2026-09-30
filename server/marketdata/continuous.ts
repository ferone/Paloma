import { futuresProduct } from '../../shared/universe.js'
import { continuousSymbol } from '../../shared/marketdata.js'
import { upsertDailyBars, type DailyBar } from '../db/repo.js'
import { listContracts, readRootBars, type ContractBar, type ContractRow } from '../db/shared-repo.js'

// Continuous front-month series per root, stored in prices_daily as
// `<root>.c.0` (source 'databento'). Front = the nearest ACTIVE contract month
// whose first-notice day is still in the future on that date, i.e. the series
// rolls on the business day before first notice (as a long holder must).
// UNADJUSTED: prices jump at rolls; use contract_bars for spread work.

export function buildFrontMonth(root: string, bars: ContractBar[], contracts: ContractRow[], activeMonths: number[]): DailyBar[] {
  const active = new Set(activeMonths)
  const eligible = contracts
    .filter((c) => active.has(c.month) && c.firstNotice)
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
  const byDate = new Map<string, Map<string, ContractBar>>()
  for (const b of bars) {
    let m = byDate.get(b.date)
    if (!m) byDate.set(b.date, (m = new Map()))
    m.set(b.symbol, b)
  }
  const out: DailyBar[] = []
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date)!
    const front = eligible.find((c) => c.firstNotice! > date && day.has(c.symbol))
    if (!front) continue
    const b = day.get(front.symbol)!
    out.push({
      symbol: continuousSymbol(root),
      date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      openInterest: b.openInterest,
      source: 'databento',
    })
  }
  return out
}

/** Rebuild the front-month series for a root from `from` onward. Returns rows written. */
export function refreshFrontMonth(root: string, from?: string): number {
  const product = futuresProduct(root)
  if (!product) return 0
  const bars = readRootBars(root, from).filter((b) => b.source === 'databento')
  const rows = buildFrontMonth(root, bars, listContracts(root), product.activeMonths)
  return rows.length ? upsertDailyBars(rows) : 0
}

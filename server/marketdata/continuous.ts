import { continuousSymbol } from '../../shared/marketdata.js'
import { getDb } from '../db/client.js'
import { upsertDailyBars, type DailyBar } from '../db/repo.js'
import { listContracts, readRootBars, type ContractBar, type ContractRow } from '../db/shared-repo.js'

// Continuous front-month series per root, stored in prices_daily as
// `<root>.c.0` (source 'databento').
//
// Front = the most liquid contract (highest open interest; volume when OI is
// not yet published) among contracts whose first-notice day is still ahead,
// and the series never rolls back to an earlier month. For GC this follows the
// liquid Feb/Apr/Jun/Aug/Dec cycle rather than the thin odd months.
// UNADJUSTED: prices jump at rolls; use contract_bars for spread work.

const monthIndex = (c: { year: number; month: number }) => c.year * 12 + c.month

/** The front contract's bar for each date (ascending). PURE. */
export function pickFronts(bars: ContractBar[], contracts: ContractRow[], floorIndex = 0): ContractBar[] {
  const bySymbol = new Map(contracts.map((c) => [c.symbol, c]))
  const byDate = new Map<string, ContractBar[]>()
  for (const b of bars) {
    if (!bySymbol.get(b.symbol)?.firstNotice) continue
    let list = byDate.get(b.date)
    if (!list) byDate.set(b.date, (list = []))
    list.push(b)
  }
  const out: ContractBar[] = []
  let floor = floorIndex
  for (const date of [...byDate.keys()].sort()) {
    const candidates = byDate.get(date)!.filter((b) => {
      const c = bySymbol.get(b.symbol)!
      return c.firstNotice! > date && monthIndex(c) >= floor
    })
    if (!candidates.length) continue
    const hasOi = candidates.some((b) => b.openInterest != null)
    const score = (b: ContractBar) => (hasOi ? (b.openInterest ?? -1) : (b.volume ?? -1))
    const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a))
    floor = monthIndex(bySymbol.get(best.symbol)!)
    out.push(best)
  }
  return out
}

export function buildFrontMonth(root: string, bars: ContractBar[], contracts: ContractRow[], floorIndex = 0): DailyBar[] {
  return pickFronts(bars, contracts, floorIndex).map((b) => ({
    symbol: continuousSymbol(root),
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    openInterest: b.openInterest,
    source: 'databento',
  }))
}

/**
 * Rebuild the front-month series for a root from `from` onward. The front
 * contract on the last stored day before `from` seeds the no-roll-back floor,
 * so an incremental rebuild continues the stored series consistently.
 */
export function refreshFrontMonth(root: string, from?: string): number {
  const contracts = listContracts(root)
  let floor = 0
  if (from) {
    const prev = getDb()
      .prepare(
        `SELECT MAX(b.date) AS d FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol
         WHERE c.root = ? AND b.source = 'databento' AND b.date < ?`,
      )
      .get(root, from) as { d: string | null }
    if (prev.d) {
      const seed = pickFronts(
        readRootBars(root, prev.d).filter((b) => b.date === prev.d && b.source === 'databento'),
        contracts,
      )[0]
      const c = seed && contracts.find((x) => x.symbol === seed.symbol)
      if (c) floor = monthIndex(c)
    }
  }
  const bars = readRootBars(root, from).filter((b) => b.source === 'databento')
  const rows = buildFrontMonth(root, bars, contracts, floor)
  return rows.length ? upsertDailyBars(rows) : 0
}

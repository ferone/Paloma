// Daily closes for valuation. Reads prices_daily (source 'yahoo') and tops it
// up from Yahoo when coverage is missing or stale. Network failures degrade to
// whatever is cached; the caller reports which symbols are stale.
import { readDailyBars, upsertDailyBars } from '../db/repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { MemoryPriceBook } from './engine/ledger.js'

export interface PriceSource {
  /** Daily closes from `from` (inclusive-ish) to today. */
  history(symbol: string, from: string): Promise<{ date: string; close: number }[]>
}

const RANGES: [string, number][] = [
  ['1M', 30],
  ['3M', 90],
  ['6M', 180],
  ['1Y', 365],
  ['5Y', 365 * 5],
  ['ALL', Infinity],
]

export const yahooSource: PriceSource = {
  async history(symbol, from) {
    const days = (Date.now() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 5
    const range = RANGES.find(([, d]) => d >= days)![0]
    const rows = (await getHistorical(symbol, { range, interval: '1d' })) as { date: string; close: number }[]
    return rows.filter((r) => Number.isFinite(r.close) && r.close > 0).map((r) => ({ date: r.date.slice(0, 10), close: r.close }))
  },
}

let source: PriceSource = yahooSource
/** Swap the network source (tests, offline runs). */
export function setPriceSource(s: PriceSource): void {
  source = s
}

const SOURCE = 'yahoo'
const REFETCH_MS = 60 * 60_000
const lastAttempt = new Map<string, number>()

export function isoDaysAgo(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

/** Most recent weekday strictly before today (UTC). */
export function lastCompletedWeekday(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  do d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

export interface LoadedPrices {
  book: MemoryPriceBook
  /** Symbols whose cache could not be brought up to date. */
  stale: string[]
  errors: string[]
  /** Latest cached date per symbol. */
  lastDates: Record<string, string | null>
}

/** Ensure cached coverage for `symbols` from `from` and load them into a PriceBook. */
export async function loadPrices(symbols: string[], from: string, opts: { force?: boolean } = {}): Promise<LoadedPrices> {
  const book = new MemoryPriceBook()
  const stale: string[] = []
  const errors: string[] = []
  const lastDates: Record<string, string | null> = {}
  const need = isoDaysAgo(from, 10)
  const target = lastCompletedWeekday()

  await Promise.all(
    [...new Set(symbols)].map(async (sym) => {
      let bars = readDailyBars(sym, { source: SOURCE })
      const first = bars[0]?.date
      const last = bars.at(-1)?.date
      const missingHead = !first || first > isoDaysAgo(from, -5)
      const missingTail = !last || last < target
      const recentlyTried = Date.now() - (lastAttempt.get(sym) ?? 0) < REFETCH_MS
      if ((missingHead || missingTail) && (opts.force || !recentlyTried)) {
        lastAttempt.set(sym, Date.now())
        try {
          const fetched = await source.history(sym, missingHead ? need : isoDaysAgo(last!, 7))
          if (fetched.length) {
            upsertDailyBars(fetched.map((b) => ({ symbol: sym, date: b.date, close: b.close, source: SOURCE })))
            bars = readDailyBars(sym, { source: SOURCE })
          }
        } catch (err) {
          errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      const lastNow = bars.at(-1)?.date ?? null
      lastDates[sym] = lastNow
      if (!lastNow || lastNow < isoDaysAgo(target, 4)) stale.push(sym)
      book.set(
        sym,
        bars.filter((b) => b.date >= need),
      )
    }),
  )
  return { book, stale: stale.sort(), errors, lastDates }
}

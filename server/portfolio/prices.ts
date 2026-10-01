// Daily closes for valuation. Reads prices_daily (source 'yahoo') and tops it
// up from Yahoo when coverage is missing or stale. Network failures degrade to
// whatever is cached; the caller reports which symbols are stale.
import { getDb } from '../db/client.js'
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
/** After a successful fetch a symbol is not re-fetched for this long (its cache is as current as Yahoo allows). */
const REFETCH_MS = 60 * 60_000
/** After a failed fetch (network, throttling) the next valuation retries sooner. */
const RETRY_FAILED_MS = 2 * 60_000
/** Completed fetch attempts: when they finished and whether they failed. */
const lastAttempt = new Map<string, { at: number; failed: boolean }>()
/**
 * Fetches in flight, per symbol. A concurrent loadPrices for the same symbol
 * (e.g. a second NAV recompute started by a second ledger write while the
 * first is still downloading) waits for that fetch and then reads the cache,
 * instead of treating the symbol as "recently tried" and valuing it on an
 * empty cache.
 */
const inflightFetch = new Map<string, Promise<string | null>>()

/** Test helper: forget fetch attempts. */
export function resetPriceFetchState(): void {
  lastAttempt.clear()
  inflightFetch.clear()
}

function recentlyTried(sym: string): boolean {
  const a = lastAttempt.get(sym)
  return !!a && Date.now() - a.at < (a.failed ? RETRY_FAILED_MS : REFETCH_MS)
}

/**
 * Fetch `sym` from `from` into prices_daily, sharing one in-flight request per
 * symbol. Resolves to an error message, or null on success.
 */
function fetchInto(sym: string, from: string): Promise<string | null> {
  const running = inflightFetch.get(sym)
  if (running) return running
  const p = (async () => {
    let error: string | null = null
    try {
      const fetched = await source.history(sym, from)
      if (fetched.length) upsertDailyBars(fetched.map((b) => ({ symbol: sym, date: b.date, close: b.close, source: SOURCE })))
    } catch (err) {
      error = `${sym}: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      // Recorded when the attempt FINISHES: an in-flight fetch is joined, never mistaken for a completed one.
      lastAttempt.set(sym, { at: Date.now(), failed: error !== null })
      inflightFetch.delete(sym)
    }
    return error
  })()
  inflightFetch.set(sym, p)
  return p
}

/**
 * Cheap fingerprint of the cached closes of `symbols` (row count + latest
 * date). It changes whenever any writer (this module, the marketdata Yahoo
 * job, the data:yahoo CLI in another process) lands new bars for them.
 */
export function priceStamp(symbols: string[]): string {
  const uniq = [...new Set(symbols)]
  if (!uniq.length) return ''
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n, MAX(date) AS d FROM prices_daily WHERE source = ? AND symbol IN (${uniq.map(() => '?').join(',')})`)
    .get(SOURCE, ...uniq) as { n: number; d: string | null }
  return `${r.n}:${r.d ?? ''}`
}

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
      if (inflightFetch.has(sym) || ((missingHead || missingTail) && (opts.force || !recentlyTried(sym)))) {
        const error = await fetchInto(sym, missingHead ? need : isoDaysAgo(last!, 7))
        if (error) errors.push(error)
        bars = readDailyBars(sym, { source: SOURCE })
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

import { ASSETS, MACRO_SYMBOLS, UNIVERSE, yahooContractSymbol, type AssetSpec, type FuturesProduct } from '../../shared/universe.js'
import { upsertDailyBars, type DailyBar } from '../db/repo.js'
import { upsertContracts, type ContractBar } from '../db/shared-repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import type { JobContext } from '../jobs/registry.js'
import { canonicalSymbol, contractRow } from './contracts.js'
import { latestPriceDate, upsertYahooContractBars } from './repo.js'

// Yahoo Finance daily history → prices_daily (source 'yahoo'), plus listed
// futures contract months (GCZ26.CMX, PLF27.NYM, BTCZ26.CME; the exchange
// suffix comes from the universe) → contract_bars, never overwriting Databento.

export interface YahooBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * Every Yahoo symbol the platform keeps daily history for, derived from the
 * universe: continuous futures, the reference spot series, the optional 24/7
 * display quote, ETFs and miners of every asset, then the macro references.
 */
export function yahooHistorySymbols(specs: readonly AssetSpec[] = ASSETS.map((a) => UNIVERSE[a])): string[] {
  const s = new Set<string>()
  for (const u of specs) {
    for (const f of u.futures) s.add(f.yahoo)
    s.add(u.spot)
    if (u.displaySpot) s.add(u.displaySpot)
    // Cash-and-carry basis inputs (spot series + cash benchmark) feed the quant engine.
    if (u.basis) {
      s.add(u.basis.spot)
      s.add(u.basis.rate)
    }
    u.etfs.forEach((e) => s.add(e))
    if (u.miners) s.add(u.miners)
  }
  Object.values(MACRO_SYMBOLS).forEach((x) => s.add(x))
  s.add('^IRX')
  return [...s]
}

/** Smallest getHistorical range that covers everything since `latest` (with slack). */
export function rangeFor(latest: string | null, today: string): string {
  if (!latest) return 'ALL'
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000
  if (days <= 20) return '1M'
  if (days <= 80) return '3M'
  if (days <= 170) return '6M'
  if (days <= 350) return '1Y'
  if (days <= 5 * 360) return '5Y'
  return 'ALL'
}

/** Yahoo serves float32 prices (4710.10009765625); 7 significant digits recovers the quoted value. */
export function sig7(n: number): number {
  return Number.isFinite(n) && n !== 0 ? Number(n.toPrecision(7)) : n
}

/** Yahoo quotes → clean daily bars: drop null/zero closes, one row per date (last wins), float32 noise removed. PURE. */
export function cleanYahooBars(quotes: YahooBar[]): YahooBar[] {
  const byDate = new Map<string, YahooBar>()
  for (const q of quotes) {
    if (!(q.close > 0) || !Number.isFinite(q.close)) continue
    const date = q.date.slice(0, 10)
    byDate.set(date, { ...q, date, open: sig7(q.open), high: sig7(q.high), low: sig7(q.low), close: sig7(q.close) })
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : null)

/** Listed contract months to mirror from Yahoo: active months from this month over the next `months`. */
export function listedContractMonths(
  today: string,
  months = 24,
  products: readonly FuturesProduct[] = ASSETS.flatMap((a) => UNIVERSE[a].futures),
): { root: string; month: number; year: number }[] {
  const out: { root: string; month: number; year: number }[] = []
  const y0 = Number(today.slice(0, 4))
  const m0 = Number(today.slice(5, 7))
  for (const f of products) {
    for (let k = 0; k <= months; k++) {
      const idx = y0 * 12 + (m0 - 1) + k
      const year = Math.floor(idx / 12)
      const month = (idx % 12) + 1
      if (f.activeMonths.includes(month)) out.push({ root: f.root, month, year })
    }
  }
  return out
}

type Fetcher = (symbol: string, range: string) => Promise<YahooBar[]>
const defaultFetcher: Fetcher = (symbol, range) => getHistorical(symbol, { range, interval: '1d' })

export async function ingestYahoo(ctx: JobContext, opts: { fetcher?: Fetcher; today?: string; contracts?: boolean } = {}): Promise<string> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const symbols = yahooHistorySymbols()
  const listed = opts.contracts === false ? [] : listedContractMonths(today)
  const total = symbols.length + listed.length
  let done = 0
  let rows = 0
  let contractRows = 0
  const failures: string[] = []

  for (const symbol of symbols) {
    try {
      const range = rangeFor(latestPriceDate(symbol, 'yahoo'), today)
      const bars = cleanYahooBars(await fetcher(symbol, range))
      const out: DailyBar[] = bars.map((b) => ({
        symbol,
        date: b.date,
        open: pos(b.open),
        high: pos(b.high),
        low: pos(b.low),
        close: b.close,
        volume: Number.isFinite(b.volume) ? b.volume : null,
        source: 'yahoo',
      }))
      rows += upsertDailyBars(out)
    } catch (err) {
      failures.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`)
    }
    ctx.progress(++done / total, `Yahoo ${symbol}`)
  }

  for (const c of listed) {
    const ysym = yahooContractSymbol(c.root, c.month, c.year)
    const symbol = canonicalSymbol(c.root, c.month, c.year)
    try {
      const bars = cleanYahooBars(await fetcher(ysym, '1Y'))
      if (bars.length) {
        upsertContracts([contractRow({ root: c.root, month: c.month, year: c.year, symbol })])
        const out: ContractBar[] = bars.map((b) => ({
          symbol,
          date: b.date,
          open: pos(b.open),
          high: pos(b.high),
          low: pos(b.low),
          close: b.close,
          volume: Number.isFinite(b.volume) ? b.volume : null,
          openInterest: null,
          source: 'yahoo',
        }))
        contractRows += upsertYahooContractBars(out)
      }
    } catch {
      // Many deferred months are simply not listed on Yahoo; not an error.
    }
    ctx.progress(++done / total, `Yahoo ${ysym}`)
  }

  if (failures.length) ctx.log(`Failed: ${failures.join('; ')}`)
  if (failures.length === symbols.length) throw new Error(`Yahoo refresh failed for every symbol (${failures[0]})`)
  return `Yahoo: ${rows} daily rows across ${symbols.length - failures.length}/${symbols.length} symbols; ${contractRows} contract rows (Databento rows untouched)`
}

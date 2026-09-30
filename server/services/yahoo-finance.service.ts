/* eslint-disable @typescript-eslint/no-explicit-any -- yahoo-finance2 v3 result types are too loose to model usefully here */
import YahooFinance from 'yahoo-finance2'

/**
 * OFFLINE=1 makes every Yahoo call fail fast, so callers fall back to cached
 * prices_daily rows. Used for reproducible runs (regression snapshots, tests)
 * where live price moves would otherwise show up as differences.
 */
const offline = new Proxy({} as InstanceType<typeof YahooFinance>, {
  get: () => () => Promise.reject(new Error('Yahoo Finance disabled (OFFLINE=1)')),
})

const yahooFinance = process.env.OFFLINE === '1' ? offline : new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export async function getQuote(symbol: string) {
  const result: any = await yahooFinance.quote(symbol)
  return {
    symbol: result.symbol as string,
    shortName: (result.shortName ?? result.symbol) as string,
    price: (result.regularMarketPrice ?? 0) as number,
    previousClose: (result.regularMarketPreviousClose ?? 0) as number,
    change: (result.regularMarketChange ?? 0) as number,
    changePercent: (result.regularMarketChangePercent ?? 0) as number,
    dayHigh: (result.regularMarketDayHigh ?? 0) as number,
    dayLow: (result.regularMarketDayLow ?? 0) as number,
    volume: (result.regularMarketVolume ?? 0) as number,
    marketState: (result.marketState ?? 'CLOSED') as string,
    timestamp: Date.now(),
  }
}

export async function getBatchQuotes(symbols: string[]) {
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)))
  return results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getQuote>>> => r.status === 'fulfilled')
    .map((r) => r.value)
}

type ChartInterval = '1m' | '5m' | '15m' | '1d' | '1wk' | '1mo'

interface HistoricalOptions {
  range: string
  interval: ChartInterval
}

export async function getHistorical(symbol: string, options: HistoricalOptions) {
  const { range, interval } = options

  const periodMap: Record<string, { period1: Date; period2: Date }> = {
    '1D': { period1: daysAgo(1), period2: new Date() },
    '1W': { period1: daysAgo(7), period2: new Date() },
    '1M': { period1: daysAgo(30), period2: new Date() },
    '3M': { period1: daysAgo(90), period2: new Date() },
    '6M': { period1: daysAgo(180), period2: new Date() },
    '1Y': { period1: daysAgo(365), period2: new Date() },
    '5Y': { period1: daysAgo(365 * 5), period2: new Date() },
    ALL: { period1: new Date('2000-01-01'), period2: new Date() },
  }

  const periods = periodMap[range] || periodMap['1M']

  const result: any = await yahooFinance.chart(symbol, {
    period1: periods.period1,
    period2: periods.period2,
    interval,
  })

  return (result.quotes || []).map((q: any) => ({
    date: q.date instanceof Date ? q.date.toISOString() : String(q.date),
    open: q.open ?? 0,
    high: q.high ?? 0,
    low: q.low ?? 0,
    close: q.close ?? 0,
    volume: q.volume ?? 0,
  }))
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

// ── Additions for the markets domain (server/markets). The functions above keep
// their signatures and shapes: other domains depend on them. ──────────────────

/** Richer quote fields used by the term-structure, ETF and liquidity views. */
export interface DetailedQuote {
  symbol: string
  shortName: string
  quoteType: string
  price: number | null
  previousClose: number | null
  change: number | null
  /** Percent units (1.2 = 1.2%), as Yahoo reports it. */
  changePercent: number | null
  open: number | null
  dayHigh: number | null
  dayLow: number | null
  volume: number | null
  avgVolume3M: number | null
  openInterest: number | null
  /** YYYY-MM-DD, futures only. */
  expireDate: string | null
  marketState: string
  /** ISO time of the last trade. */
  lastTrade: string | null
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const toDate = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v)
  if (typeof v === 'string' && v) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function toDetailed(q: any): DetailedQuote {
  return {
    symbol: String(q.symbol),
    shortName: String(q.shortName ?? q.longName ?? q.symbol).replace(/^"|"$/g, ''),
    quoteType: String(q.quoteType ?? ''),
    price: num(q.regularMarketPrice),
    previousClose: num(q.regularMarketPreviousClose),
    change: num(q.regularMarketChange),
    changePercent: num(q.regularMarketChangePercent),
    open: num(q.regularMarketOpen),
    dayHigh: num(q.regularMarketDayHigh),
    dayLow: num(q.regularMarketDayLow),
    volume: num(q.regularMarketVolume),
    avgVolume3M: num(q.averageDailyVolume3Month),
    openInterest: num(q.openInterest),
    expireDate: toDate(q.expireIsoDate ?? q.expireDate)?.toISOString().slice(0, 10) ?? null,
    marketState: String(q.marketState ?? 'CLOSED'),
    lastTrade: toDate(q.regularMarketTime)?.toISOString() ?? null,
  }
}

/**
 * Batched Yahoo quote request (40 symbols per call). Unknown symbols (e.g. a
 * contract month that is not listed yet) are simply absent from the result.
 */
export async function getDetailedQuotes(symbols: string[]): Promise<DetailedQuote[]> {
  const out: DetailedQuote[] = []
  for (let i = 0; i < symbols.length; i += 40) {
    const chunk = symbols.slice(i, i + 40)
    const res: any = await yahooFinance.quote(chunk, {}, { validateResult: false })
    const arr: any[] = Array.isArray(res) ? res : res ? [res] : []
    for (const q of arr) if (q?.symbol) out.push(toDetailed(q))
  }
  return out
}

export interface FundProfile {
  symbol: string
  /** Latest published NAV per share (usually the prior close). */
  navPrice: number | null
  totalAssets: number | null
  /** Fraction (0.004 = 0.40%). */
  expenseRatio: number | null
}

/** NAV, AUM and expense ratio from quoteSummary. Closed-end trusts (PHYS, PSLV) report no NAV. */
export async function getFundProfile(symbol: string): Promise<FundProfile> {
  const r: any = await yahooFinance.quoteSummary(
    symbol,
    { modules: ['summaryDetail', 'defaultKeyStatistics', 'fundProfile'] },
    { validateResult: false },
  )
  return {
    symbol,
    navPrice: num(r?.summaryDetail?.navPrice),
    totalAssets: num(r?.summaryDetail?.totalAssets) ?? num(r?.defaultKeyStatistics?.totalAssets),
    expenseRatio: num(r?.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio),
  }
}

export interface DailyBarLite {
  /** YYYY-MM-DD */
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Bars from an explicit start date; bars without a close are dropped. */
export async function getBarsSince(
  symbol: string,
  from: Date,
  interval: '1d' | '1wk' | '1mo' = '1d',
): Promise<DailyBarLite[]> {
  const result: any = await yahooFinance.chart(symbol, { period1: from, period2: new Date(), interval })
  return (result.quotes || [])
    .filter((q: any) => typeof q.close === 'number' && Number.isFinite(q.close))
    .map((q: any) => ({
      date: (q.date instanceof Date ? q.date.toISOString() : String(q.date)).slice(0, 10),
      open: q.open ?? q.close,
      high: q.high ?? q.close,
      low: q.low ?? q.close,
      close: q.close,
      volume: q.volume ?? 0,
    }))
}

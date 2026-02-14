import yahooFinance from 'yahoo-finance2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Pure helpers over OHLCV series: rebasing, period returns, correlation, ratios.
import type { OHLCV } from '@shared/markets'

export const dayKey = (iso: string) => iso.slice(0, 10)

/** Map of YYYY-MM-DD → close (last bar of the day wins). */
export function closesByDay(bars: OHLCV[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const b of bars) if (b.close > 0) m.set(dayKey(b.date), b.close)
  return m
}

/**
 * Rebase several series to 0 at a common start (the first date every series
 * has), as fractions. Rows are the union of dates after that start; a symbol
 * is absent from a row where it has no bar.
 */
export function rebase(datasets: { symbol: string; bars: OHLCV[] }[]): { date: string; [symbol: string]: number | string }[] {
  const maps = datasets.filter((d) => d.bars.length > 0).map((d) => ({ symbol: d.symbol, closes: closesByDay(d.bars) }))
  if (maps.length === 0) return []
  const firsts = maps.map((m) => [...m.closes.keys()].sort()[0])
  const start = firsts.sort().at(-1) as string
  const dates = new Set<string>()
  for (const m of maps) for (const d of m.closes.keys()) if (d >= start) dates.add(d)
  const bases = maps.map((m) => {
    // Base = the series' close on the common start, or the nearest earlier close.
    let base: number | undefined
    for (const [d, c] of [...m.closes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (d <= start) base = c
      else break
    }
    return base
  })
  return [...dates].sort().map((date) => {
    const row: { date: string; [s: string]: number | string } = { date }
    maps.forEach((m, i) => {
      const c = m.closes.get(date)
      const b = bases[i]
      if (c != null && b) row[m.symbol] = c / b - 1
    })
    return row
  })
}

/** Return from the last close on/before `from` (YYYY-MM-DD) to the latest close. */
export function returnSince(bars: OHLCV[], from: string): number | null {
  if (bars.length < 2) return null
  const lastBar = bars[bars.length - 1]
  let base: OHLCV | null = null
  for (const b of bars) {
    if (dayKey(b.date) <= from) base = b
    else break
  }
  if (!base) {
    // Allow a short gap (weekend/holiday) before the first bar.
    const gapDays = (Date.parse(dayKey(bars[0].date)) - Date.parse(from)) / 86_400_000
    if (gapDays > 6) return null
    base = bars[0]
  }
  if (base === lastBar || !(base.close > 0)) return null
  return lastBar.close / base.close - 1
}

export const PERIODS = ['1W', '1M', '3M', '6M', 'YTD', '1Y'] as const
export type Period = (typeof PERIODS)[number]

export function periodStart(period: Period, asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`)
  if (period === 'YTD') return `${d.getUTCFullYear() - 1}-12-31`
  if (period === '1W') d.setUTCDate(d.getUTCDate() - 7)
  else d.setUTCMonth(d.getUTCMonth() - { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[period])
  return d.toISOString().slice(0, 10)
}

export function periodReturns(bars: OHLCV[]): Record<Period, number | null> {
  const asOf = bars.length ? dayKey(bars[bars.length - 1].date) : ''
  const out = {} as Record<Period, number | null>
  for (const p of PERIODS) out[p] = asOf ? returnSince(bars, periodStart(p, asOf)) : null
  return out
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 3) return null
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb)
    va += (a[i] - ma) ** 2
    vb += (b[i] - mb) ** 2
  }
  const d = Math.sqrt(va * vb)
  return d === 0 ? null : cov / d
}

/** Correlation of daily returns on dates both series traded. */
export function returnCorrelation(a: OHLCV[], b: OHLCV[]): number | null {
  const ma = closesByDay(a)
  const mb = closesByDay(b)
  const days = [...ma.keys()].filter((d) => mb.has(d)).sort()
  const ra: number[] = []
  const rb: number[] = []
  for (let i = 1; i < days.length; i++) {
    ra.push((ma.get(days[i]) as number) / (ma.get(days[i - 1]) as number) - 1)
    rb.push((mb.get(days[i]) as number) / (mb.get(days[i - 1]) as number) - 1)
  }
  return pearson(ra, rb)
}

/** a ÷ b on shared dates (e.g. the gold/silver ratio). */
export function ratioSeries(a: OHLCV[], b: OHLCV[]): { date: string; value: number }[] {
  const mb = closesByDay(b)
  return [...closesByDay(a).entries()]
    .filter(([d]) => mb.has(d))
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, v]) => ({ date, value: v / (mb.get(date) as number) }))
}

/** Share of values strictly below x (0–1). */
export function percentileRank(values: number[], x: number): number | null {
  if (values.length === 0) return null
  return values.filter((v) => v < x).length / values.length
}

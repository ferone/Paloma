import type { OHLCV } from '../types'

export function normalizeToPercent(data: OHLCV[]): { date: string; value: number }[] {
  if (data.length === 0) return []
  const basePrice = data[0].close
  return data.map((d) => ({
    date: d.date,
    value: ((d.close - basePrice) / basePrice) * 100,
  }))
}

export function normalizeMultiple(
  datasets: { symbol: string; data: OHLCV[] }[]
): { date: string; [symbol: string]: number | string }[] {
  if (datasets.length === 0) return []

  const dateMap = new Map<string, Record<string, number>>()

  for (const { symbol, data } of datasets) {
    if (data.length === 0) continue
    const basePrice = data[0].close
    for (const d of data) {
      const dateKey = d.date.split('T')[0]
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, {})
      dateMap.get(dateKey)![symbol] = ((d.close - basePrice) / basePrice) * 100
    }
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }))
}

import { describe, expect, it } from 'vitest'
import type { OHLCV } from '@shared/markets'
import { percentileRank, periodReturns, periodStart, ratioSeries, rebase, returnCorrelation, returnSince } from './series'

const bar = (date: string, close: number): OHLCV => ({ date: `${date}T14:30:00.000Z`, open: close, high: close, low: close, close, volume: 0 })

describe('rebase', () => {
  it('rebases every series at the first common date', () => {
    const rows = rebase([
      { symbol: 'A', bars: [bar('2026-01-01', 10), bar('2026-01-02', 11), bar('2026-01-03', 12)] },
      { symbol: 'B', bars: [bar('2026-01-02', 50), bar('2026-01-03', 55)] },
    ])
    expect(rows.map((r) => r.date)).toEqual(['2026-01-02', '2026-01-03'])
    expect(rows[0].A).toBeCloseTo(0, 12)
    expect(rows[1].A).toBeCloseTo(12 / 11 - 1, 12)
    expect(rows[1].B).toBeCloseTo(0.1, 12)
  })
})

describe('period returns', () => {
  const bars = [bar('2025-09-30', 100), bar('2025-12-31', 110), bar('2026-06-30', 120), bar('2026-09-23', 125), bar('2026-09-30', 132)]

  it('anchors windows on calendar dates', () => {
    expect(periodStart('YTD', '2026-09-30')).toBe('2025-12-31')
    expect(periodStart('1W', '2026-09-30')).toBe('2026-09-23')
    expect(periodStart('3M', '2026-09-30')).toBe('2026-06-30')
  })

  it('computes each window from one series', () => {
    const r = periodReturns(bars)
    expect(r['1Y']).toBeCloseTo(0.32, 12)
    expect(r.YTD).toBeCloseTo(132 / 110 - 1, 12)
    expect(r['3M']).toBeCloseTo(0.1, 12)
    expect(r['1W']).toBeCloseTo(132 / 125 - 1, 12)
  })

  it('returns null when the series is too short for the window', () => {
    expect(returnSince(bars, '2024-01-01')).toBeNull()
  })
})

describe('returnCorrelation', () => {
  it('correlates daily returns on shared dates', () => {
    const a = [bar('2026-01-01', 10), bar('2026-01-02', 11), bar('2026-01-03', 10.5), bar('2026-01-04', 12)]
    const b = a.map((x) => ({ ...x, close: x.close * 3 }))
    expect(returnCorrelation(a, b)).toBeCloseTo(1, 12)
  })
})

describe('ratio helpers', () => {
  it('divides on shared dates and ranks', () => {
    const r = ratioSeries([bar('2026-01-01', 4000), bar('2026-01-02', 4100)], [bar('2026-01-02', 50)])
    expect(r).toEqual([{ date: '2026-01-02', value: 82 }])
    expect(percentileRank([1, 2, 3, 4], 3.5)).toBe(0.75)
  })
})

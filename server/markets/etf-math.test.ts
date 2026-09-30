import { describe, expect, it } from 'vitest'
import { alignCloses, modeledNav, pearson, periodAnchors, premiumToNav, returnSince, trackingStats, type Bar } from './etf-math'

function series(start: string, closes: number[]): Bar[] {
  const d0 = Date.parse(`${start}T00:00:00Z`)
  return closes.map((close, i) => ({ date: new Date(d0 + i * 86_400_000).toISOString().slice(0, 10), close }))
}

describe('premiumToNav', () => {
  it('is price / NAV − 1', () => {
    expect(premiumToNav(381.17, 379.9726)).toBeCloseTo(381.17 / 379.9726 - 1, 12)
    expect(premiumToNav(99, 100)).toBeCloseTo(-0.01, 12)
  })

  it('returns null without a usable NAV', () => {
    expect(premiumToNav(100, null)).toBeNull()
    expect(premiumToNav(100, 0)).toBeNull()
    expect(premiumToNav(null, 100)).toBeNull()
  })
})

describe('modeledNav', () => {
  it('values the median metal-per-share ratio at the current spot', () => {
    const spot = series('2026-01-01', Array.from({ length: 40 }, (_, i) => 50 + i * 0.1))
    // Trust holds 0.35 oz/unit, trading exactly at that ratio
    const etf = spot.map((b) => ({ date: b.date, close: b.close * 0.35 }))
    expect(modeledNav(etf, spot, 60)).toBeCloseTo(21, 10)
    // A trust quoted 2% above its usual ratio shows a +2% modeled premium
    expect(premiumToNav(21 * 1.02, modeledNav(etf, spot, 60))).toBeCloseTo(0.02, 10)
  })

  it('refuses to model from too little overlap', () => {
    const spot = series('2026-01-01', [50, 51, 52])
    expect(modeledNav(spot, spot, 52)).toBeNull()
  })
})

describe('returnSince', () => {
  const bars = series('2026-01-01', [100, 102, 104, 110])

  it('uses the last close on or before the anchor', () => {
    expect(returnSince(bars, '2026-01-02')).toBeCloseTo(110 / 102 - 1, 12)
    expect(returnSince(bars, '2026-01-01')).toBeCloseTo(0.1, 12)
  })

  it('tolerates an anchor just before the series (weekend/holiday)', () => {
    expect(returnSince(bars, '2025-12-31')).toBeCloseTo(0.1, 12)
  })

  it('returns null when history is too short for the window', () => {
    expect(returnSince(bars, '2025-06-01')).toBeNull()
  })
})

describe('periodAnchors', () => {
  it('computes 1M/3M/YTD/1Y anchors', () => {
    expect(periodAnchors('2026-09-30')).toEqual({ m1: '2026-08-30', m3: '2026-06-30', ytd: '2025-12-31', y1: '2025-09-30' })
  })
})

describe('tracking', () => {
  it('reports zero tracking error for a perfect tracker', () => {
    const spot = series('2026-01-01', Array.from({ length: 60 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i))))
    const etf = spot.map((b) => ({ date: b.date, close: b.close / 10 }))
    const t = trackingStats(etf, spot)
    expect(t.error).toBeCloseTo(0, 10)
    expect(t.diff).toBeCloseTo(0, 10)
    expect(t.correlation).toBeCloseTo(1, 10)
  })

  it('only compares dates present in both series', () => {
    const a = series('2026-01-01', [1, 2, 3])
    const b = series('2026-01-02', [5, 6, 7])
    expect(alignCloses(a, b).map((p) => p.date)).toEqual(['2026-01-02', '2026-01-03'])
  })

  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12)
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull()
  })
})

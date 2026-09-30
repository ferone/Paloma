import { describe, expect, it } from 'vitest'
import {
  alignSeries,
  annualize,
  annualizedVol,
  betaCorrelation,
  chainLink,
  drawdowns,
  historicalVar,
  monthlyReturns,
  normInv,
  parametricVar,
  quantile,
  returnSince,
  rollingVol,
  sharpe,
  sortino,
  twrDailyReturns,
  xirr,
} from './perf.js'

describe('returns', () => {
  it('chain-links flow-adjusted daily returns (TWR ignores flow timing)', () => {
    // 100 → 110 (+10%), then +100 subscription at close, then 210 → 189 (−10%)
    const navs = [100, 110, 210, 189]
    const flows = [0, 0, 100, 0]
    const r = twrDailyReturns(navs, flows)
    expect(r).toEqual([expect.closeTo(0.1, 12), expect.closeTo(0, 12), expect.closeTo(-0.1, 12)])
    expect(chainLink(r)).toBeCloseTo(1.1 * 0.9 - 1, 12)
  })

  it('annualizes over calendar days', () => {
    expect(annualize(0.21, 730.5)).toBeCloseTo(0.1, 10)
    expect(annualize(0.1, 0)).toBeNaN()
  })

  it('computes volatility, Sharpe and Sortino by hand', () => {
    const r = [0.01, -0.01, 0.02]
    const m = 0.02 / 3
    const sd = Math.sqrt(((0.01 - m) ** 2 + (-0.01 - m) ** 2 + (0.02 - m) ** 2) / 2)
    expect(annualizedVol(r)).toBeCloseTo(sd * Math.sqrt(252), 12)
    expect(sharpe(r)).toBeCloseTo((m / sd) * Math.sqrt(252), 12)
    const dd = Math.sqrt(0.01 ** 2 / 3)
    expect(sortino(r)).toBeCloseTo((m / dd) * Math.sqrt(252), 12)
    // With a risk-free rate the excess mean shifts by rf/252
    const rf = 0.0252
    expect(sharpe(r, rf)).toBeCloseTo(((m - 0.0001) / sd) * Math.sqrt(252), 12)
  })

  it('computes XIRR for a one-year doubling and a multi-flow case', () => {
    expect(xirr([{ date: '2021-01-01', amount: -1000 }, { date: '2022-01-01', amount: 1100 }])).toBeCloseTo(0.1, 8)
    // −1000, −1000 one year later, +2310 two years in: 1000·1.1² + 1000·1.1 = 2310 → 10%
    expect(
      xirr([
        { date: '2021-01-01', amount: -1000 },
        { date: '2022-01-01', amount: -1000 },
        { date: '2023-01-01', amount: 2310 },
      ]),
    ).toBeCloseTo(0.1, 6)
    expect(xirr([{ date: '2021-01-01', amount: -1000 }])).toBeNaN()
    // Loss case
    expect(xirr([{ date: '2021-01-01', amount: -1000 }, { date: '2022-01-01', amount: 500 }])).toBeCloseTo(-0.5, 6)
  })
})

describe('drawdown', () => {
  it('finds the worst peak-to-trough, recovery and duration', () => {
    const pts = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 120 },
      { date: '2024-01-05', value: 90 },
      { date: '2024-01-10', value: 95 },
      { date: '2024-01-20', value: 130 },
      { date: '2024-01-25', value: 117 },
    ]
    const d = drawdowns(pts)
    expect(d.maxDrawdown).toBeCloseTo(-0.25, 12)
    expect(d.peakDate).toBe('2024-01-02')
    expect(d.troughDate).toBe('2024-01-05')
    expect(d.recoveryDate).toBe('2024-01-20')
    expect(d.durationDays).toBe(18)
    expect(d.current).toBeCloseTo(-0.1, 12)
    expect(d.series.map((s) => s.value)).toEqual([0, 0, -0.25, expect.closeTo(95 / 120 - 1, 12), 0, expect.closeTo(-0.1, 12)])
  })

  it('reports an unrecovered drawdown up to the last date', () => {
    const d = drawdowns([
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-11', value: 80 },
    ])
    expect(d.recoveryDate).toBeNull()
    expect(d.durationDays).toBe(10)
  })
})

describe('VaR', () => {
  const r = [-0.05, -0.03, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06]

  it('interpolates quantiles (type 7)', () => {
    expect(quantile(r, 0.05)).toBeCloseTo(-0.041, 12)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
  })

  it('computes historical VaR and CVaR as positive losses', () => {
    const v = historicalVar(r, 0.95)
    expect(v.var).toBeCloseTo(0.041, 12)
    expect(v.cvar).toBeCloseTo(0.05, 12)
  })

  it('computes Gaussian VaR/CVaR', () => {
    expect(normInv(0.95)).toBeCloseTo(1.6448536, 6)
    expect(normInv(0.99)).toBeCloseTo(2.3263479, 6)
    expect(normInv(0.01)).toBeCloseTo(-2.3263479, 6)
    const m = r.reduce((s, x) => s + x, 0) / r.length
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1))
    const v = parametricVar(r, 0.99)
    expect(v.var).toBeCloseTo(-(m - 2.3263479 * sd), 6)
    const phi = Math.exp(-0.5 * 2.3263479 ** 2) / Math.sqrt(2 * Math.PI)
    expect(v.cvar).toBeCloseTo(-(m - (sd * phi) / 0.01), 5)
    expect(v.cvar).toBeGreaterThan(v.var)
  })
})

describe('beta, rolling vol, monthly matrix', () => {
  it('recovers beta and correlation for a linear relation', () => {
    const b = [0.01, -0.02, 0.015, 0.003, -0.007]
    const a = b.map((x) => 2 * x + 0.001)
    const res = betaCorrelation(a, b)
    expect(res.beta).toBeCloseTo(2, 12)
    expect(res.correlation).toBeCloseTo(1, 12)
  })

  it('rolls volatility over a fixed window', () => {
    const rs = Array.from({ length: 5 }, (_, i) => ({ date: `2024-01-0${i + 1}`, value: i % 2 ? 0.01 : -0.01 }))
    const out = rollingVol(rs, 3)
    expect(out).toHaveLength(3)
    expect(out[0].date).toBe('2024-01-03')
    expect(out[0].value).toBeCloseTo(annualizedVol([-0.01, 0.01, -0.01]), 12)
  })

  it('builds a year × month matrix with YTD', () => {
    const pts = [
      { date: '2023-11-15', value: 100 },
      { date: '2023-11-30', value: 102 },
      { date: '2023-12-29', value: 99.96 },
      { date: '2024-01-31', value: 104.958 },
    ]
    const rows = monthlyReturns(pts, 100)
    expect(rows.map((r) => r.year)).toEqual([2024, 2023])
    const [y24, y23] = rows
    expect(y23.months[10]).toBeCloseTo(0.02, 12)
    expect(y23.months[11]).toBeCloseTo(-0.02, 12)
    expect(y23.ytd).toBeCloseTo(-0.0004, 12)
    expect(y24.months[0]).toBeCloseTo(0.05, 12)
    expect(y24.ytd).toBeCloseTo(0.05, 12)
    expect(y24.months[1]).toBeNull()
  })

  it('computes period returns and aligns benchmark series', () => {
    const pts = [
      { date: '2023-12-29', value: 110 },
      { date: '2024-01-02', value: 121 },
    ]
    expect(returnSince(pts, '2023-12-31')).toBeCloseTo(0.1, 12)
    expect(returnSince(pts, '2023-01-01', 100)).toBeCloseTo(0.21, 12)
    expect(alignSeries(['2024-01-01', '2024-01-03'], [{ date: '2024-01-02', value: 5 }])).toEqual([null, 5])
  })
})

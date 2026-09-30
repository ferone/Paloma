import { describe, expect, it } from 'vitest'
import { FEATURE_IDS } from '../../shared/ml.js'
import { buildCurveSeries } from './curve.js'
import {
  asOf,
  buildFeatureMatrix,
  cotSeries,
  matrixToCsv,
  rsi,
  seasonalDrift,
  type CotPoint,
  type FeatureInputs,
  type PricePoint,
} from './features.js'

// Deterministic pseudo-random walk.
function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function businessDays(from: string, count: number): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < count) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

function walk(dates: string[], start: number, seed: number, withVolume = false): PricePoint[] {
  const r = lcg(seed)
  let p = start
  return dates.map((date) => {
    p *= Math.exp((r() - 0.5) * 0.03)
    return { date, close: p, volume: withVolume ? Math.round(1e6 * (0.5 + r())) : null }
  })
}

const DATES = businessDays('2010-01-04', 1400)

function inputs(overrides: Partial<FeatureInputs> = {}): FeatureInputs {
  const gold = walk(DATES, 1200, 1)
  return {
    metal: 'gold',
    spot: gold,
    gold,
    silver: walk(DATES, 18, 2),
    dxy: walk(DATES, 80, 3),
    tnx: walk(DATES, 3, 4),
    vix: walk(DATES, 18, 5),
    spy: walk(DATES, 110, 6),
    etf: walk(DATES, 110, 7, true),
    macro: {
      DFII10: DATES.map((date, i) => ({ date, value: 1 + Math.sin(i / 30) })),
      GVZCLS: DATES.map((date, i) => ({ date, value: 15 + Math.cos(i / 20) })),
    },
    cot: [],
    curve: [],
    ...overrides,
  }
}

/** Replace every point dated after `cut` with garbage. */
function corruptAfter<T extends { date: string }>(xs: T[], cut: string, f: (x: T) => T): T[] {
  return xs.map((x) => (x.date > cut ? f(x) : x))
}

describe('buildFeatureMatrix: look-ahead safety', () => {
  it('a feature at t depends only on data dated <= t (macro: < t)', () => {
    const base = inputs()
    const m1 = buildFeatureMatrix(base)
    const cutIdx = 1000
    const cut = DATES[cutIdx]
    const scramble = (p: PricePoint) => ({ ...p, close: p.close * 3.7, volume: p.volume == null ? null : p.volume * 9 })
    const changed: FeatureInputs = {
      ...base,
      spot: corruptAfter(base.spot, cut, scramble),
      gold: corruptAfter(base.gold, cut, scramble),
      silver: corruptAfter(base.silver, cut, scramble),
      dxy: corruptAfter(base.dxy, cut, scramble),
      tnx: corruptAfter(base.tnx, cut, scramble),
      vix: corruptAfter(base.vix, cut, scramble),
      spy: corruptAfter(base.spy, cut, scramble),
      etf: corruptAfter(base.etf, cut, scramble),
      macro: {
        // Macro is lagged one day, so even the value dated t itself must not matter.
        DFII10: corruptAfter(base.macro.DFII10!, DATES[cutIdx - 1], (p) => ({ ...p, value: 99 })),
        GVZCLS: corruptAfter(base.macro.GVZCLS!, DATES[cutIdx - 1], (p) => ({ ...p, value: 99 })),
      },
    }
    const m2 = buildFeatureMatrix(changed)
    for (let i = 0; i <= cutIdx; i++) {
      for (const id of FEATURE_IDS) {
        expect(m2.rows[i].values[id], `${id} @ ${DATES[i]}`).toBe(m1.rows[i].values[id])
      }
    }
    // Sanity: the corruption does change later rows.
    expect(m2.rows[cutIdx + 5].values.mom5).not.toBe(m1.rows[cutIdx + 5].values.mom5)
  })

  it('macro series are lagged: the value dated t is not visible at t', () => {
    const m = buildFeatureMatrix(inputs())
    const i = 600
    // gvz_level at t equals the GVZ value dated t-1.
    expect(m.rows[i].values.gvz_level).toBeCloseTo(15 + Math.cos((i - 1) / 20), 10)
  })

  it('reports missing optional feeds with a reason', () => {
    const m = buildFeatureMatrix(inputs())
    expect(m.missing.cot_mm_z).toBe('COT not loaded yet')
    expect(m.missing.curve_spread_z).toBe('Contract curve not loaded yet')
    expect(m.missing.breakeven_chg20).toMatch(/T10YIE/)
    expect(m.missing.real_yield_chg20).toBeUndefined()
    expect(m.rows.every((r) => r.values.cot_mm_z === null)).toBe(true)
  })
})

describe('buildFeatureMatrix: targets', () => {
  it('y_ret(t) = ln(P[t+H]/P[t]) and the last H rows have no target', () => {
    const inp = inputs()
    const m = buildFeatureMatrix(inp)
    const H = m.horizon
    expect(H).toBe(20)
    const i = 300
    expect(m.rows[i].yRet).toBeCloseTo(Math.log(inp.spot[i + H].close / inp.spot[i].close), 12)
    expect(m.rows[i].yUp).toBe(m.rows[i].yRet! > 0 ? 1 : 0)
    const tail = m.rows.slice(-H)
    expect(tail.every((r) => r.yRet === null && r.yUp === null)).toBe(true)
    expect(m.rows[m.rows.length - H - 1].yRet).not.toBeNull()
  })

  it('momentum and moving-average features match their definitions', () => {
    const inp = inputs()
    const m = buildFeatureMatrix(inp)
    const i = 400
    const P = inp.spot.map((p) => p.close)
    expect(m.rows[i].values.mom20).toBeCloseTo(Math.log(P[i] / P[i - 20]), 12)
    const ma50 = P.slice(i - 49, i + 1).reduce((a, b) => a + b, 0) / 50
    expect(m.rows[i].values.ma50_dist).toBeCloseTo(P[i] / ma50 - 1, 12)
    expect(m.rows[10].values.mom20).toBeNull()
  })

  it('writes a CSV with header, blanks for missing, and y columns last', () => {
    const csv = matrixToCsv(buildFeatureMatrix(inputs()))
    const [header, first] = csv.split('\n')
    expect(header.split(',')).toEqual(['date', ...FEATURE_IDS, 'y_ret', 'y_up'])
    expect(first.startsWith('2010-01-04,,')).toBe(true)
  })
})

describe('COT lag', () => {
  it('a report is only usable strictly after its publication date', () => {
    const reports: CotPoint[] = []
    const tuesdays = businessDays('2012-01-03', 1000).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2)
    tuesdays.forEach((d, i) => {
      reports.push({ reportDate: d, publishedAt: null, openInterest: 1000, mmLong: 300 + (i % 17) * 10, mmShort: 100 })
    })
    const series = cotSeries(reports)
    expect(series.length).toBeGreaterThan(50)
    // publishedAt missing → assumed Friday (report + 3 days).
    const firstUsed = series[0]
    const reportIdx = tuesdays.indexOf(new Date(Date.parse(`${firstUsed.date}T00:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10))
    expect(reportIdx).toBeGreaterThanOrEqual(51)

    const friday = firstUsed.date
    const saturday = new Date(Date.parse(`${friday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const [atFriday, afterFriday] = asOf(series, [friday, saturday], {
      strict: true,
      maxStaleDays: 21,
    })
    expect(atFriday).toBeNull()
    expect(afterFriday).toBeCloseTo(firstUsed.value, 12)
  })

  it('uses an explicit publishedAt when present', () => {
    const tuesdays = businessDays('2012-01-03', 800).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2)
    const reports: CotPoint[] = tuesdays.map((d, i) => ({
      reportDate: d,
      publishedAt: `${d}T00:00:00Z`.replace(d, new Date(Date.parse(`${d}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)),
      openInterest: 1000,
      mmLong: 200 + ((i * 7) % 13) * 20,
      mmShort: 150,
    }))
    const s = cotSeries(reports)
    expect(s[0].date > reports[51].reportDate).toBe(true)
    const m = buildFeatureMatrix(inputs({ cot: reports }))
    const idx = m.rows.findIndex((r) => r.values.cot_mm_z !== null)
    expect(m.rows[idx].date > s[0].date).toBe(true)
    expect(m.missing.cot_mm_z).toBeUndefined()
  })
})

describe('helpers', () => {
  it('rsi is 100 on a monotone rise and in [0,100]', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(rsi(up).at(-1)).toBe(100)
    const r = rsi(walk(DATES.slice(0, 200), 100, 9).map((p) => p.close))
    expect(r.filter((x) => x != null).every((x) => x! >= 0 && x! <= 100)).toBe(true)
  })

  it('seasonal drift uses only completed windows from prior years', () => {
    const lp = DATES.map((_, i) => i * 0.001)
    const sd = seasonalDrift(DATES, lp, 20)
    // Needs 3 prior years: nothing in the first 3 years.
    const firstIdx = sd.findIndex((x) => x != null)
    expect(Number(DATES[firstIdx].slice(0, 4))).toBeGreaterThanOrEqual(2013)
    expect(sd[firstIdx]).toBeCloseTo(0.02, 10)
  })

  it('builds a front-three curve that rolls before first notice', () => {
    const contracts = [
      { symbol: 'GCG24', root: 'GC', year: 2024, month: 2, lastTrade: null, firstNotice: '2024-01-31' },
      { symbol: 'GCJ24', root: 'GC', year: 2024, month: 4, lastTrade: null, firstNotice: '2024-03-28' },
      { symbol: 'GCM24', root: 'GC', year: 2024, month: 6, lastTrade: null, firstNotice: '2024-05-31' },
      { symbol: 'GCH24', root: 'GC', year: 2024, month: 3, lastTrade: null, firstNotice: '2024-02-28' },
    ]
    const bar = (symbol: string, date: string, close: number) => ({
      symbol, date, close, open: null, high: null, low: null, volume: null, openInterest: null, source: 't',
    })
    const bars = [
      bar('GCG24', '2024-01-30', 2000), bar('GCJ24', '2024-01-30', 2010), bar('GCM24', '2024-01-30', 2020), bar('GCH24', '2024-01-30', 2005),
      bar('GCG24', '2024-01-31', 2001), bar('GCJ24', '2024-01-31', 2012), bar('GCM24', '2024-01-31', 2023),
    ]
    const cv = buildCurveSeries(bars, contracts, [2, 4, 6, 8, 10, 12])
    expect(cv).toHaveLength(2)
    expect(cv[0]).toMatchObject({ c1: 2000, c2: 2010, c3: 2020, monthsApart: 2 })
    expect(cv[1]).toMatchObject({ c1: 2012, c2: 2023, c3: null, monthsApart: 2 })
  })
})

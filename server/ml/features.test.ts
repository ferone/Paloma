import { describe, expect, it } from 'vitest'
import { ASSETS, UNIVERSE } from '../../shared/universe.js'
import { FEATURES, FEATURE_IDS, ML_INSTRUMENT, featureApplies, featuresFor, isOptionalFor, type FeatureSpec } from '../../shared/ml.js'
import { buildCurveSeries, buildOiSeries } from './curve.js'
import {
  asOf,
  buildFeatureMatrix,
  cotSeries,
  matrixToCsv,
  oiFeatures,
  rsi,
  seasonalDrift,
  type CotPoint,
  type FeatureInputs,
  type OiPoint,
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
    pair: { numerator: gold, denominator: walk(DATES, 18, 2) },
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
      pair: {
        numerator: corruptAfter(base.pair!.numerator, cut, scramble),
        denominator: corruptAfter(base.pair!.denominator, cut, scramble),
      },
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

describe('per-asset feature catalogue', () => {
  it('gold and silver keep the full catalogue in its original order', () => {
    expect(featuresFor('gold').map((f) => f.id)).toEqual(FEATURE_IDS)
    expect(featuresFor('silver').map((f) => f.id)).toEqual(FEATURE_IDS)
    expect(buildFeatureMatrix(inputs()).featureIds).toEqual(FEATURE_IDS)
  })

  it('filters by onlyFor, class and pair membership', () => {
    const gvz = FEATURES.find((f) => f.id === 'gvz_level')!
    expect(gvz.onlyFor).toEqual(['gold', 'silver'])
    const f = (p: Partial<FeatureSpec>): FeatureSpec => ({ id: 'x', label: 'x', group: 'macro', source: 'fred', optional: true, description: '', ...p })
    expect(featureApplies(f({ onlyFor: ['gold'] }), 'gold')).toBe(true)
    expect(featureApplies(f({ onlyFor: ['gold'] }), 'silver')).toBe(false)
    expect(featureApplies(f({ classes: ['crypto'] }), 'gold')).toBe(false)
    expect(featureApplies(f({ classes: ['precious'] }), 'silver')).toBe(true)
    expect(featureApplies(f({ needsPair: true }), 'silver')).toBe(true)
  })

  it('drops a feature that does not apply: no values, no missing entry, no CSV column', () => {
    const ids = FEATURE_IDS.filter((id) => id !== 'gvz_level' && id !== 'gsr_z252' && id !== 'cot_mm_z')
    const m = buildFeatureMatrix(inputs({ featureIds: ids, pair: null }))
    expect(m.featureIds).toEqual(ids)
    expect(Object.keys(m.rows[600].values)).toEqual(ids)
    expect(m.missing.cot_mm_z).toBeUndefined()
    const header = matrixToCsv(m).split(String.fromCharCode(10))[0].split(',')
    expect(header).toEqual(['date', ...ids, 'y_ret', 'y_up'])
  })

  it('derives the ML instrument from the front futures root', () => {
    expect(ML_INSTRUMENT).toMatchObject({ gold: 'GC.out', silver: 'SI.out' })
    expect(ML_INSTRUMENT).toEqual(Object.fromEntries(ASSETS.map((a) => [a, `${UNIVERSE[a].futures[0].root}.out`])))
  })
})

describe('COT lag', () => {
  it('a report is only usable strictly after its publication date', () => {
    const reports: CotPoint[] = []
    const tuesdays = businessDays('2012-01-03', 1000).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 2)
    tuesdays.forEach((d, i) => {
      reports.push({ reportDate: d, publishedAt: null, openInterest: 1000, specLong: 300 + (i % 17) * 10, specShort: 100 })
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
      specLong: 200 + ((i * 7) % 13) * 20,
      specShort: 150,
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

describe('core vs optional features', () => {
  const f = (id: string) => FEATURES.find((x) => x.id === id)!
  it('only the price/cross-asset/calendar set is core; late-starting feeds are optional for every asset', () => {
    // Core features set the training span (every core feature must exist on a row);
    // these feeds start years after the price history, so they may be missing.
    const late = ['etf_volume_z', 'seasonal_drift', 'real_yield_chg20', 'breakeven_chg20', 'usd_broad_mom20', 'gvz_level',
      'cot_mm_z', 'oi_z', 'oi_chg20', 'oi_price_div', 'curve_spread_z', 'curve_fly_z', 'carry_slope']
    for (const a of ASSETS) {
      for (const spec of featuresFor(a)) {
        expect(isOptionalFor(spec, a), `${spec.id} @ ${a}`).toBe(late.includes(spec.id))
      }
    }
    expect(isOptionalFor(f('mom20'), 'btc')).toBe(false)
    // Seasonal drift is not modelled for crypto: too few years to estimate a day-of-year effect.
    expect(featureApplies(f('seasonal_drift'), 'btc')).toBe(false)
    expect(featureApplies(f('seasonal_drift'), 'gold')).toBe(true)
  })
})

describe('open interest features', () => {
  // Front OI oscillates; total OI grows steadily, so its 20-session change is known in closed form.
  const oiPoints = (dates: string[]): OiPoint[] =>
    dates.map((date, i) => ({ date, front: 1000 + 100 * Math.sin(i / 15), total: 5000 * 1.001 ** i }))

  it('oiFeatures: 252-session z of front OI and 20-session % change of total OI, keyed by settlement date', () => {
    const pts = oiPoints(DATES.slice(0, 400))
    const r = oiFeatures(pts)!
    expect(r.z[0].date).toBe(DATES[251])
    expect(r.chg20[0].date).toBe(DATES[20])
    expect(r.chg20[0].value).toBeCloseTo(1.001 ** 20 - 1, 12)
    const w = pts.slice(300 - 251, 301).map((p) => p.front!)
    const m = w.reduce((a, b) => a + b, 0) / w.length
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1))
    expect(r.z.find((p) => p.date === DATES[300])!.value).toBeCloseTo((pts[300].front! - m) / sd, 10)
    expect(oiFeatures([])).toBeNull()
  })

  it('falls back to front-month OI when no total is available', () => {
    const pts = DATES.slice(0, 60).map((date, i) => ({ date, front: 100 + i, total: null }))
    const r = oiFeatures(pts)!
    expect(r.chg20[0].value).toBeCloseTo(120 / 100 - 1, 12)
  })

  it('OI for day d is used only from d+1, and price/OI agreement is sign(mom20) × sign(OI change)', () => {
    const pts = oiPoints(DATES)
    const m1 = buildFeatureMatrix(inputs({ oi: pts }))
    const r = oiFeatures(pts)!
    const i = 700
    // the value at row i is the OI-derived value of the PREVIOUS settlement date
    expect(m1.rows[i].values.oi_chg20).toBeCloseTo(r.chg20.find((p) => p.date === DATES[i - 1])!.value, 12)
    expect(m1.rows[i].values.oi_z).toBeCloseTo(r.z.find((p) => p.date === DATES[i - 1])!.value, 12)
    expect(m1.rows[i].values.oi_price_div).toBe(Math.sign(m1.rows[i].values.mom20!) * Math.sign(m1.rows[i].values.oi_chg20!))
    // corrupting OI dated t itself (and later) changes nothing at or before t
    const cut = 900
    const m2 = buildFeatureMatrix(inputs({ oi: corruptAfter(pts, DATES[cut - 1], (p) => ({ ...p, front: 1, total: 1e9 })) }))
    for (let k = 0; k <= cut; k++) {
      for (const id of ['oi_z', 'oi_chg20', 'oi_price_div']) expect(m2.rows[k].values[id], `${id} @ ${k}`).toBe(m1.rows[k].values[id])
    }
    expect(m2.rows[cut + 1].values.oi_chg20).not.toBe(m1.rows[cut + 1].values.oi_chg20)
  })

  it('reports missing OI with a reason and leaves the columns empty', () => {
    const m = buildFeatureMatrix(inputs())
    for (const id of ['oi_z', 'oi_chg20', 'oi_price_div']) {
      expect(m.missing[id]).toBe('Open interest not loaded yet')
      expect(m.rows.every((row) => row.values[id] === null)).toBe(true)
    }
  })

  it('buildOiSeries: total over every reporting contract, front = most-held live contract', () => {
    const contracts = [
      { symbol: 'GCG24', root: 'GC', year: 2024, month: 2, lastTrade: null, firstNotice: '2024-01-31' },
      { symbol: 'GCJ24', root: 'GC', year: 2024, month: 4, lastTrade: null, firstNotice: '2024-03-28' },
    ]
    const bar = (symbol: string, date: string, oi: number | null) => ({
      symbol, date, close: 2000, open: null, high: null, low: null, volume: null, openInterest: oi, source: 'databento',
    })
    const s = buildOiSeries(
      [bar('GCG24', '2024-01-29', 300), bar('GCJ24', '2024-01-29', 200), bar('GCG24', '2024-01-30', 100), bar('GCJ24', '2024-01-30', 400),
        bar('GCG24', '2024-01-31', null), bar('GCJ24', '2024-01-31', null)],
      contracts,
    )
    expect(s).toEqual([
      { date: '2024-01-29', front: 300, total: 500 },
      { date: '2024-01-30', front: 400, total: 500 },
    ])
    expect(buildOiSeries([], contracts)).toEqual([])
  })
})

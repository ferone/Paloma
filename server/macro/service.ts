import type { Metal } from '../../shared/universe.js'
import { METALS, MACRO_SYMBOLS, UNIVERSE } from '../../shared/universe.js'
import { ARTIFACTS, type MacroDashboardLite } from '../../shared/artifacts.js'
import type {
  CorrelationFactor,
  CorrelationFactorMeta,
  CorrelationResponse,
  CotMarket,
  CotResponse,
  MacroDashboard,
  MacroSeriesMeta,
  MacroSeriesSnapshot,
  SeriesPoint,
  SeriesResponse,
} from '../../shared/macro.js'
import type { Provenance } from '../../shared/api.js'
import { readDailyBars, upsertDailyBars, writeArtifact } from '../db/repo.js'
import { readCot, readMacro, upsertCot, upsertMacro } from '../db/shared-repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { env } from '../lib/env.js'
import { jobStatus, type JobContext } from '../jobs/registry.js'
import { COT_MARKETS, DERIVED_SERIES, FRED_SERIES, PRICE_SERIES, seriesMeta } from './catalog.js'
import { diffSeries, fetchFredSeries, ratioSeries, yoyPercent } from './fred.js'
import { categoryTable, deriveCot, fetchCotHistory } from './cot.js'
import {
  align,
  beta,
  changeOver,
  correlation,
  monthsBefore,
  percentileLast,
  rollingCorrelation,
  trailingYears,
  zScoreLast,
} from './analytics.js'
import { buildRegime, buildScorecard } from './scorecard.js'

// ── Reading ────────────────────────────────────────────────────────────────

/** Points for a catalog id: macro_series for FRED/derived ids, prices_daily (yahoo) closes for price ids. */
export function readSeriesPoints(id: string, from?: string): SeriesPoint[] {
  const px = PRICE_SERIES.find((p) => p.id === id)
  if (px) return readDailyBars(px.symbol, { source: 'yahoo', from }).map((b) => ({ date: b.date, value: b.close }))
  return readMacro(id, from).map((p) => ({ date: p.date, value: p.value }))
}

function sourceLabel(meta: MacroSeriesMeta): string {
  if (meta.source === 'fred') return `FRED ${meta.id}`
  if (meta.id === 'CPI_YOY') return 'FRED CPIAUCSL (YoY derived)'
  if (meta.id === 'M2_YOY') return 'FRED M2SL (YoY derived)'
  if (meta.id === 'CURVE_2S10S') return 'FRED DGS10 − DGS2'
  if (meta.id === 'GSR') return 'Yahoo GC=F / SI=F'
  if (meta.id === 'DXY') return 'Yahoo DX-Y.NYB'
  const px = PRICE_SERIES.find((p) => p.id === meta.id)
  return px ? `Yahoo ${px.symbol}` : meta.source
}

export function provenanceFor(meta: MacroSeriesMeta, points: SeriesPoint[]): Provenance {
  return { source: sourceLabel(meta), asOf: points.length ? points[points.length - 1].date : null }
}

/** Latest value, 1m/3m change, 3y z-score and percentile. PURE given points. */
export function snapshot(meta: MacroSeriesMeta, points: SeriesPoint[]): MacroSeriesSnapshot {
  const last = points[points.length - 1]
  const window = trailingYears(points, 3).map((p) => p.value)
  return {
    ...meta,
    latest: last?.value ?? null,
    latestDate: last?.date ?? null,
    change1m: changeOver(points, 1, meta.changeKind),
    change3m: changeOver(points, 3, meta.changeKind),
    z: zScoreLast(window, meta.frequency === 'monthly' ? 12 : 60),
    percentile: percentileLast(window, meta.frequency === 'monthly' ? 12 : 60),
    observations: points.length,
    provenance: provenanceFor(meta, points),
  }
}

const cotMarketOf = (metal: Metal): CotMarket => UNIVERSE[metal].cotMarket as CotMarket

export function cotResponse(market: CotMarket): CotResponse {
  const rows = readCot(market)
  const history = deriveCot(rows)
  const last = rows[rows.length - 1]
  const lastPt = history[history.length - 1]
  const prior = rows.length > 1 ? rows[rows.length - 2] : null
  return {
    market,
    marketName: COT_MARKETS[market].name,
    latest: last
      ? {
          reportDate: last.reportDate,
          publishedAt: last.publishedAt,
          openInterest: last.openInterest,
          changeOpenInterest: prior && last.openInterest != null && prior.openInterest != null ? last.openInterest - prior.openInterest : null,
          categories: categoryTable(last, prior),
          mmNetPctOi: lastPt.mmNetPctOi,
          mmPercentile3y: lastPt.mmPercentile3y,
          mmZ3y: lastPt.mmZ3y,
        }
      : null,
    history,
    provenance: {
      source: `CFTC disaggregated futures-only COT · ${COT_MARKETS[market].name} (${COT_MARKETS[market].code})`,
      asOf: last?.reportDate ?? null,
      note: last?.publishedAt ? `released ${last.publishedAt.slice(0, 10)}` : undefined,
    },
  }
}

const DASHBOARD_SERIES = [...FRED_SERIES, ...DERIVED_SERIES]

export function buildDashboard(metal: Metal): MacroDashboard {
  const since = monthsBefore(new Date().toISOString().slice(0, 10), 12 * 4)
  const snaps = DASHBOARD_SERIES.map((m) => snapshot(m, readSeriesPoints(m.id, since)))
  const byId = new Map(snaps.map((s) => [s.id, s]))
  const cotHist = deriveCot(readCot(cotMarketOf(metal)))
  const cot = cotHist.length ? cotHist[cotHist.length - 1] : null
  const scorecard = buildScorecard(metal, byId, cot)
  const regime = buildRegime(metal, byId)
  const dates = snaps.map((s) => s.latestDate).filter((d): d is string => !!d)
  const tailwinds = scorecard.filter((r) => r.stance === 'tailwind').length
  const headwinds = scorecard.filter((r) => r.stance === 'headwind').length
  return {
    metal,
    asOf: dates.length ? dates.sort().at(-1)! : null,
    regime,
    scorecard,
    netScore: tailwinds - headwinds,
    tailwinds,
    headwinds,
    series: snaps,
    refresh: {
      fred: jobStatus('macro.fred') ?? null,
      cot: jobStatus('macro.cot') ?? null,
      all: jobStatus('macro.refresh') ?? null,
    },
    empty: snaps.every((s) => s.latest == null) && !cot,
  }
}

export function seriesResponse(ids: string[], from?: string): SeriesResponse {
  return {
    series: ids
      .map((id) => seriesMeta(id))
      .filter((m): m is MacroSeriesMeta => !!m)
      .map((meta) => {
        const points = readSeriesPoints(meta.id, from)
        return { ...meta, points, provenance: provenanceFor(meta, points) }
      }),
  }
}

// ── Correlations ───────────────────────────────────────────────────────────

export const FACTORS: CorrelationFactorMeta[] = [
  { id: 'gold', label: 'Gold', transform: 'daily log return (GC=F)' },
  { id: 'silver', label: 'Silver', transform: 'daily log return (SI=F)' },
  { id: 'realYield', label: 'Real yield', transform: 'daily change in DFII10 (pp)' },
  { id: 'dxy', label: 'Dollar (DXY)', transform: 'daily log return (DX-Y.NYB)' },
  { id: 'vix', label: 'VIX', transform: 'daily change in VIXCLS (points)' },
  { id: 'spy', label: 'S&P 500 (SPY)', transform: 'daily log return (SPY)' },
]

const FACTOR_SOURCE: Record<CorrelationFactor, { id: string; kind: 'ret' | 'diff' }> = {
  gold: { id: 'GOLD', kind: 'ret' },
  silver: { id: 'SILVER', kind: 'ret' },
  realYield: { id: 'DFII10', kind: 'diff' },
  dxy: { id: 'DXY', kind: 'ret' },
  vix: { id: 'VIXCLS', kind: 'diff' },
  spy: { id: 'SPY', kind: 'ret' },
}

/**
 * Align factor LEVELS on common dates first, then transform (returns / diffs)
 * so every observation spans the same interval for all factors.
 */
export function factorMatrix(levels: Record<CorrelationFactor, SeriesPoint[]>): { dates: string[]; cols: Record<CorrelationFactor, number[]> } {
  const ids = FACTORS.map((f) => f.id)
  const { dates, cols } = align(ids.map((id) => levels[id]))
  const out = {} as Record<CorrelationFactor, number[]>
  ids.forEach((id, k) => {
    const c = cols[k]
    const kind = FACTOR_SOURCE[id].kind
    const t: number[] = []
    for (let i = 1; i < c.length; i++) t.push(kind === 'ret' ? (c[i - 1] > 0 && c[i] > 0 ? Math.log(c[i] / c[i - 1]) : 0) : c[i] - c[i - 1])
    out[id] = t
  })
  return { dates: dates.slice(1), cols: out }
}

export function computeCorrelations(
  metal: Metal,
  window: number,
  levels: Record<CorrelationFactor, SeriesPoint[]>,
  maxPoints = 756,
): Omit<CorrelationResponse, 'provenance'> {
  const { dates, cols } = factorMatrix(levels)
  const others = FACTORS.map((f) => f.id).filter((id) => id !== metal)
  const y = cols[metal]
  const rollingBy = new Map(others.map((f) => [f, rollingCorrelation(y, cols[f], window)]))
  const start = Math.max(window - 1, dates.length - maxPoints)
  const rolling = []
  for (let i = start; i < dates.length; i++) {
    const values: Partial<Record<CorrelationFactor, number | null>> = {}
    for (const f of others) values[f] = rollingBy.get(f)![i]
    rolling.push({ date: dates[i], values })
  }
  const lo = Math.max(0, dates.length - window)
  const win = (id: CorrelationFactor) => cols[id].slice(lo)
  const ids = FACTORS.map((f) => f.id)
  const matrix = ids.map((a) => ids.map((b) => (a === b ? (dates.length - lo >= 3 ? 1 : null) : correlation(win(a), win(b)))))
  const betas = others.map((f) => ({
    factor: f,
    correlation: correlation(win(metal), win(f)),
    beta: beta(win(metal), win(f)),
    n: dates.length - lo,
  }))
  return { metal, window, asOf: dates.at(-1) ?? null, factors: FACTORS, rolling, matrix: { factors: ids, values: matrix }, betas }
}

export function correlationResponse(metal: Metal, window: number): CorrelationResponse {
  const from = monthsBefore(new Date().toISOString().slice(0, 10), 12 * 5)
  const levels = Object.fromEntries(
    FACTORS.map((f) => [f.id, readSeriesPoints(FACTOR_SOURCE[f.id].id, from)]),
  ) as Record<CorrelationFactor, SeriesPoint[]>
  const res = computeCorrelations(metal, window, levels)
  return {
    ...res,
    provenance: {
      source: 'Yahoo GC=F, SI=F, DX-Y.NYB, SPY · FRED DFII10, VIXCLS',
      asOf: res.asOf,
      note: `${window}-day window on dates common to all six series`,
    },
  }
}

// ── Refresh jobs ───────────────────────────────────────────────────────────

const noop: JobContext = { progress: () => {}, log: () => {} }
const HISTORY_FROM = '2000-01-01'

async function fetchYahooCloses(symbol: string): Promise<SeriesPoint[]> {
  const bars = (await getHistorical(symbol, { range: '5Y', interval: '1d' })) as { date: string; open: number; high: number; low: number; close: number; volume: number }[]
  const clean = bars.filter((b) => b.close > 0)
  const byDate = new Map<string, (typeof clean)[number]>()
  for (const b of clean) byDate.set(b.date.slice(0, 10), b)
  upsertDailyBars(
    [...byDate.entries()].map(([date, b]) => ({
      symbol,
      date,
      open: b.open || null,
      high: b.high || null,
      low: b.low || null,
      close: b.close,
      volume: b.volume || null,
      source: 'yahoo',
    })),
  )
  return [...byDate.entries()].map(([date, b]) => ({ date, value: b.close })).sort((a, b) => (a.date < b.date ? -1 : 1))
}

export async function refreshFred(ctx: JobContext = noop): Promise<string> {
  const errors: string[] = []
  let n = 0
  let via = ''
  const fetched = new Map<string, SeriesPoint[]>()
  for (const [i, s] of FRED_SERIES.entries()) {
    ctx.progress(i / (FRED_SERIES.length + 4), `FRED ${s.id}`)
    try {
      const r = await fetchFredSeries(s.id, { apiKey: env.fredKey || undefined, from: HISTORY_FROM })
      via = r.via
      fetched.set(s.id, r.points)
      n += upsertMacro(r.points.map((p) => ({ seriesId: s.id, date: p.date, value: p.value, source: 'fred' })))
    } catch (err) {
      errors.push(`${s.id}: ${err instanceof Error ? err.message : String(err)}`)
      ctx.log(`FRED ${s.id} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const pts = (id: string) => fetched.get(id) ?? readMacro(id).map((p) => ({ date: p.date, value: p.value }))
  const derived: [string, SeriesPoint[]][] = [
    ['CPI_YOY', yoyPercent(pts('CPIAUCSL'))],
    ['M2_YOY', yoyPercent(pts('M2SL'))],
    ['CURVE_2S10S', diffSeries(pts('DGS10'), pts('DGS2'))],
  ]
  for (const [id, p] of derived) n += upsertMacro(p.map((x) => ({ seriesId: id, date: x.date, value: x.value, source: 'derived' })))

  // Market-derived series from Yahoo (cached into prices_daily).
  const yahoo = new Map<string, SeriesPoint[]>()
  const syms = [UNIVERSE.gold.spot, UNIVERSE.silver.spot, MACRO_SYMBOLS.dxy, MACRO_SYMBOLS.spx]
  for (const [i, sym] of syms.entries()) {
    ctx.progress((FRED_SERIES.length + i) / (FRED_SERIES.length + 4), `Yahoo ${sym}`)
    try {
      yahoo.set(sym, await fetchYahooCloses(sym))
    } catch (err) {
      errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const gold = yahoo.get(UNIVERSE.gold.spot)
  const silver = yahoo.get(UNIVERSE.silver.spot)
  if (gold && silver) n += upsertMacro(ratioSeries(gold, silver).map((p) => ({ seriesId: 'GSR', date: p.date, value: p.value, source: 'yahoo' })))
  const dxy = yahoo.get(MACRO_SYMBOLS.dxy)
  if (dxy) n += upsertMacro(dxy.map((p) => ({ seriesId: 'DXY', date: p.date, value: p.value, source: 'yahoo' })))

  const ok = FRED_SERIES.length - errors.filter((e) => FRED_SERIES.some((s) => e.startsWith(`${s.id}:`))).length
  const msg = `FRED ${ok}/${FRED_SERIES.length} series via ${via || 'n/a'} · ${n} points upserted${errors.length ? ` · ${errors.length} error(s): ${errors.join('; ').slice(0, 300)}` : ''}`
  if (ok === 0) throw new Error(msg)
  return msg
}

export async function refreshCot(ctx: JobContext = noop): Promise<string> {
  const token = env.cftcAppToken || undefined
  const parts: string[] = []
  const markets: CotMarket[] = ['GOLD', 'SILVER']
  for (const [i, m] of markets.entries()) {
    ctx.progress(i / markets.length, `CFTC COT ${m}`)
    const rows = await fetchCotHistory(m, { appToken: token })
    upsertCot(rows)
    parts.push(`${m} ${rows.length} reports through ${rows.at(-1)?.reportDate ?? 'n/a'}`)
  }
  return `COT: ${parts.join(' · ')}`
}

/** Publish the cross-domain summary (ARTIFACTS.macroDashboard). Core fields are gold-centric; byMetal carries both. */
export function publishMacroArtifact(): MacroDashboardLite {
  const byMetal = Object.fromEntries(
    METALS.map((m) => {
      const d = buildDashboard(m)
      return [
        m,
        {
          regime: d.regime.label,
          netScore: d.netScore,
          drivers: d.scorecard.map((r) => ({ id: r.id, label: r.label, value: r.value, change: r.change3m, stance: r.stance })),
        },
      ]
    }),
  )
  const gold = buildDashboard('gold')
  const lite: MacroDashboardLite & { byMetal: typeof byMetal } = {
    asOf: gold.asOf ?? new Date().toISOString().slice(0, 10),
    regime: gold.regime.label,
    drivers: byMetal.gold.drivers,
    byMetal,
  }
  writeArtifact(ARTIFACTS.macroDashboard, lite)
  return lite
}

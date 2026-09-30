import { ASSETS, MACRO_SYMBOLS, RELATIVE_VALUE_PAIRS, UNIVERSE, assetsInClass, type AssetId, type AssetSpec, type CotSpec } from '../../shared/universe.js'
import { ARTIFACTS, type MacroDashboardLite } from '../../shared/artifacts.js'
import type {
  CorrelationFactor,
  CorrelationFactorMeta,
  CorrelationResponse,
  CotMarket,
  CotResponse,
  MacroDashboard,
  MacroFactor,
  MacroSeriesMeta,
  MacroSeriesSnapshot,
  SeriesPoint,
  SeriesResponse,
} from '../../shared/macro.js'
import type { Provenance } from '../../shared/api.js'
import { readDailyBars, upsertDailyBars, writeArtifact } from '../db/repo.js'
import { readMacro, upsertMacro } from '../db/shared-repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { env } from '../lib/env.js'
import { jobStatus, type JobContext } from '../jobs/registry.js'
import { DERIVED_SERIES, FRED_SERIES, PRICE_SERIES, priceSeriesId, ratioSeriesId, seriesActive, seriesForClass, seriesMeta } from './catalog.js'
import { diffSeries, fetchFredSeries, ratioSeries, yoyPercent } from './fred.js'
import { COT_FAMILIES, categoryTable, deriveCot, fetchCotReports, speculatorOf } from './cot.js'
import { readCotReports, upsertCotReports } from './cot-repo.js'
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
  if (meta.id === 'INDPRO_YOY') return 'FRED INDPRO (YoY derived)'
  if (meta.id === 'CURVE_2S10S') return 'FRED DGS10 − DGS2'
  const pair = RELATIVE_VALUE_PAIRS.find((p) => ratioSeriesId(p) === meta.id)
  if (pair) return `Yahoo ${UNIVERSE[pair.numerator].spot} / ${UNIVERSE[pair.denominator].spot}`
  if (meta.id === 'DXY') return 'Yahoo DX-Y.NYB'
  if (meta.id === 'QQQ') return 'Yahoo QQQ'
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

// ── COT ────────────────────────────────────────────────────────────────────

/** Asset whose COT market key is `market` (case-insensitive). */
export function assetOfCotMarket(market: string): AssetSpec | undefined {
  const m = market.toUpperCase()
  return ASSETS.map((a) => UNIVERSE[a]).find((s) => s.cot?.market.toUpperCase() === m)
}

/** Every distinct COT market in the universe. */
export function cotMarkets(): CotSpec[] {
  const seen = new Map<string, CotSpec>()
  for (const a of ASSETS) {
    const c = UNIVERSE[a].cot
    if (c && !seen.has(`${c.report}:${c.market}`)) seen.set(`${c.report}:${c.market}`, c)
  }
  return [...seen.values()]
}

const marketNameOf = (spec: AssetSpec): string => spec.futures[0]?.name ?? spec.label

/** COT positioning for a universe market; null when the market is not in the universe. */
export function cotResponse(market: CotMarket): CotResponse | null {
  const spec = assetOfCotMarket(market)
  if (!spec?.cot) return null
  const { report, code } = spec.cot
  const fam = COT_FAMILIES[report]
  const reports = readCotReports(spec.cot.market, report)
  const history = deriveCot(reports)
  const last = reports.at(-1)
  const lastPt = history.at(-1)
  const prior = reports.length > 1 ? reports[reports.length - 2] : null
  return {
    market: spec.cot.market,
    marketName: marketNameOf(spec),
    report,
    speculator: speculatorOf(report),
    latest:
      last && lastPt
        ? {
            reportDate: last.reportDate,
            publishedAt: last.publishedAt,
            openInterest: last.openInterest,
            changeOpenInterest: prior && last.openInterest != null && prior.openInterest != null ? last.openInterest - prior.openInterest : null,
            categories: categoryTable(last, prior),
            specNetPctOi: lastPt.specNetPctOi,
            specPercentile3y: lastPt.specPercentile3y,
            specZ3y: lastPt.specZ3y,
          }
        : null,
    history,
    provenance: {
      source: `${fam.label} · ${marketNameOf(spec)} (${code})`,
      asOf: last?.reportDate ?? null,
      note: last?.publishedAt ? `released ${last.publishedAt.slice(0, 10)}` : undefined,
    },
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────

const DASHBOARD_SERIES = [...FRED_SERIES, ...DERIVED_SERIES]

export function buildDashboard(asset: AssetId): MacroDashboard {
  const spec = UNIVERSE[asset]
  const since = monthsBefore(new Date().toISOString().slice(0, 10), 12 * 4)
  const snaps = DASHBOARD_SERIES.filter((m) => seriesForClass(m.id, spec.assetClass)).map((m) => snapshot(m, readSeriesPoints(m.id, since)))
  const byId = new Map(snaps.map((s) => [s.id, s]))
  const cotHist = spec.cot ? deriveCot(readCotReports(spec.cot.market, spec.cot.report)) : []
  const cot = cotHist.length ? cotHist[cotHist.length - 1] : null
  const scorecard = buildScorecard(asset, byId, cot)
  const regime = buildRegime(asset, byId)
  const dates = snaps.map((s) => s.latestDate).filter((d): d is string => !!d)
  const tailwinds = scorecard.filter((r) => r.stance === 'tailwind').length
  const headwinds = scorecard.filter((r) => r.stance === 'headwind').length
  return {
    asset,
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

export const MACRO_FACTORS: CorrelationFactorMeta[] = [
  { id: 'realYield', label: 'Real yield', transform: 'daily change in DFII10 (pp)' },
  { id: 'dxy', label: 'Dollar (DXY)', transform: 'daily log return (DX-Y.NYB)' },
  { id: 'vix', label: 'VIX', transform: 'daily change in VIXCLS (points)' },
  { id: 'spy', label: 'S&P 500 (SPY)', transform: 'daily log return (SPY)' },
]

const MACRO_SOURCE: Record<MacroFactor, { id: string; kind: 'ret' | 'diff' }> = {
  realYield: { id: 'DFII10', kind: 'diff' },
  dxy: { id: 'DXY', kind: 'ret' },
  vix: { id: 'VIXCLS', kind: 'diff' },
  spy: { id: 'SPY', kind: 'ret' },
}

const isAssetFactor = (f: CorrelationFactor): f is AssetId => !MACRO_FACTORS.some((m) => m.id === f)

/**
 * Assets an asset is correlated against: its relative-value partners where a
 * pair exists, otherwise its own class peers.
 */
export function assetPeers(a: AssetId): AssetId[] {
  const partners = RELATIVE_VALUE_PAIRS.flatMap((p) => (p.numerator === a ? [p.denominator] : p.denominator === a ? [p.numerator] : []))
  // Prefer same-class partners (gold ↔ silver). A cross-class pair (bitcoin/gold)
  // only supplies peers to an asset with no same-class partner, so adding a new
  // asset never changes an existing asset's correlation window.
  const cls = UNIVERSE[a].assetClass
  const sameClass = partners.filter((p) => UNIVERSE[p].assetClass === cls)
  if (sameClass.length) return sameClass
  const classPeers = assetsInClass(cls).filter((x) => x !== a)
  if (classPeers.length) return classPeers
  return partners
}

/** The asset, its peers (universe order), then the market factors. */
export function correlationFactors(a: AssetId): CorrelationFactorMeta[] {
  const peers = new Set([a, ...assetPeers(a)])
  const assets = ASSETS.filter((x) => peers.has(x)).map((x) => ({
    id: x,
    label: UNIVERSE[x].label,
    transform: `daily log return (${UNIVERSE[x].spot})`,
  }))
  return [...assets, ...MACRO_FACTORS]
}

function factorSource(f: CorrelationFactor): { id: string; kind: 'ret' | 'diff' } {
  return isAssetFactor(f) ? { id: priceSeriesId(f), kind: 'ret' } : MACRO_SOURCE[f]
}

/**
 * Align factor LEVELS on common dates first, then transform (returns / diffs)
 * so every observation spans the same interval for all factors.
 */
export function factorMatrix(
  ids: CorrelationFactor[],
  levels: Partial<Record<CorrelationFactor, SeriesPoint[]>>,
): { dates: string[]; cols: Partial<Record<CorrelationFactor, number[]>> } {
  const { dates, cols } = align(ids.map((id) => levels[id] ?? []))
  const out: Partial<Record<CorrelationFactor, number[]>> = {}
  ids.forEach((id, k) => {
    const c = cols[k]
    const kind = factorSource(id).kind
    const t: number[] = []
    for (let i = 1; i < c.length; i++) t.push(kind === 'ret' ? (c[i - 1] > 0 && c[i] > 0 ? Math.log(c[i] / c[i - 1]) : 0) : c[i] - c[i - 1])
    out[id] = t
  })
  return { dates: dates.slice(1), cols: out }
}

export function computeCorrelations(
  asset: AssetId,
  window: number,
  levels: Partial<Record<CorrelationFactor, SeriesPoint[]>>,
  maxPoints = 756,
): Omit<CorrelationResponse, 'provenance'> {
  // A factor with no data yet (e.g. a new asset before its first refresh) is
  // dropped rather than emptying the aligned date axis for every factor.
  const factors = correlationFactors(asset).filter((f) => f.id === asset || (levels[f.id]?.length ?? 0) > 0)
  const ids = factors.map((f) => f.id)
  const { dates, cols } = factorMatrix(ids, levels)
  const col = (id: CorrelationFactor) => cols[id] ?? []
  const others = ids.filter((id) => id !== asset)
  const y = col(asset)
  const rollingBy = new Map(others.map((f) => [f, rollingCorrelation(y, col(f), window)]))
  const start = Math.max(window - 1, dates.length - maxPoints)
  const rolling = []
  for (let i = start; i < dates.length; i++) {
    const values: Partial<Record<CorrelationFactor, number | null>> = {}
    for (const f of others) values[f] = rollingBy.get(f)![i]
    rolling.push({ date: dates[i], values })
  }
  const lo = Math.max(0, dates.length - window)
  const win = (id: CorrelationFactor) => col(id).slice(lo)
  const matrix = ids.map((a) => ids.map((b) => (a === b ? (dates.length - lo >= 3 ? 1 : null) : correlation(win(a), win(b)))))
  const betas = others.map((f) => ({
    factor: f,
    correlation: correlation(win(asset), win(f)),
    beta: beta(win(asset), win(f)),
    n: dates.length - lo,
  }))
  return { asset, window, asOf: dates.at(-1) ?? null, factors, rolling, matrix: { factors: ids, values: matrix }, betas }
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

export function correlationResponse(asset: AssetId, window: number): CorrelationResponse {
  const from = monthsBefore(new Date().toISOString().slice(0, 10), 12 * 5)
  const factors = correlationFactors(asset)
  const levels: Partial<Record<CorrelationFactor, SeriesPoint[]>> = {}
  for (const f of factors) levels[f.id] = readSeriesPoints(factorSource(f.id).id, from)
  const res = computeCorrelations(asset, window, levels)
  const spots = factors.filter((f) => isAssetFactor(f.id)).map((f) => UNIVERSE[f.id as AssetId].spot)
  return {
    ...res,
    provenance: {
      source: `Yahoo ${[...spots, 'DX-Y.NYB', 'SPY'].join(', ')} · FRED DFII10, VIXCLS`,
      asOf: res.asOf,
      note: `${window}-day window on dates common to all ${NUMBER_WORDS[factors.length] ?? factors.length} series`,
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

/** Yahoo symbols the macro refresh caches: every asset's reference price, DXY, SPY (+ QQQ once crypto exists). */
export function macroYahooSymbols(): string[] {
  const syms = [...ASSETS.map((a) => UNIVERSE[a].spot), MACRO_SYMBOLS.dxy, MACRO_SYMBOLS.spx]
  if (seriesActive('QQQ')) syms.push('QQQ')
  return [...new Set(syms)]
}

export async function refreshFred(ctx: JobContext = noop): Promise<string> {
  const errors: string[] = []
  let n = 0
  let via = ''
  const fetched = new Map<string, SeriesPoint[]>()
  const fredSeries = FRED_SERIES.filter((s) => seriesActive(s.id))
  const syms = macroYahooSymbols()
  const steps = fredSeries.length + syms.length
  for (const [i, s] of fredSeries.entries()) {
    ctx.progress(i / steps, `FRED ${s.id}`)
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
  const derived: [string, () => SeriesPoint[]][] = [
    ['CPI_YOY', () => yoyPercent(pts('CPIAUCSL'))],
    ['M2_YOY', () => yoyPercent(pts('M2SL'))],
    ['CURVE_2S10S', () => diffSeries(pts('DGS10'), pts('DGS2'))],
    ['INDPRO_YOY', () => yoyPercent(pts('INDPRO'))],
  ]
  for (const [id, build] of derived) {
    if (!seriesActive(id)) continue
    n += upsertMacro(build().map((x) => ({ seriesId: id, date: x.date, value: x.value, source: 'derived' })))
  }

  // Market-derived series from Yahoo (cached into prices_daily).
  const yahoo = new Map<string, SeriesPoint[]>()
  for (const [i, sym] of syms.entries()) {
    ctx.progress((fredSeries.length + i) / steps, `Yahoo ${sym}`)
    try {
      yahoo.set(sym, await fetchYahooCloses(sym))
    } catch (err) {
      errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const p of RELATIVE_VALUE_PAIRS) {
    const num = yahoo.get(UNIVERSE[p.numerator].spot)
    const den = yahoo.get(UNIVERSE[p.denominator].spot)
    if (num && den) n += upsertMacro(ratioSeries(num, den).map((x) => ({ seriesId: ratioSeriesId(p), date: x.date, value: x.value, source: 'yahoo' })))
  }
  const store = (seriesId: string, symbol: string) => {
    const s = yahoo.get(symbol)
    if (s) n += upsertMacro(s.map((p) => ({ seriesId, date: p.date, value: p.value, source: 'yahoo' })))
  }
  store('DXY', MACRO_SYMBOLS.dxy)
  if (seriesActive('QQQ')) store('QQQ', 'QQQ')

  const ok = fredSeries.length - errors.filter((e) => fredSeries.some((s) => e.startsWith(`${s.id}:`))).length
  const msg = `FRED ${ok}/${fredSeries.length} series via ${via || 'n/a'} · ${n} points upserted${errors.length ? ` · ${errors.length} error(s): ${errors.join('; ').slice(0, 300)}` : ''}`
  if (ok === 0) throw new Error(msg)
  return msg
}

export async function refreshCot(ctx: JobContext = noop, fetchImpl?: typeof fetch): Promise<string> {
  const token = env.cftcAppToken || undefined
  const parts: string[] = []
  const markets = cotMarkets()
  for (const [i, c] of markets.entries()) {
    ctx.progress(i / markets.length, `CFTC COT ${c.market}`)
    const reports = await fetchCotReports(c, { appToken: token, fetchImpl })
    upsertCotReports(reports)
    parts.push(`${c.market} ${reports.length} reports through ${reports.at(-1)?.reportDate ?? 'n/a'}`)
  }
  return `COT: ${parts.join(' · ')}`
}

/**
 * Publish the cross-domain summary (ARTIFACTS.macroDashboard). The core fields
 * describe the universe's first asset; byMetal carries every asset.
 */
export function publishMacroArtifact(): MacroDashboardLite {
  const dashboards = new Map(ASSETS.map((m) => [m, buildDashboard(m)]))
  const byMetal = Object.fromEntries(
    ASSETS.map((m) => {
      const d = dashboards.get(m)!
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
  const lead = ASSETS[0]
  const lite: MacroDashboardLite & { byMetal: typeof byMetal } = {
    asOf: dashboards.get(lead)!.asOf ?? new Date().toISOString().slice(0, 10),
    regime: byMetal[lead].regime,
    drivers: byMetal[lead].drivers,
    byMetal,
  }
  writeArtifact(ARTIFACTS.macroDashboard, lite)
  return lite
}

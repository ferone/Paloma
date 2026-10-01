// Response builders: turn an engine run into the /api/portfolio shapes.
import type { Provenance } from '../../shared/api.js'
import { fallbackWarnings } from './fallback.js'
import type { AssetId, AssetSpec } from '../../shared/universe.js'
import { ASSETS, MACRO_SYMBOLS, UNIVERSE, physicalAssets } from '../../shared/universe.js'
import {
  BENCHMARKS,
  EXTERNAL_FLOW_TYPES,
  SLEEVE_LABEL,
  assetBucketLabel,
  exposureUnitOf,
  sleeveOfKind,
  spotLabel,
  type AssetExposure,
  type PhysicalItem,
  type AttributionResponse,
  type AttributionRow,
  type BenchmarkId,
  type HoldingView,
  type HoldingsResponse,
  type NavSeriesResponse,
  type PerformanceResponse,
  type PerformanceStats,
  type PortfolioSummary,
  type RiskResponse,
  type Sleeve,
  type UnitsResponse,
  type VaultResponse,
} from '../../shared/portfolio.js'
import { CASH_KEY, multiplierOf, valuePosition } from './engine/ledger.js'
import {
  alignSeries,
  annualize,
  annualizedVol,
  betaCorrelation,
  chainLink,
  daysBetween,
  drawdowns,
  historicalVar,
  mean,
  monthlyReturns,
  parametricVar,
  returnSince,
  rollingVol,
  sharpe,
  sortino,
  xirr,
  type DatedValue,
} from './engine/perf.js'
import { isoDaysAgo, loadPrices } from './prices.js'
import type { Computed } from './service.js'

const fin = (x: number) => (Number.isFinite(x) ? x : null)
const SOURCE = 'Fund ledger · Yahoo Finance daily closes'

function provenance(c: Computed, note?: string): Provenance {
  const asOf = c.run.points.at(-1)?.date ?? null
  const stale = c.prices.stale.length ? `stale prices: ${c.prices.stale.join(', ')}` : undefined
  return { source: SOURCE, asOf, note: [note, stale].filter(Boolean).join(' · ') || undefined }
}

function npuSeries(c: Computed): DatedValue[] {
  return c.run.points.filter((p) => p.navPerUnit != null).map((p) => ({ date: p.date, value: p.navPerUnit! }))
}

function spotOf(c: Computed, asset: AssetId, date: string): number | null {
  return c.prices.book.close(UNIVERSE[asset].spot, date)?.price ?? null
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export function buildHoldingViews(c: Computed): HoldingView[] {
  const last = c.run.points.at(-1)
  if (!last) return []
  const asOf = last.date
  const out: HoldingView[] = []
  for (const [id, p] of c.run.positions) {
    if (p.lots.length === 0) continue
    const inst = c.instruments.get(id)!
    const mark = c.run.marks.get(id)
    const price = mark?.price ?? null
    const mult = multiplierOf(inst)
    const v = price != null ? valuePosition(inst, p.lots, price, c.settings.physicalHaircut) : { value: 0, notional: 0, exposureUnits: null }
    const qty = p.lots.reduce((s, l) => s + l.qty, 0)
    const isFut = inst.kind === 'future'
    const costBasis = isFut ? p.lots.reduce((s, l) => s + Math.abs(l.qty) * mult * l.unitCost, 0) : p.lots.reduce((s, l) => s + l.qty * l.unitCost, 0)
    const avgCost = Math.abs(qty) > 1e-9 ? p.lots.reduce((s, l) => s + l.qty * l.unitCost, 0) / qty : null
    const haircut = inst.kind === 'physical' ? 1 - c.settings.physicalHaircut : 1
    const lots = p.lots.map((l) => {
      const mv = price == null ? 0 : isFut ? l.qty * mult * (price - l.unitCost) : l.qty * price * haircut
      const cb = isFut ? Math.abs(l.qty) * mult * l.unitCost : l.qty * l.unitCost
      return {
        txnId: l.txnId,
        accountId: l.accountId,
        openDate: l.openDate,
        quantity: l.qty,
        unitCost: l.unitCost,
        costBasis: cb,
        marketValue: mv,
        unrealizedPnl: isFut ? mv : mv - cb,
        holdingDays: daysBetween(l.openDate, asOf),
      }
    })
    let exposureUnits = v.exposureUnits
    if (exposureUnits == null && inst.asset && inst.kind === 'etf' && price != null) {
      const spot = spotOf(c, inst.asset, asOf)
      exposureUnits = spot ? v.value / spot : null
    }
    // Direct exposure to the underlying: ETFs, futures and physical. Miners (equity) are a beta proxy, not the asset.
    const direct = inst.asset != null && inst.kind !== 'equity' && inst.kind !== 'cash'
    out.push({
      instrumentId: id,
      name: inst.name,
      kind: inst.kind,
      sleeve: sleeveOfKind(inst.kind),
      asset: inst.asset,
      quantity: qty,
      exposureUnits,
      unitLabel: exposureUnitOf(inst.asset),
      exposureNotional: direct ? v.notional * Math.sign(qty) : null,
      price,
      priceDate: mark?.date ?? null,
      priceStale: !mark || mark.fallback || mark.date < isoDaysAgo(asOf, 5),
      value: v.value,
      notional: v.notional,
      costBasis,
      avgCost,
      unrealizedPnl: isFut ? v.value : v.value - costBasis,
      realizedPnl: p.realized,
      income: p.income,
      expenses: p.expenses,
      totalPnl: last.cumPnl[id] ?? 0,
      weight: last.nav ? v.value / last.nav : 0,
      dayPnl: last.pnl[id] ?? 0,
      lots,
    })
  }
  return out.sort((a, b) => Math.abs(b.value) + b.notional * 0.01 - (Math.abs(a.value) + a.notional * 0.01))
}

export function buildHoldings(c: Computed): HoldingsResponse {
  const last = c.run.points.at(-1)
  const names = new Map(c.accounts.map((a) => [a.id, a.name]))
  const cash = [...c.run.cashByAccount.entries()]
    .filter(([, b]) => Math.abs(b) > 0.005)
    .map(([id, balance]) => ({ accountId: id, accountName: names.get(id) ?? `Account ${id}`, balance }))
    .sort((a, b) => b.balance - a.balance)
  return {
    asOf: last?.date ?? null,
    nav: last?.nav ?? 0,
    holdings: buildHoldingViews(c),
    cash,
    totalCash: last?.cash ?? 0,
    warnings: [...c.run.warnings, ...fallbackWarnings(c), ...c.prices.errors.map((e) => `Price fetch failed: ${e}`)],
    provenance: provenance(c),
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function prevMonthEnd(date: string): string {
  return isoDaysAgo(`${date.slice(0, 7)}-01`, 1)
}

/**
 * Per-asset exposure over the holdings with direct exposure (miners excluded):
 * units in the asset's own unit and signed notional. Every asset, universe order.
 */
function exposureByAsset(holdings: HoldingView[]): (AssetExposure & { notional: number })[] {
  return ASSETS.map((asset) => {
    const hs = holdings.filter((h) => h.asset === asset && h.exposureNotional != null)
    return {
      asset,
      exposureUnits: hs.reduce((s, h) => s + (h.exposureUnits ?? 0), 0),
      unitLabel: UNIVERSE[asset].priceUnit,
      notional: hs.reduce((s, h) => s + h.exposureNotional!, 0),
    }
  })
}

export function buildSummary(c: Computed): PortfolioSummary {
  const last = c.run.points.at(-1)
  const base = c.settings.baseNavPerUnit
  const empty: PortfolioSummary = {
    empty: true,
    asOf: last?.date ?? new Date().toISOString().slice(0, 10),
    nav: 0,
    navPerUnit: null,
    unitsOutstanding: null,
    dayReturn: null,
    mtdReturn: null,
    ytdReturn: null,
    sinceInceptionReturn: null,
    dayPnl: null,
    allocation: [],
    byAsset: [],
    inceptionDate: c.inception,
    cash: 0,
    grossExposure: 0,
    netExposure: [],
    unrealizedPnl: 0,
    realizedPnl: 0,
    income: 0,
    expenses: 0,
    totalPnl: 0,
    netContributions: 0,
    transactionCount: c.txns.length,
    warnings: [...c.run.warnings, ...fallbackWarnings(c)],
    provenance: provenance(c),
  }
  if (!last) return empty

  const npu = npuSeries(c)
  const holdings = buildHoldingViews(c)
  const nav = last.nav
  const w = (v: number) => (nav ? v / nav : 0)
  const allocation = (Object.entries(last.bySleeve) as [Sleeve, number][])
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([sleeve, value]) => ({ sleeve, value, weight: w(value) }))
    .sort((a, b) => b.value - a.value)
  // Published in the portfolio:summary artifact (shared/artifacts.ts PortfolioSummaryLite.byAsset).
  const byAsset = (Object.entries(last.byAsset) as [AssetId | 'cash' | 'other', number][])
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([asset, value]) => ({ asset, value, weight: w(value) }))
    .sort((a, b) => b.value - a.value)

  let income = 0
  let expenses = 0
  let netContributions = 0
  for (const t of c.txns) {
    if (t.type === 'dividend' || t.type === 'interest') income += t.quantity * t.price - t.fees
    else if (t.type === 'fee' || t.type === 'storage_fee') expenses += t.quantity * t.price + t.fees
    else expenses += t.type === 'buy' || t.type === 'sell' ? 0 : t.fees
    if (EXTERNAL_FLOW_TYPES.includes(t.type)) netContributions += (t.type === 'subscription' || t.type === 'deposit' ? 1 : -1) * t.quantity * t.price
  }

  const netExposure = exposureByAsset(holdings)
    .filter((x) => Math.abs(x.exposureUnits) > 1e-6)
    .map(({ asset, exposureUnits, unitLabel }) => ({ asset, exposureUnits, unitLabel }))

  const lastNpu = last.navPerUnit
  return {
    ...empty,
    empty: false,
    asOf: last.date,
    nav,
    navPerUnit: lastNpu,
    unitsOutstanding: last.units,
    dayReturn: last.dailyReturn,
    mtdReturn: lastNpu != null ? returnSince(npu, prevMonthEnd(last.date), base) : null,
    ytdReturn: lastNpu != null ? returnSince(npu, `${Number(last.date.slice(0, 4)) - 1}-12-31`, base) : null,
    sinceInceptionReturn: lastNpu != null ? lastNpu / base - 1 : null,
    dayPnl: Object.values(last.pnl).reduce((s, x) => s + x, 0),
    allocation,
    byAsset,
    cash: last.cash,
    grossExposure: last.grossExposure,
    netExposure,
    unrealizedPnl: holdings.reduce((s, h) => s + h.unrealizedPnl, 0),
    realizedPnl: [...c.run.positions.values()].reduce((s, p) => s + p.realized, 0),
    income,
    expenses,
    totalPnl: Object.values(last.cumPnl).reduce((s, x) => s + x, 0),
    netContributions,
  }
}

// ---------------------------------------------------------------------------
// NAV series & units
// ---------------------------------------------------------------------------

export function buildNavSeries(c: Computed, from?: string): NavSeriesResponse {
  return {
    points: c.run.points
      .filter((p) => !from || p.date >= from)
      .map((p) => ({
        date: p.date,
        nav: p.nav,
        units: p.units,
        navPerUnit: p.navPerUnit,
        cash: p.cash,
        grossExposure: p.grossExposure,
        netFlow: p.netFlow,
        bySleeve: p.bySleeve,
        byAsset: p.byAsset,
      })),
    provenance: provenance(c),
  }
}

export function buildUnits(c: Computed): UnitsResponse {
  const last = c.run.points.at(-1)
  return {
    entries: c.run.units,
    unitsOutstanding: last?.units ?? 0,
    navPerUnit: last?.navPerUnit ?? null,
    provenance: provenance(c, 'Units issued/cancelled at the pre-flow NAV/unit of the flow date'),
  }
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

interface Window {
  startValue: number
  /** Date the start value refers to (prior point, or the day before the first point). */
  startDate: string
  points: DatedValue[]
  returns: DatedValue[]
}

function fundWindow(c: Computed, from?: string | null): Window | null {
  const npu = npuSeries(c)
  if (npu.length === 0) return null
  const start = from && from > npu[0].date ? from : npu[0].date
  const prior = [...npu].reverse().find((p) => p.date < start)
  const points = npu.filter((p) => p.date >= start)
  if (points.length === 0) return null
  const startValue = prior?.value ?? c.settings.baseNavPerUnit
  const startDate = prior?.date ?? isoDaysAgo(points[0].date, 1)
  const returns = points.map((p, i) => ({ date: p.date, value: p.value / (i === 0 ? startValue : points[i - 1].value) - 1 }))
  return { startValue, startDate, points, returns }
}

function statsFor(returns: number[], total: number, startDate: string, endDate: string, rf: number, maxDD: number): PerformanceStats {
  const days = daysBetween(startDate, endDate)
  const annual = days >= 365 ? annualize(total, days) : NaN
  return {
    twr: fin(total),
    annualizedReturn: fin(annual),
    irr: null,
    volatility: returns.length > 1 ? fin(annualizedVol(returns)) : null,
    sharpe: returns.length > 1 ? fin(sharpe(returns, rf)) : null,
    sortino: returns.length > 1 ? fin(sortino(returns, rf)) : null,
    calmar: Number.isFinite(annual) && maxDD < 0 ? annual / Math.abs(maxDD) : null,
    bestDay: returns.length ? Math.max(...returns) : null,
    worstDay: returns.length ? Math.min(...returns) : null,
    positiveDays: returns.length ? returns.filter((r) => r > 0).length / returns.length : null,
    days,
  }
}

async function benchmarkIndex(c: Computed, id: BenchmarkId, dates: string[], startDate: string): Promise<(number | null)[] | null> {
  const legs = id === 'blend' ? c.settings.blend : [{ symbol: id, weight: 1 }]
  const { book } = await loadPrices(
    legs.map((l) => l.symbol),
    startDate,
  )
  const all = [startDate, ...dates]
  const aligned = legs.map((l) => all.map((d) => book.close(l.symbol, d)?.price ?? null))
  if (aligned.some((a) => a.every((x) => x == null))) return null
  // Daily-rebalanced blend: index_t = index_{t−1} × (1 + Σ w_i r_i,t)
  const out: (number | null)[] = []
  let idx = 100
  let started = false
  for (let t = 1; t < all.length; t++) {
    let r = 0
    let ok = true
    for (let k = 0; k < legs.length; k++) {
      const a = aligned[k][t - 1]
      const b = aligned[k][t]
      if (a == null || b == null) ok = false
      else r += legs[k].weight * (b / a - 1)
    }
    if (ok) {
      idx *= 1 + r
      started = true
    }
    out.push(started || ok ? idx : null)
  }
  return out
}

async function riskFreeRate(c: Computed, from: string): Promise<number> {
  if (c.settings.riskFree !== 'irx') return c.settings.riskFree
  const { book } = await loadPrices(['^IRX'], from)
  const vals = book.dates('^IRX').filter((d) => d >= from).map((d) => book.close('^IRX', d)!.price)
  return vals.length ? mean(vals) / 100 : 0
}

export async function buildPerformance(c: Computed, benchmark: BenchmarkId, from?: string | null): Promise<PerformanceResponse> {
  const label = BENCHMARKS.find((b) => b.id === benchmark)?.label ?? benchmark
  const w = fundWindow(c, from ?? c.settings.inceptionDate)
  const emptyStats: PerformanceStats = { twr: null, annualizedReturn: null, irr: null, volatility: null, sharpe: null, sortino: null, calmar: null, bestDay: null, worstDay: null, positiveDays: null, days: 0 }
  const emptyDd = { maxDrawdown: 0, peakDate: null, troughDate: null, recoveryDate: null, durationDays: null, current: 0 }
  if (!w) {
    return {
      from: null,
      to: null,
      benchmark,
      benchmarkLabel: label,
      riskFreeRate: typeof c.settings.riskFree === 'number' ? c.settings.riskFree : 0,
      series: [],
      drawdownSeries: [],
      rollingVol: [],
      monthly: [],
      stats: emptyStats,
      benchmarkStats: null,
      drawdown: emptyDd,
      periodReturns: { day: null, mtd: null, ytd: null, itd: null },
      provenance: provenance(c),
    }
  }
  const dates = w.points.map((p) => p.date)
  const end = dates.at(-1)!
  const rf = await riskFreeRate(c, w.startDate)
  const ret = w.returns.map((r) => r.value)
  const total = w.points.at(-1)!.value / w.startValue - 1
  const dd = drawdowns([{ date: w.startDate, value: w.startValue }, ...w.points])
  const stats = statsFor(ret, total, w.startDate, end, rf, dd.maxDrawdown)

  // IRR: investor cash flows within the window plus opening/closing NAV.
  const startPoint = [...c.run.points].reverse().find((p) => p.date <= w.startDate)
  const flows: { date: string; amount: number }[] = []
  if (startPoint && startPoint.nav > 0 && w.startDate >= (c.run.points[0]?.date ?? '')) flows.push({ date: w.startDate, amount: -startPoint.nav })
  for (const u of c.run.units) if (u.date > (startPoint ? w.startDate : '0000')) flows.push({ date: u.date, amount: -u.amount })
  const endNav = c.run.points.find((p) => p.date === end)?.nav ?? 0
  flows.push({ date: end, amount: endNav })
  stats.irr = fin(xirr(flows))

  const bench = await benchmarkIndex(c, benchmark, dates, w.startDate)
  let benchmarkStats: PerformanceStats | null = null
  if (bench) {
    const vals = [100, ...bench.map((b) => b ?? NaN)]
    const br: number[] = []
    for (let i = 1; i < vals.length; i++) if (Number.isFinite(vals[i]) && Number.isFinite(vals[i - 1])) br.push(vals[i] / vals[i - 1] - 1)
    const bdd = drawdowns(dates.map((d, i) => ({ date: d, value: bench[i] ?? 100 })))
    benchmarkStats = statsFor(br, chainLink(br), w.startDate, end, rf, bdd.maxDrawdown)
  }

  const npu = npuSeries(c)
  const last = c.run.points.at(-1)!
  const base = c.settings.baseNavPerUnit
  return {
    from: dates[0],
    to: end,
    benchmark,
    benchmarkLabel: label,
    riskFreeRate: rf,
    series: w.points.map((p, i) => ({ date: p.date, fund: (100 * p.value) / w.startValue, benchmark: bench?.[i] ?? null })),
    drawdownSeries: dd.series.slice(1).map((d) => ({ date: d.date, drawdown: d.value })),
    rollingVol: rollingVol(w.returns, 63).map((r) => ({ date: r.date, vol: r.value })),
    monthly: monthlyReturns(w.points, w.startValue),
    stats,
    benchmarkStats,
    drawdown: { maxDrawdown: dd.maxDrawdown, peakDate: dd.peakDate, troughDate: dd.troughDate, recoveryDate: dd.recoveryDate, durationDays: dd.durationDays, current: dd.current },
    periodReturns: {
      day: last.dailyReturn,
      mtd: returnSince(npu, prevMonthEnd(last.date), base),
      ytd: returnSince(npu, `${Number(last.date.slice(0, 4)) - 1}-12-31`, base),
      itd: last.navPerUnit != null ? last.navPerUnit / base - 1 : null,
    },
    provenance: provenance(c, `Benchmark ${label} rebased to 100 · risk-free ${(rf * 100).toFixed(2)}%`),
  }
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

/**
 * Beta references: equities and the dollar, then the reference series of each
 * asset the fund is exposed to (the first asset when flat).
 */
function betaRefs(exposed: AssetId[]): { symbol: string; label: string }[] {
  const assets = exposed.length ? exposed : [ASSETS[0]]
  return [
    { symbol: MACRO_SYMBOLS.spx, label: 'S&P 500 (SPY)' },
    { symbol: MACRO_SYMBOLS.dxy, label: 'US dollar index' },
    ...assets.map((a) => ({ symbol: UNIVERSE[a].spot, label: spotLabel(UNIVERSE[a]) })),
  ]
}

export async function buildRisk(c: Computed, lookbackDays = 252): Promise<RiskResponse> {
  const last = c.run.points.at(-1)
  const w = fundWindow(c)
  const holdings = buildHoldingViews(c)
  const exposure = exposureByAsset(holdings).filter((x) => Math.abs(x.notional) > 0.005)
  const refs = betaRefs(exposure.map((x) => x.asset))
  const nav = last?.nav ?? 0
  const base: RiskResponse = {
    asOf: last?.date ?? null,
    nav,
    observations: 0,
    volatility: null,
    var: [],
    betas: refs.map((b) => ({ ...b, beta: null, correlation: null, observations: 0 })),
    drawdown: { maxDrawdown: 0, peakDate: null, troughDate: null, recoveryDate: null, durationDays: null, current: 0 },
    grossExposure: last?.grossExposure ?? 0,
    grossLeverage: nav > 0 ? (last?.grossExposure ?? 0) / nav : null,
    exposureByAsset: exposure,
    provenance: provenance(c),
  }
  if (!w || w.returns.length < 2) return base

  const recent = w.returns.slice(-lookbackDays)
  const r = recent.map((x) => x.value)
  const dd = drawdowns([{ date: w.startDate, value: w.startValue }, ...w.points])
  const var_ = [0.95, 0.99].map((confidence) => {
    const h = historicalVar(r, confidence)
    const p = parametricVar(r, confidence)
    return {
      confidence,
      horizonDays: 1,
      historicalPct: fin(h.var),
      historicalUsd: fin(h.var * nav),
      historicalCvarPct: fin(h.cvar),
      historicalCvarUsd: fin(h.cvar * nav),
      parametricPct: fin(p.var),
      parametricUsd: fin(p.var * nav),
      parametricCvarPct: fin(p.cvar),
      parametricCvarUsd: fin(p.cvar * nav),
    }
  })

  const dates = recent.map((x) => x.date)
  const prevDate = w.points[w.points.length - recent.length - 1]?.date ?? w.startDate
  const { book } = await loadPrices(
    refs.map((b) => b.symbol),
    prevDate,
  )
  const betas = refs.map((b) => {
    const closes = alignSeries([prevDate, ...dates], book.dates(b.symbol).map((d) => ({ date: d, value: book.close(b.symbol, d)!.price })))
    const fx: number[] = []
    const bx: number[] = []
    for (let i = 1; i < closes.length; i++) {
      const a = closes[i - 1]
      const z = closes[i]
      if (a == null || z == null) continue
      fx.push(r[i - 1])
      bx.push(z / a - 1)
    }
    const res = betaCorrelation(fx, bx)
    return { ...b, beta: fin(res.beta), correlation: fin(res.correlation), observations: res.n }
  })

  return {
    ...base,
    observations: r.length,
    volatility: fin(annualizedVol(r)),
    var: var_,
    betas,
    drawdown: { maxDrawdown: dd.maxDrawdown, peakDate: dd.peakDate, troughDate: dd.troughDate, recoveryDate: dd.recoveryDate, durationDays: dd.durationDays, current: dd.current },
    provenance: provenance(c, `Trailing ${r.length} daily returns · 1-day horizon`),
  }
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export function buildAttribution(c: Computed, from?: string | null, to?: string | null): AttributionResponse {
  const pts = c.run.points
  const endIdx = to ? pts.findLastIndex((p) => p.date <= to) : pts.length - 1
  const empty: AttributionResponse = { from: null, to: null, totalPnl: 0, twr: null, residual: null, byHolding: [], bySleeve: [], byAsset: [], provenance: provenance(c) }
  if (endIdx < 0) return empty
  const startIdx = from ? pts.findLastIndex((p) => p.date < from) : -1
  const end = pts[endIdx]
  const start = startIdx >= 0 ? pts[startIdx] : null
  if (start && start.date >= end.date) return empty

  // Growth-weighted contributions are stored relative to the base NAV/unit; rescale to the period start.
  const linkScale = start?.navPerUnit ? c.settings.baseNavPerUnit / start.navPerUnit : 1
  const keys = new Set([...Object.keys(end.cumPnl), ...Object.keys(start?.cumPnl ?? {})])
  const byHolding: AttributionRow[] = []
  for (const k of keys) {
    const pnl = (end.cumPnl[k] ?? 0) - (start?.cumPnl[k] ?? 0)
    const contribution = ((end.cumContrib[k] ?? 0) - (start?.cumContrib[k] ?? 0)) * linkScale
    if (Math.abs(pnl) < 0.005 && Math.abs(contribution) < 1e-9) continue
    const inst = c.instruments.get(k)
    byHolding.push({
      key: k,
      label: k === CASH_KEY ? 'Cash interest & fund expenses' : (inst?.name ?? k),
      pnl,
      contribution,
      startValue: k === CASH_KEY ? (start?.cash ?? 0) : (start?.values[k] ?? 0),
      endValue: k === CASH_KEY ? end.cash : (end.values[k] ?? 0),
    })
  }
  byHolding.sort((a, b) => b.pnl - a.pnl)

  const group = (keyOf: (k: string) => string, labelOf: (g: string) => string) => {
    const m = new Map<string, AttributionRow>()
    for (const r of byHolding) {
      const g = keyOf(r.key)
      const row = m.get(g) ?? { key: g, label: labelOf(g), pnl: 0, contribution: 0, startValue: 0, endValue: 0 }
      row.pnl += r.pnl
      row.contribution += r.contribution
      row.startValue += r.startValue
      row.endValue += r.endValue
      m.set(g, row)
    }
    return [...m.values()].sort((a, b) => b.pnl - a.pnl)
  }
  const sleeveOf = (k: string): Sleeve => (k === CASH_KEY ? 'cash' : sleeveOfKind(c.instruments.get(k)?.kind ?? 'cash'))
  const assetOf = (k: string): string => (k === CASH_KEY ? 'cash' : (c.instruments.get(k)?.asset ?? 'other'))

  const startNpu = start?.navPerUnit ?? c.settings.baseNavPerUnit
  const twr = end.navPerUnit != null && startNpu ? end.navPerUnit / startNpu - 1 : null
  const sumContrib = byHolding.reduce((s, r) => s + r.contribution, 0)
  return {
    from: pts[startIdx + 1].date,
    to: end.date,
    totalPnl: byHolding.reduce((s, r) => s + r.pnl, 0),
    twr,
    residual: twr != null ? twr - sumContrib : null,
    byHolding,
    bySleeve: group(sleeveOf, (g) => SLEEVE_LABEL[g as Sleeve] ?? g),
    byAsset: group(assetOf, assetBucketLabel),
    provenance: provenance(c, 'Contribution = Σ daily P&L ÷ prior-day NAV, growth-linked so contributions sum to TWR'),
  }
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

type VaultItem = PhysicalItem & { value: number; storageAccrued: number }

/**
 * Register totals per directly-holdable asset, reconciled against the ledger
 * position of the asset's physical instrument. Specs are a parameter so
 * custody assets outside the universe can be tested.
 */
export function vaultTotals(items: VaultItem[], ledgerQty: (instrumentId: string) => number, specs: AssetSpec[]): Pick<VaultResponse, 'totals' | 'warnings'> {
  const warnings: string[] = []
  const totals = specs.flatMap((spec) => {
    if (!spec.physical) return []
    const unit = spec.physical.unit
    const held = items.filter((i) => i.asset === spec.id && i.status === 'held')
    const onLedger = ledgerQty(spec.physical.instrumentId)
    const fineQty = held.reduce((s, i) => s + i.fineQty, 0)
    if (Math.abs(fineQty - onLedger) > 0.01) {
      const registerUnit = spec.physical.kind === 'bullion' ? `fine ${unit}` : unit
      warnings.push(`${spec.label}: register holds ${fineQty.toFixed(3)} ${registerUnit} but the ledger holds ${onLedger.toFixed(3)} ${unit}.`)
    }
    return [
      {
        asset: spec.id,
        unitLabel: unit,
        items: held.length,
        fineQty,
        value: held.reduce((s, i) => s + i.value, 0),
        premiumPaid: held.reduce((s, i) => s + (i.premiumPaid ?? 0), 0),
        storageAccrued: held.reduce((s, i) => s + i.storageAccrued, 0),
        ledgerQty: onLedger,
      },
    ]
  }).filter((t) => t.items > 0 || Math.abs(t.ledgerQty) > 1e-9)
  return { totals, warnings }
}

/** "COMEX front month (GC=F, SI=F)": where register spot prices come from. */
function spotSourceLabel(specs: AssetSpec[]): string {
  const venues = new Set(specs.map((s) => s.futures.find((f) => f.yahoo === s.spot)?.exchange ?? null))
  const [venue] = venues
  const kind = venues.size === 1 && venue ? `${venue} front month` : 'reference series'
  return `${kind} (${specs.map((s) => s.spot).join(', ')})`
}

export function buildVault(c: Computed): VaultResponse {
  const date = c.run.points.at(-1)?.date ?? new Date().toISOString().slice(0, 10)
  const names = new Map(c.accounts.map((a) => [a.id, a.name]))
  const haircut = c.settings.physicalHaircut
  const items = c.physical.map((it) => {
    const spot = spotOf(c, it.asset, date)
    const value = it.status === 'held' && spot != null ? it.fineQty * spot * (1 - haircut) : 0
    const years = it.acquiredDate ? Math.max(0, daysBetween(it.acquiredDate, date)) / 365.25 : 0
    return {
      ...it,
      accountName: it.accountId ? (names.get(it.accountId) ?? null) : null,
      spot,
      value,
      storageAccrued: it.status === 'held' ? (it.storageFeeRateAnnual ?? 0) * value * years : 0,
    }
  })
  const ledgerQty = (instrumentId: string) => c.run.positions.get(instrumentId)?.lots.reduce((s, l) => s + l.qty, 0) ?? 0
  const { totals, warnings } = vaultTotals(items, ledgerQty, physicalAssets().map((a) => UNIVERSE[a]))
  return {
    items,
    totals,
    haircut,
    warnings,
    provenance: {
      source: `Vault register · spot from ${spotSourceLabel(physicalAssets().map((a) => UNIVERSE[a]))}`,
      asOf: c.run.points.at(-1)?.date ?? null,
      note: haircut ? `Valued net of a ${(haircut * 100).toFixed(2)}% haircut · storage accrual estimated at current value` : 'Storage accrual estimated at current value',
      modeled: items.some((i) => i.storageAccrued > 0),
    },
  }
}

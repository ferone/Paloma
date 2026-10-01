// Orchestrates a NAV recompute: ledger + cached/fetched closes → engine run →
// persisted snapshots/units → published PortfolioSummaryLite artifact.
// Results are cached in memory and invalidated on every ledger mutation.
import { getDb } from '../db/client.js'
import { writeArtifact } from '../db/repo.js'
import { registerJob } from '../jobs/registry.js'
import { ARTIFACTS, type PortfolioSummaryLite } from '../../shared/artifacts.js'
import { ASSETS, UNIVERSE, type AssetId } from '../../shared/universe.js'
import { isBusinessDay } from '../../shared/calendar/cme.js'
import type { Account, Instrument, PhysicalItem, PortfolioSettings, Transaction } from '../../shared/portfolio.js'
import { runLedger, type EngineRun } from './engine/ledger.js'
import { loadPrices, priceStamp, type LoadedPrices } from './prices.js'
import { getPortfolioSettings, instrumentMap, listAccounts, listPhysical, listTransactions, replaceDerived } from './repo.js'
import { buildSummary } from './views.js'
import { onPricesWritten } from '../jobs/events.js'

export interface Computed {
  txns: Transaction[]
  instruments: Map<string, Instrument>
  accounts: Account[]
  physical: PhysicalItem[]
  settings: PortfolioSettings
  run: EngineRun
  prices: LoadedPrices
  /** Every symbol whose closes fed this run, and their cache fingerprint once loaded. */
  priceSymbols: string[]
  priceStamp: string
  /** First valuation date (setting or first transaction). */
  inception: string | null
  computedAt: string
}

const MAX_AGE_MS = 15 * 60_000
let version = 0
let cache: { v: number; at: number; c: Computed } | null = null
let inflight: { v: number; p: Promise<Computed> } | null = null
let lastStamp = -1

function auditStamp(): number {
  return (getDb().prepare('SELECT COALESCE(MAX(id), 0) AS n FROM pf_audit_log').get() as { n: number }).n
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function compute(force: boolean): Promise<Computed> {
  const txns = listTransactions()
  const instruments = instrumentMap()
  const accounts = listAccounts()
  const physical = listPhysical()
  const settings = getPortfolioSettings()
  const firstTxn = txns[0]?.tradeDate ?? null
  const inception = settings.inceptionDate && firstTxn ? (settings.inceptionDate < firstTxn ? settings.inceptionDate : firstTxn) : firstTxn

  const used = new Set(txns.map((t) => t.instrumentId))
  const symbols = [...used].map((id) => instruments.get(id)?.priceSymbol).filter((s): s is string => !!s)
  // Reference series of every asset in play: ETF unit-equivalents and register valuations read them.
  if (txns.length || physical.length) symbols.push(...referenceSymbols(instruments, used, physical))
  const priceFrom = inception ?? physical.map((p) => p.acquiredDate).filter((d): d is string => !!d).sort()[0] ?? today()
  const prices = symbols.length ? await loadPrices(symbols, priceFrom, { force }) : await loadPrices([], priceFrom)

  const heldSymbols = [...used].map((id) => instruments.get(id)?.priceSymbol).filter((s): s is string => !!s)
  const dates = valuationDates(heldSymbols.length ? heldSymbols : [UNIVERSE[ASSETS[0]].spot], prices.book, inception)
  const run = runLedger(txns, instruments, prices.book, dates, settings)

  const priceSymbols = [...new Set(symbols)]
  const c: Computed = {
    txns,
    instruments,
    accounts,
    physical,
    settings,
    run,
    prices,
    priceSymbols,
    priceStamp: priceStamp(priceSymbols),
    inception,
    computedAt: new Date().toISOString(),
  }

  replaceDerived(
    run.units,
    run.points.map((p) => ({
      date: p.date,
      nav: p.nav,
      units: p.units,
      navPerUnit: p.navPerUnit,
      cash: p.cash,
      grossExposure: p.grossExposure,
      netFlow: p.netFlow,
      bySleeve: p.bySleeve as Record<string, number>,
      byAsset: p.byAsset as Record<string, number>,
    })),
  )
  writeArtifact(ARTIFACTS.portfolioSummary, toLite(buildSummary(c)))
  return c
}

/**
 * Spot symbols of every asset referenced by a traded instrument or a register
 * item, in universe order.
 */
export function referenceSymbols(instruments: Map<string, Instrument>, used: Set<string>, physical: PhysicalItem[]): string[] {
  const assets = new Set<AssetId>(physical.map((p) => p.asset))
  for (const id of used) {
    const a = instruments.get(id)?.asset
    if (a) assets.add(a)
  }
  return ASSETS.filter((a) => assets.has(a)).map((a) => UNIVERSE[a].spot)
}

/**
 * Valuation calendar: the fund NAV is struck on fund business days only, i.e.
 * every exchange business day (weekdays minus CME/US exchange holidays,
 * shared/calendar/cme.ts) on which any held instrument printed a close. Assets that
 * trade 24x7 (session '24x7', e.g. BTC) are marked at their close on those
 * business days (carry-forward lookup), so a weekend move lands in Monday's
 * NAV rather than creating Saturday/Sunday NAV points.
 */
export function valuationDates(symbols: string[], book: { dates(symbol: string): string[] }, inception: string | null): string[] {
  const dates = new Set<string>()
  if (!inception) return []
  for (const s of symbols) for (const d of book.dates(s)) if (d >= inception && isBusinessDay(d)) dates.add(d)
  return [...dates]
}

export function toLite(s: PortfolioSummaryLite): PortfolioSummaryLite {
  const { asOf, nav, navPerUnit, unitsOutstanding, dayReturn, mtdReturn, ytdReturn, sinceInceptionReturn, dayPnl, allocation, byAsset } = s
  return { asOf, nav, navPerUnit, unitsOutstanding, dayReturn, mtdReturn, ytdReturn, sinceInceptionReturn, dayPnl, allocation, byAsset }
}

/**
 * Latest computation, cached ≤ 15 min unless the ledger changed or new closes
 * landed for a symbol it used. `force` refetches prices.
 */
export function getComputed(opts: { force?: boolean } = {}): Promise<Computed> {
  const force = !!opts.force
  // Another process (e.g. the demo seed CLI) may have written to the ledger.
  const stamp = auditStamp()
  if (stamp !== lastStamp) {
    lastStamp = stamp
    version++
  }
  // ...or landed closes (data:yahoo CLI, macro/ML refreshes): the cached marks are out of date.
  if (cache && cache.v === version && priceStamp(cache.c.priceSymbols) !== cache.c.priceStamp) version++
  if (!force && cache && cache.v === version && Date.now() - cache.at < MAX_AGE_MS) return Promise.resolve(cache.c)
  if (!force && inflight && inflight.v === version) return inflight.p
  const v = version
  const p = compute(force)
    .then((c) => {
      if (v === version) cache = { v, at: Date.now(), c }
      return c
    })
    .finally(() => {
      if (inflight?.p === p) inflight = null
    })
  inflight = { v, p }
  return p
}

/** Call after any ledger/settings mutation: drop the cache and recompute in the background. */
export function invalidate(): void {
  version++
  cache = null
  getComputed().catch((err) => console.error('[portfolio] recompute failed', err))
}

/**
 * In-process price ingestion (the marketdata Yahoo job) landed closes: if any
 * fed the cached NAV, recompute now so both the API and the published
 * portfolio:summary artifact (Overview, AI context) pick them up.
 */
export function onPricesLanded(symbols: string[]): void {
  const used = cache?.c.priceSymbols
  if (used && !symbols.some((s) => used.includes(s))) return
  if (!cache && !inflight) return // nothing computed yet: the first request reads the fresh cache
  invalidate()
}
onPricesWritten(onPricesLanded)

/** Test helper: forget cached state (e.g. after swapping the DB). */
export function resetCache(): void {
  lastStamp = -1
  version++
  cache = null
  inflight = null
}

registerJob('portfolio.nav', 'Rebuild the portfolio NAV history from the ledger and refreshed closes; publishes portfolio:summary.', async (ctx) => {
  ctx.progress(0.1, 'Refreshing closes and replaying the ledger')
  const c = await getComputed({ force: true })
  const last = c.run.points.at(-1)
  ctx.progress(1)
  return last ? `NAV ${last.nav.toFixed(2)} on ${last.date} (${c.run.points.length} days)` : 'Ledger is empty; published an empty summary'
})

import type { CotRow } from '../db/shared-repo.js'
import type { CotCategoryRow, CotMarket, CotPoint, CotReportFamily, CotSpeculatorMeta } from '../../shared/macro.js'
import type { CotSpec } from '../../shared/universe.js'
import { mean, stdev } from './analytics.js'

// CFTC Commitments of Traders, futures-only, from the Socrata open-data API.
// Two report families (ported from CommodityFutures lib/data/cftc-cot.ts):
//   disagg  Disaggregated (dataset 72hh-3qpy): commodities (COMEX gold 088691, silver 084691)
//   tff     Traders in Financial Futures (dataset gpe5-46if): financials, incl. CME bitcoin 133741
// Markets are selected by exact CFTC contract code (from AssetSpec.cot) so
// micro/other-venue contracts never leak in.
//
// Each family has a "speculator" category: managed money (disagg) or leveraged
// funds (tff). Everything positioning-driven (scorecard rule, ML cot_mm_z,
// the Positioning page) reads the speculator through `speculatorOf`.
//
// Look-ahead: positions are as of Tuesday and released Friday 15:30 ET.
// published_at = report date + 3 days at 20:30Z, a conservative UTC bound that
// is at-or-after the true release in both EST and EDT.

export const CFTC_SOCRATA_BASE = 'https://publicreporting.cftc.gov/resource'

export type SocrataCotRow = Record<string, unknown>

interface CategoryDef {
  id: string
  name: string
  /** Column candidates, first finite value wins (field names drift across vintages). */
  long: readonly string[]
  short: readonly string[]
}

export interface CotFamily {
  report: CotReportFamily
  /** Socrata dataset id. */
  dataset: string
  url: string
  /** Human label for provenance. */
  label: string
  categories: CategoryDef[]
  speculator: CotSpeculatorMeta
  /** Exact live column names for $select (Socrata rejects unknown columns). */
  select: string
}

const COMMON_SELECT = ['report_date_as_yyyy_mm_dd', 'market_and_exchange_names', 'cftc_contract_market_code', 'open_interest_all']

// CFTC quirk (disagg): swap SHORT columns carry a double underscore.
const DISAGG_CATEGORIES: CategoryDef[] = [
  { id: 'prod', name: 'Producers / merchants', long: ['prod_merc_positions_long_all', 'prod_merc_positions_long'], short: ['prod_merc_positions_short_all', 'prod_merc_positions_short'] },
  { id: 'swap', name: 'Swap dealers', long: ['swap_positions_long_all', 'swap__positions_long_all'], short: ['swap__positions_short_all', 'swap_positions_short_all'] },
  { id: 'mm', name: 'Managed money', long: ['m_money_positions_long_all', 'm_money_positions_long'], short: ['m_money_positions_short_all', 'm_money_positions_short'] },
  { id: 'other', name: 'Other reportables', long: ['other_rept_positions_long_all', 'other_rept_positions_long'], short: ['other_rept_positions_short_all', 'other_rept_positions_short'] },
  { id: 'nonrep', name: 'Nonreportable', long: ['nonrept_positions_long_all'], short: ['nonrept_positions_short_all'] },
]

// TFF column names verified against the live dataset gpe5-46if (2026-10).
const TFF_CATEGORIES: CategoryDef[] = [
  { id: 'dealer', name: 'Dealers / intermediaries', long: ['dealer_positions_long_all', 'dealer_positions_long'], short: ['dealer_positions_short_all', 'dealer_positions_short'] },
  { id: 'asset_mgr', name: 'Asset managers', long: ['asset_mgr_positions_long', 'asset_mgr_positions_long_all'], short: ['asset_mgr_positions_short', 'asset_mgr_positions_short_all'] },
  { id: 'lev_money', name: 'Leveraged funds', long: ['lev_money_positions_long', 'lev_money_positions_long_all'], short: ['lev_money_positions_short', 'lev_money_positions_short_all'] },
  { id: 'other', name: 'Other reportables', long: ['other_rept_positions_long', 'other_rept_positions_long_all'], short: ['other_rept_positions_short', 'other_rept_positions_short_all'] },
  { id: 'nonrep', name: 'Nonreportable', long: ['nonrept_positions_long_all'], short: ['nonrept_positions_short_all'] },
]

export const COT_FAMILIES: Record<CotReportFamily, CotFamily> = {
  disagg: {
    report: 'disagg',
    dataset: '72hh-3qpy',
    url: `${CFTC_SOCRATA_BASE}/72hh-3qpy.json`,
    label: 'CFTC disaggregated futures-only COT',
    categories: DISAGG_CATEGORIES,
    speculator: { category: 'mm', label: 'Managed money', short: 'MM', driverId: 'COT_MM' },
    select: [
      ...COMMON_SELECT,
      'prod_merc_positions_long',
      'prod_merc_positions_short',
      'swap_positions_long_all',
      'swap__positions_short_all',
      'm_money_positions_long_all',
      'm_money_positions_short_all',
      'other_rept_positions_long',
      'other_rept_positions_short',
      'nonrept_positions_long_all',
      'nonrept_positions_short_all',
    ].join(','),
  },
  tff: {
    report: 'tff',
    dataset: 'gpe5-46if',
    url: `${CFTC_SOCRATA_BASE}/gpe5-46if.json`,
    label: 'CFTC Traders in Financial Futures futures-only COT',
    categories: TFF_CATEGORIES,
    speculator: { category: 'lev_money', label: 'Leveraged funds', short: 'Lev. funds', driverId: 'COT_LF' },
    select: [
      ...COMMON_SELECT,
      'dealer_positions_long_all',
      'dealer_positions_short_all',
      'asset_mgr_positions_long',
      'asset_mgr_positions_short',
      'lev_money_positions_long',
      'lev_money_positions_short',
      'other_rept_positions_long',
      'other_rept_positions_short',
      'nonrept_positions_long_all',
      'nonrept_positions_short_all',
    ].join(','),
  },
}

/** Speculator category of a report family: managed money (disagg) or leveraged funds (tff). */
export function speculatorOf(report: CotReportFamily): CotSpeculatorMeta {
  return COT_FAMILIES[report].speculator
}

export interface CotLongShort {
  long: number | null
  short: number | null
}

/** One report for one market, every category of its family. */
export interface CotReport {
  market: CotMarket
  report: CotReportFamily
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  positions: Record<string, CotLongShort>
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const c = v.replace(/[$,\s]/g, '')
  return /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : null
}

function toIso(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const iso = v.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  return mdy ? `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}` : null
}

/** First finite value among candidate column names. */
function pick(row: SocrataCotRow, names: readonly string[]): number | null {
  for (const n of names) {
    const v = num(row[n])
    if (v !== null) return v
  }
  return null
}

export function publishedAtFor(reportDate: string, lagDays = 3): string {
  const [y, m, d] = reportDate.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d) + lagDays * 86_400_000).toISOString().slice(0, 10)
  return `${day}T20:30:00Z`
}

/** Socrata rows of either family → reports (deduped by report date, ascending). PURE. */
export function parseCotReports(rows: SocrataCotRow[], report: CotReportFamily, market: CotMarket): CotReport[] {
  const fam = COT_FAMILIES[report]
  const byDate = new Map<string, CotReport>()
  for (const r of rows) {
    const reportDate = toIso(r.report_date_as_yyyy_mm_dd)
    if (!reportDate) continue
    const positions: Record<string, CotLongShort> = {}
    for (const c of fam.categories) positions[c.id] = { long: pick(r, c.long), short: pick(r, c.short) }
    byDate.set(reportDate, {
      market,
      report,
      reportDate,
      publishedAt: publishedAtFor(reportDate),
      openInterest: pick(r, ['open_interest_all']),
      positions,
    })
  }
  return [...byDate.values()].sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
}

// Wide cot_reports row <-> generic disaggregated report.
const LEGACY_COLS: Record<string, [keyof CotRow, keyof CotRow]> = {
  prod: ['prodLong', 'prodShort'],
  swap: ['swapLong', 'swapShort'],
  mm: ['mmLong', 'mmShort'],
  other: ['otherLong', 'otherShort'],
  nonrep: ['nonrepLong', 'nonrepShort'],
}

/** Disaggregated report → the wide cot_reports row (kept populated for existing readers). PURE. */
export function toCotRow(r: CotReport): CotRow {
  if (r.report !== 'disagg') throw new Error(`cot_reports holds disaggregated reports only (got ${r.report})`)
  const row = { market: r.market, reportDate: r.reportDate, publishedAt: r.publishedAt, openInterest: r.openInterest } as CotRow
  for (const [cat, [l, s]] of Object.entries(LEGACY_COLS)) {
    ;(row as unknown as Record<string, number | null>)[l] = r.positions[cat]?.long ?? null
    ;(row as unknown as Record<string, number | null>)[s] = r.positions[cat]?.short ?? null
  }
  return row
}

/** Wide cot_reports row → generic disaggregated report. PURE. */
export function fromCotRow(row: CotRow): CotReport {
  const positions: Record<string, CotLongShort> = {}
  for (const [cat, [l, s]] of Object.entries(LEGACY_COLS)) positions[cat] = { long: row[l] as number | null, short: row[s] as number | null }
  return { market: row.market, report: 'disagg', reportDate: row.reportDate, publishedAt: row.publishedAt, openInterest: row.openInterest, positions }
}

/** Disaggregated Socrata rows → cot_reports rows (deduped by report date, ascending). PURE. */
export function parseCotRows(rows: SocrataCotRow[], market: CotMarket): CotRow[] {
  return parseCotReports(rows, 'disagg', market).map(toCotRow)
}

const net = (l: number | null | undefined, s: number | null | undefined) => (l != null && s != null ? l - s : null)

/** The speculator's long/short in a report. */
export function speculatorPosition(r: CotReport): CotLongShort {
  return r.positions[speculatorOf(r.report).category] ?? { long: null, short: null }
}

/** Reports in 3 years of weekly data. */
export const COT_WINDOW_3Y = 156

/**
 * Derived speculator metrics per report, look-ahead safe: every statistic at
 * report i uses only reports ≤ i (trailing 156-report window, inclusive). PURE.
 */
export function deriveCot(reports: CotReport[], window = COT_WINDOW_3Y, minN = 26): CotPoint[] {
  const specNets = reports.map((r) => {
    const p = speculatorPosition(r)
    return net(p.long, p.short)
  })
  const pcts: (number | null)[] = reports.map((r, i) => {
    const n = specNets[i]
    return n != null && r.openInterest ? n / r.openInterest : null
  })
  return reports.map((r, i) => {
    const specNet = specNets[i]
    const prev = i > 0 ? specNets[i - 1] : null
    const hist = pcts.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null)
    const cur = pcts[i]
    let pctile: number | null = null
    let z: number | null = null
    if (cur != null && hist.length >= minN) {
      pctile = hist.filter((v) => v <= cur).length / hist.length
      const sd = stdev(hist)
      z = sd > 0 ? (cur - mean(hist)) / sd : null
    }
    const nets: Record<string, number | null> = {}
    for (const c of COT_FAMILIES[r.report].categories) nets[c.id] = net(r.positions[c.id]?.long, r.positions[c.id]?.short)
    return {
      reportDate: r.reportDate,
      publishedAt: r.publishedAt,
      openInterest: r.openInterest,
      specNet,
      specNetPctOi: cur,
      specPercentile3y: pctile,
      specZ3y: z,
      specNetChange: specNet != null && prev != null ? specNet - prev : null,
      nets,
    }
  })
}

/** Category breakdown for the latest report, with week-over-week changes vs the prior report. PURE. */
export function categoryTable(latest: CotReport, prior: CotReport | null): CotCategoryRow[] {
  const fam = COT_FAMILIES[latest.report]
  const d = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null)
  return fam.categories.map((c) => {
    const long = latest.positions[c.id]?.long ?? null
    const short = latest.positions[c.id]?.short ?? null
    const pl = prior?.positions[c.id]?.long ?? null
    const ps = prior?.positions[c.id]?.short ?? null
    const n = net(long, short)
    return {
      id: c.id,
      name: c.name,
      speculator: c.id === fam.speculator.category,
      long,
      short,
      net: n,
      changeLong: d(long, pl),
      changeShort: d(short, ps),
      changeNet: d(n, net(pl, ps)),
      netPctOi: n != null && latest.openInterest ? n / latest.openInterest : null,
    }
  })
}

/** Full history of one market from its family's dataset. */
export async function fetchCotReports(
  cot: CotSpec,
  opts: { appToken?: string; fetchImpl?: typeof fetch; since?: string } = {},
): Promise<CotReport[]> {
  const f = opts.fetchImpl ?? fetch
  const fam = COT_FAMILIES[cot.report]
  if (!/^[0-9A-Z]+$/.test(cot.code)) throw new Error(`Invalid CFTC contract code: ${cot.code}`)
  const where = [`cftc_contract_market_code='${cot.code}'`]
  if (opts.since && /^\d{4}-\d{2}-\d{2}$/.test(opts.since)) where.push(`report_date_as_yyyy_mm_dd >= '${opts.since}T00:00:00'`)
  const params = new URLSearchParams({
    $select: fam.select,
    $where: where.join(' AND '),
    $order: 'report_date_as_yyyy_mm_dd',
    $limit: '5000',
  })
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.appToken) headers['X-App-Token'] = opts.appToken
  const res = await f(`${fam.url}?${params.toString()}`, { headers, signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`CFTC COT ${cot.market}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const rows = (await res.json()) as unknown
  return parseCotReports(Array.isArray(rows) ? (rows as SocrataCotRow[]) : [], cot.report, cot.market)
}

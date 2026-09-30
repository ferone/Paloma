import type { CotRow } from '../db/shared-repo.js'
import type { CotCategoryRow, CotMarket, CotPoint } from '../../shared/macro.js'
import { COT_MARKETS } from './catalog.js'
import { mean, stdev } from './analytics.js'

// CFTC Commitments of Traders — disaggregated, futures-only (Socrata dataset
// 72hh-3qpy), ported from CommodityFutures lib/data/cftc-cot.ts. Markets are
// selected by exact CFTC contract code (COMEX GOLD 088691, SILVER 084691) so
// micro/Coinbase contracts never leak in.
//
// Look-ahead: positions are as of Tuesday and released Friday 15:30 ET.
// published_at = report date + 3 days at 20:30Z, a conservative UTC bound that
// is at-or-after the true release in both EST and EDT.

export const CFTC_SOCRATA_URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json'

export type SocrataCotRow = Record<string, unknown>

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

/** First finite value among candidate column names (field names drift across vintages). */
function pick(row: SocrataCotRow, names: string[]): number | null {
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

// Column candidates. CFTC quirk: swap SHORT columns carry a double underscore.
const COLS = {
  oi: ['open_interest_all'],
  prodLong: ['prod_merc_positions_long_all', 'prod_merc_positions_long'],
  prodShort: ['prod_merc_positions_short_all', 'prod_merc_positions_short'],
  swapLong: ['swap_positions_long_all', 'swap__positions_long_all'],
  swapShort: ['swap__positions_short_all', 'swap_positions_short_all'],
  mmLong: ['m_money_positions_long_all', 'm_money_positions_long'],
  mmShort: ['m_money_positions_short_all', 'm_money_positions_short'],
  otherLong: ['other_rept_positions_long_all', 'other_rept_positions_long'],
  otherShort: ['other_rept_positions_short_all', 'other_rept_positions_short'],
  nonrepLong: ['nonrept_positions_long_all'],
  nonrepShort: ['nonrept_positions_short_all'],
} as const

// Socrata rejects unknown columns in $select, so request exactly the names the
// live dataset uses (verified 2026-10); the parser still tolerates the variants.
export const COT_SELECT = [
  'report_date_as_yyyy_mm_dd',
  'market_and_exchange_names',
  'cftc_contract_market_code',
  'open_interest_all',
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
].join(',')

/** Socrata rows → cot_reports rows (deduped by report date, ascending). PURE. */
export function parseCotRows(rows: SocrataCotRow[], market: CotMarket): CotRow[] {
  const byDate = new Map<string, CotRow>()
  for (const r of rows) {
    const reportDate = toIso(r.report_date_as_yyyy_mm_dd)
    if (!reportDate) continue
    byDate.set(reportDate, {
      market,
      reportDate,
      publishedAt: publishedAtFor(reportDate),
      openInterest: pick(r, [...COLS.oi]),
      prodLong: pick(r, [...COLS.prodLong]),
      prodShort: pick(r, [...COLS.prodShort]),
      swapLong: pick(r, [...COLS.swapLong]),
      swapShort: pick(r, [...COLS.swapShort]),
      mmLong: pick(r, [...COLS.mmLong]),
      mmShort: pick(r, [...COLS.mmShort]),
      otherLong: pick(r, [...COLS.otherLong]),
      otherShort: pick(r, [...COLS.otherShort]),
      nonrepLong: pick(r, [...COLS.nonrepLong]),
      nonrepShort: pick(r, [...COLS.nonrepShort]),
    })
  }
  return [...byDate.values()].sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
}

const net = (l: number | null, s: number | null) => (l != null && s != null ? l - s : null)

/** Reports in 3 years of weekly data. */
export const COT_WINDOW_3Y = 156

/**
 * Derived managed-money metrics per report, look-ahead safe: every statistic at
 * report i uses only reports ≤ i (trailing 156-report window, inclusive). PURE.
 */
export function deriveCot(rows: CotRow[], window = COT_WINDOW_3Y, minN = 26): CotPoint[] {
  const pcts: (number | null)[] = rows.map((r) => {
    const n = net(r.mmLong, r.mmShort)
    return n != null && r.openInterest ? n / r.openInterest : null
  })
  return rows.map((r, i) => {
    const mmNet = net(r.mmLong, r.mmShort)
    const prev = i > 0 ? net(rows[i - 1].mmLong, rows[i - 1].mmShort) : null
    const hist = pcts.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null)
    const cur = pcts[i]
    let pctile: number | null = null
    let z: number | null = null
    if (cur != null && hist.length >= minN) {
      pctile = hist.filter((v) => v <= cur).length / hist.length
      const sd = stdev(hist)
      z = sd > 0 ? (cur - mean(hist)) / sd : null
    }
    return {
      reportDate: r.reportDate,
      publishedAt: r.publishedAt,
      openInterest: r.openInterest,
      mmNet,
      mmNetPctOi: cur,
      mmPercentile3y: pctile,
      mmZ3y: z,
      mmNetChange: mmNet != null && prev != null ? mmNet - prev : null,
      prodNet: net(r.prodLong, r.prodShort),
      swapNet: net(r.swapLong, r.swapShort),
    }
  })
}

/** Category breakdown for the latest report, with week-over-week changes vs the prior report. PURE. */
export function categoryTable(latest: CotRow, prior: CotRow | null): CotCategoryRow[] {
  const cats: { name: string; l: keyof CotRow; s: keyof CotRow }[] = [
    { name: 'Producers / merchants', l: 'prodLong', s: 'prodShort' },
    { name: 'Swap dealers', l: 'swapLong', s: 'swapShort' },
    { name: 'Managed money', l: 'mmLong', s: 'mmShort' },
    { name: 'Other reportables', l: 'otherLong', s: 'otherShort' },
    { name: 'Nonreportable', l: 'nonrepLong', s: 'nonrepShort' },
  ]
  const d = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null)
  return cats.map((c) => {
    const long = latest[c.l] as number | null
    const short = latest[c.s] as number | null
    const pl = prior ? (prior[c.l] as number | null) : null
    const ps = prior ? (prior[c.s] as number | null) : null
    const n = net(long, short)
    return {
      name: c.name,
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

export async function fetchCotHistory(
  market: CotMarket,
  opts: { appToken?: string; fetchImpl?: typeof fetch; since?: string } = {},
): Promise<CotRow[]> {
  const f = opts.fetchImpl ?? fetch
  const where = [`cftc_contract_market_code='${COT_MARKETS[market].code}'`]
  if (opts.since && /^\d{4}-\d{2}-\d{2}$/.test(opts.since)) where.push(`report_date_as_yyyy_mm_dd >= '${opts.since}T00:00:00'`)
  const params = new URLSearchParams({
    $select: COT_SELECT,
    $where: where.join(' AND '),
    $order: 'report_date_as_yyyy_mm_dd',
    $limit: '5000',
  })
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.appToken) headers['X-App-Token'] = opts.appToken
  const res = await f(`${CFTC_SOCRATA_URL}?${params.toString()}`, { headers, signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`CFTC COT ${market}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const rows = (await res.json()) as unknown
  return parseCotRows(Array.isArray(rows) ? (rows as SocrataCotRow[]) : [], market)
}

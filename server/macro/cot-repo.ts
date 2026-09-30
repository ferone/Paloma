import { getDb } from '../db/client.js'
import { upsertCot } from '../db/shared-repo.js'
import type { CotMarket, CotReportFamily } from '../../shared/macro.js'
import { speculatorOf, toCotRow, type CotReport } from './cot.js'

// cot_positions (migration 073): the generic long table for both CFTC report
// families. Writers: macro COT refresh. Readers: macro (dashboard, positioning)
// and ml (speculator z-score feature).

interface PositionRow {
  market: string
  report: CotReportFamily
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  category: string
  long: number | null
  short: number | null
}

/**
 * Upsert reports into cot_positions. Disaggregated reports are ALSO written to
 * the wide cot_reports table so its existing readers stay unchanged.
 */
export function upsertCotReports(reports: CotReport[]): number {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO cot_positions (market, report, report_date, published_at, open_interest, category, long, short)
     VALUES (@market, @report, @reportDate, @publishedAt, @openInterest, @category, @long, @short)
     ON CONFLICT(market, report, report_date, category) DO UPDATE SET
       published_at = excluded.published_at, open_interest = excluded.open_interest,
       long = excluded.long, short = excluded.short`,
  )
  db.transaction((rs: CotReport[]) => {
    for (const r of rs) {
      for (const [category, p] of Object.entries(r.positions)) {
        stmt.run({
          market: r.market,
          report: r.report,
          reportDate: r.reportDate,
          publishedAt: r.publishedAt,
          openInterest: r.openInterest,
          category,
          long: p.long,
          short: p.short,
        })
      }
    }
    const disagg = rs.filter((r) => r.report === 'disagg')
    if (disagg.length) upsertCot(disagg.map(toCotRow))
  })(reports)
  return reports.length
}

/** Reports for one market and family, ascending by report date. */
export function readCotReports(market: CotMarket, report: CotReportFamily, from?: string): CotReport[] {
  const rows = getDb()
    .prepare(
      `SELECT market, report, report_date AS reportDate, published_at AS publishedAt, open_interest AS openInterest,
         category, long, short
       FROM cot_positions WHERE market = ? AND report = ? AND (? IS NULL OR report_date >= ?)
       ORDER BY report_date, category`,
    )
    .all(market, report, from ?? null, from ?? null) as PositionRow[]
  const out: CotReport[] = []
  for (const r of rows) {
    let cur = out.at(-1)
    if (!cur || cur.reportDate !== r.reportDate) {
      cur = { market: r.market, report: r.report, reportDate: r.reportDate, publishedAt: r.publishedAt, openInterest: r.openInterest, positions: {} }
      out.push(cur)
    }
    cur.positions[r.category] = { long: r.long, short: r.short }
  }
  return out
}

export interface SpeculatorRow {
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  long: number | null
  short: number | null
}

/** The speculator category's positions (managed money / leveraged funds), ascending. */
export function readSpeculator(market: CotMarket, report: CotReportFamily): SpeculatorRow[] {
  return getDb()
    .prepare(
      `SELECT report_date AS reportDate, published_at AS publishedAt, open_interest AS openInterest, long, short
       FROM cot_positions WHERE market = ? AND report = ? AND category = ? ORDER BY report_date`,
    )
    .all(market, report, speculatorOf(report).category) as SpeculatorRow[]
}

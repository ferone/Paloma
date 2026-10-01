import type { OpenInterestCoverage } from '@shared/marketdata'
import { fmtDate, fmtNum } from '../../design/format'

// Plain-language open-interest coverage. Open interest is collected going
// forward by the daily Databento job; it was never backfilled, so the UI must
// never imply full history.

/** One line per root that has any open interest. PURE. */
export function oiLine(c: OpenInterestCoverage): string | null {
  if (!c.since || !c.last) return null
  const span = c.current ? `collected since ${fmtDate(c.since)}` : `${fmtDate(c.since)} to ${fmtDate(c.last)} only, not current`
  const sample = c.earlierSample ? `; plus an earlier sample ${fmtDate(c.earlierSample.from)} to ${fmtDate(c.earlierSample.to)}` : ''
  return `${c.root}: open interest ${span} (${fmtNum(c.days, 0)} ${c.days === 1 ? 'day' : 'days'})${sample}`
}

/** Roots with no open interest at all. PURE. */
export function oiMissing(rows: readonly OpenInterestCoverage[]): string[] {
  return rows.filter((c) => !c.since).map((c) => c.root)
}

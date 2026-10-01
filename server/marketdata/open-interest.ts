import { DATABENTO_ROOTS, type OpenInterestCoverage } from '../../shared/marketdata.js'
import { getDb } from '../db/client.js'

// Open-interest coverage. The Databento statistics schema is slow and paid, so
// it was never backfilled: the daily incremental job collects it going
// forward. These helpers tell the UI (and the incremental planner) how much
// OI history really exists, instead of implying full history.

/** A gap longer than this (calendar days) starts a new collection run. */
export const OI_GAP_DAYS = 10
/** OI within this many days of the latest bar counts as current. */
const CURRENT_DAYS = 7

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Coverage from the sorted distinct dates that carry OI and the root's latest bar date. PURE. */
export function oiCoverage(root: string, dates: readonly string[], latestBar: string | null): OpenInterestCoverage {
  if (!dates.length) return { root, since: null, last: null, days: 0, current: false, earlierSample: null }
  let start = 0
  for (let i = 1; i < dates.length; i++) if (daysBetween(dates[i - 1], dates[i]) > OI_GAP_DAYS) start = i
  const last = dates.at(-1)!
  return {
    root,
    since: dates[start],
    last,
    days: dates.length - start,
    current: latestBar != null && daysBetween(last, latestBar) <= CURRENT_DAYS,
    earlierSample: start > 0 ? { from: dates[0], to: dates[start - 1] } : null,
  }
}

export function latestOpenInterestDate(root: string): string | null {
  const r = getDb()
    .prepare(
      `SELECT MAX(b.date) AS d FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol
       WHERE c.root = ? AND b.source = 'databento' AND b.open_interest IS NOT NULL`,
    )
    .get(root) as { d: string | null }
  return r.d
}

/** How far back the incremental job may reach to close a recent OI gap (never a historical backfill). */
export const OI_CATCH_UP_DAYS = 31

/**
 * Date the daily incremental pull resumes from: the latest Databento bar, or
 * the latest open interest when that is a little older (the statistics chunk
 * of an earlier run failed after its bars landed), so a short OI gap closes
 * itself. An OI sample older than OI_CATCH_UP_DAYS is ignored: open interest
 * is collected going forward, never backfilled by the unattended job. PURE.
 */
export function incrementalResumeDate(latestBar: string | null, latestOi: string | null): string | null {
  if (!latestBar || !latestOi || latestOi >= latestBar) return latestBar
  return daysBetween(latestOi, latestBar) <= OI_CATCH_UP_DAYS ? latestOi : latestBar
}

let memo: { db: unknown; stamp: string; roots: string; value: OpenInterestCoverage[] } | null = null

/**
 * Coverage for every root (two grouped scans). Databento rows only change when
 * a pull is recorded, so the result is memoised on the databento_pulls stamp
 * for the polled status endpoints.
 */
export function openInterestCoverage(roots: readonly string[] = DATABENTO_ROOTS): OpenInterestCoverage[] {
  const db = getDb()
  const p = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM databento_pulls').get() as { n: number; m: number }
  const stamp = `${p.n}:${p.m}`
  const key = roots.join(',')
  if (memo && memo.db === db && memo.stamp === stamp && memo.roots === key) return memo.value
  const value = computeCoverage(roots)
  memo = { db, stamp, roots: key, value }
  return value
}

function computeCoverage(roots: readonly string[]): OpenInterestCoverage[] {
  const db = getDb()
  const dates = new Map<string, string[]>()
  const oiRows = db
    .prepare(
      `SELECT c.root AS root, b.date AS d FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol
       WHERE b.source = 'databento' AND b.open_interest IS NOT NULL GROUP BY c.root, b.date ORDER BY c.root, b.date`,
    )
    .all() as { root: string; d: string }[]
  for (const r of oiRows) {
    const list = dates.get(r.root)
    if (list) list.push(r.d)
    else dates.set(r.root, [r.d])
  }
  const latest = new Map(
    (
      db
        .prepare(`SELECT c.root AS root, MAX(b.date) AS d FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol WHERE b.source = 'databento' GROUP BY c.root`)
        .all() as { root: string; d: string | null }[]
    ).map((r) => [r.root, r.d]),
  )
  return roots.map((root) => oiCoverage(root, dates.get(root) ?? [], latest.get(root) ?? null))
}

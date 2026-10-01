import { getDb } from '../db/client.js'
import { GENERIC_EXPORT_TABLES, type FreshnessResponse, type FreshnessRow } from '../../shared/marketdata.js'
import { dateColumn, tableColumns, tableExists } from './export.js'
import { openInterestCoverage } from './open-interest.js'

// Data freshness per (dataset, source): counts, coverage, the last successful
// job that writes it, and a staleness flag against a per-dataset tolerance.

interface DatasetSpec {
  table: string
  dateCol: string
  symbolCol: string
  /** Column that splits the table into sources (null = whole table is one row). */
  sourceCol: string | null
  /** Max acceptable age in calendar days of the latest data point. */
  maxAgeDays: number
  /** job_runs name patterns (SQL LIKE) that write this dataset, per source. */
  jobs: (source: string) => string[]
}

const DAILY_TOLERANCE = 4 // covers a weekend plus a holiday

export const DATASETS: DatasetSpec[] = [
  {
    table: 'prices_daily',
    dateCol: 'date',
    symbolCol: 'symbol',
    sourceCol: 'source',
    maxAgeDays: DAILY_TOLERANCE,
    jobs: (s) => (s === 'yahoo' ? ['marketdata.yahoo'] : s === 'databento' ? ['marketdata.databento.%'] : [`%${s}%`]),
  },
  { table: 'contracts', dateCol: 'last_trade', symbolCol: 'symbol', sourceCol: null, maxAgeDays: Infinity, jobs: () => ['marketdata.%'] },
  {
    table: 'contract_bars',
    dateCol: 'date',
    symbolCol: 'symbol',
    sourceCol: 'source',
    maxAgeDays: DAILY_TOLERANCE,
    jobs: (s) => (s === 'yahoo' ? ['marketdata.yahoo'] : ['marketdata.databento.%']),
  },
  { table: 'macro_series', dateCol: 'date', symbolCol: 'series_id', sourceCol: 'source', maxAgeDays: 7, jobs: () => ['macro.%'] },
  { table: 'cot_reports', dateCol: 'report_date', symbolCol: 'market', sourceCol: null, maxAgeDays: 10, jobs: () => ['macro.%cot%', 'macro.%'] },
]

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

function lastSuccessfulJob(patterns: string[]): { name: string; finishedAt: string } | null {
  const db = getDb()
  for (const p of patterns) {
    const r = db
      .prepare(
        `SELECT name, finished_at AS finishedAt FROM job_runs WHERE state = 'succeeded' AND name LIKE ?
         ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(p) as { name: string; finishedAt: string } | undefined
    if (r) return { name: r.name, finishedAt: `${r.finishedAt.replace(' ', 'T')}Z` }
  }
  return null
}

function missing(table: string, maxAgeDays: number | null): FreshnessRow {
  return { dataset: table, source: '—', exists: false, rows: 0, symbols: 0, from: null, to: null, lastJob: null, ageDays: null, stale: false, maxAgeDays }
}

export function freshness(today = new Date().toISOString().slice(0, 10)): FreshnessResponse {
  const db = getDb()
  const rows: FreshnessRow[] = []
  for (const d of DATASETS) {
    const maxAge = Number.isFinite(d.maxAgeDays) ? d.maxAgeDays : null
    if (!tableExists(d.table)) {
      rows.push(missing(d.table, maxAge))
      continue
    }
    const src = d.sourceCol ? d.sourceCol : `'—'`
    const groups = db
      .prepare(
        `SELECT ${src} AS source, COUNT(*) AS rows, COUNT(DISTINCT ${d.symbolCol}) AS symbols,
           MIN(${d.dateCol}) AS "from", MAX(${d.dateCol}) AS "to"
         FROM ${d.table} GROUP BY 1 ORDER BY 1`,
      )
      .all() as { source: string; rows: number; symbols: number; from: string | null; to: string | null }[]
    if (!groups.length) {
      rows.push({ ...missing(d.table, maxAge), exists: true })
      continue
    }
    for (const g of groups) {
      // Contracts list future expiries: "to" is the furthest listed month, not data age.
      const ageDays = g.to && Number.isFinite(d.maxAgeDays) ? Math.max(0, daysBetween(g.to, today)) : null
      rows.push({
        dataset: d.table,
        source: g.source,
        exists: true,
        rows: g.rows,
        symbols: g.symbols,
        from: g.from,
        to: g.to,
        lastJob: lastSuccessfulJob(d.jobs(g.source)),
        ageDays,
        stale: ageDays != null && ageDays > d.maxAgeDays,
        maxAgeDays: maxAge,
      })
    }
  }
  // Tables other domains own: report presence, size and date coverage when they exist.
  for (const t of GENERIC_EXPORT_TABLES) {
    if (!tableExists(t)) {
      rows.push(missing(t, null))
      continue
    }
    const dc = dateColumn(tableColumns(t))
    const r = db
      .prepare(`SELECT COUNT(*) AS rows ${dc ? `, MIN("${dc}") AS "from", MAX("${dc}") AS "to"` : ''} FROM "${t}"`)
      .get() as { rows: number; from?: string | null; to?: string | null }
    const domain = t.startsWith('ml_') ? 'ml' : t.startsWith('ai_') ? 'ai' : 'portfolio'
    rows.push({
      dataset: t,
      source: '—',
      exists: true,
      rows: r.rows,
      symbols: 0,
      from: r.from ?? null,
      to: r.to ?? null,
      lastJob: lastSuccessfulJob([`${domain}.%`]),
      ageDays: r.to ? Math.max(0, daysBetween(r.to, today)) : null,
      stale: false,
      maxAgeDays: null,
    })
  }
  const openInterest = tableExists('contract_bars') && tableExists('contracts') ? openInterestCoverage() : []
  return { generatedAt: new Date().toISOString(), rows, openInterest }
}

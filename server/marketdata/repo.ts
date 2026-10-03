import { getDb } from '../db/client.js'
import type { ContractBar } from '../db/shared-repo.js'
import type { Bar, ContractSummary, DatabentoSpend, JobRunRow, SymbolListRow } from '../../shared/marketdata.js'

// Marketdata-internal queries. Cross-domain writes go through
// server/db/shared-repo.ts / repo.ts; these cover source-aware writes and the
// read models the Data Center needs.

/** Latest contract_bars date written by `source` for a root (via contracts). */
export function latestContractDate(root: string, source: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(b.date) AS d FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol
       WHERE c.root = ? AND b.source = ?`,
    )
    .get(root, source) as { d: string | null }
  return row.d
}

/** Set open interest on existing bars; returns how many rows matched. */
export function updateOpenInterest(points: { symbol: string; date: string; openInterest: number }[]): number {
  const db = getDb()
  const stmt = db.prepare('UPDATE contract_bars SET open_interest = ? WHERE symbol = ? AND date = ?')
  let n = 0
  db.transaction(() => {
    for (const p of points) n += stmt.run(p.openInterest, p.symbol, p.date).changes
  })()
  return n
}

/**
 * Insert Yahoo contract bars without ever overwriting a Databento row: a
 * conflicting row is only updated when it is itself a Yahoo row.
 */
export function upsertYahooContractBars(rows: ContractBar[]): number {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO contract_bars (symbol, date, open, high, low, close, volume, open_interest, source)
     VALUES (@symbol, @date, @open, @high, @low, @close, @volume, @openInterest, @source)
     ON CONFLICT(symbol, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
       volume = excluded.volume
     WHERE contract_bars.source <> 'databento'`,
  )
  let n = 0
  db.transaction(() => {
    for (const r of rows) n += stmt.run(r).changes
  })()
  return n
}

export function recordDatabentoPull(p: {
  jobRunId: number | null
  root: string
  schema: string
  start: string
  end: string
  estimatedCost: number
  records: number
  rowsWritten: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO databento_pulls (job_run_id, root, schema, start, end, estimated_cost, records, rows_written)
       VALUES (@jobRunId, @root, @schema, @start, @end, @estimatedCost, @records, @rowsWritten)`,
    )
    .run(p)
}

export function databentoSpend(): DatabentoSpend {
  const r = getDb()
    .prepare('SELECT COALESCE(SUM(estimated_cost), 0) AS total, COUNT(*) AS n, MAX(created_at) AS last FROM databento_pulls')
    .get() as { total: number; n: number; last: string | null }
  return { totalUsd: Math.round(r.total * 1e6) / 1e6, pulls: r.n, lastPullAt: r.last ? `${r.last.replace(' ', 'T')}Z` : null }
}

export function contractSummaries(root: string): ContractSummary[] {
  return getDb()
    .prepare(
      `SELECT c.symbol, c.root, c.year, c.month, c.last_trade AS lastTrade, c.first_notice AS firstNotice,
         COUNT(b.date) AS bars, MIN(b.date) AS firstDate, MAX(b.date) AS lastDate,
         (SELECT close FROM contract_bars x WHERE x.symbol = c.symbol ORDER BY date DESC LIMIT 1) AS lastClose,
         (SELECT open_interest FROM contract_bars x WHERE x.symbol = c.symbol AND open_interest IS NOT NULL ORDER BY date DESC LIMIT 1) AS lastOpenInterest
       FROM contracts c LEFT JOIN contract_bars b ON b.symbol = c.symbol
       WHERE c.root = ?
       GROUP BY c.symbol ORDER BY c.year, c.month`,
    )
    .all(root) as ContractSummary[]
}

export function contractBarsRange(symbol: string, from?: string, to?: string): Bar[] {
  return getDb()
    .prepare(
      `SELECT date, open, high, low, close, volume, open_interest AS openInterest, source FROM contract_bars
       WHERE symbol = ? AND (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?) ORDER BY date`,
    )
    .all(symbol, from ?? null, from ?? null, to ?? null, to ?? null) as Bar[]
}

export function dailySeries(symbol: string, source?: string, from?: string, to?: string): Bar[] {
  const s = source ?? null
  return getDb()
    .prepare(
      `SELECT date, open, high, low, close, volume, open_interest AS openInterest, source FROM prices_daily
       WHERE symbol = ? AND (? IS NULL OR source = ?) AND (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?)
       ORDER BY date, source`,
    )
    .all(symbol, s, s, from ?? null, from ?? null, to ?? null, to ?? null) as Bar[]
}

export function priceSymbols(): SymbolListRow[] {
  return getDb()
    .prepare(
      `SELECT symbol, source, COUNT(*) AS rows, MIN(date) AS "from", MAX(date) AS "to"
       FROM prices_daily GROUP BY symbol, source ORDER BY symbol, source`,
    )
    .all() as SymbolListRow[]
}

export function latestPriceDate(symbol: string, source: string): string | null {
  const r = getDb().prepare('SELECT MAX(date) AS d FROM prices_daily WHERE symbol = ? AND source = ?').get(symbol, source) as { d: string | null }
  return r.d
}

export function recentJobRuns(limit = 50, name?: string): JobRunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, state, started_at AS startedAt, finished_at AS finishedAt, message FROM job_runs
       WHERE (? IS NULL OR name = ?) ORDER BY id DESC LIMIT ?`,
    )
    .all(name ?? null, name ?? null, Math.max(1, Math.min(500, limit))) as JobRunRow[]
  // SQLite datetime('now') is UTC without a zone designator.
  const z = (t: string | null) => (t && !t.endsWith('Z') ? `${t.replace(' ', 'T')}Z` : t)
  return rows.map((r) => ({ ...r, startedAt: z(r.startedAt)!, finishedAt: z(r.finishedAt) }))
}

/**
 * True when an earlier pull already covered [start, end) for this root and schema,
 * so a resumed backfill can skip the window instead of paying for it again.
 */
export function pullCovers(root: string, schema: string, start: string, end: string): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM databento_pulls WHERE root = ? AND schema = ? AND start <= ? AND end >= ? LIMIT 1')
    .get(root, schema, start, end)
}

import type { Response } from 'express'
import { once } from 'node:events'
import { getDb } from '../db/client.js'
import { DATABENTO_ROOTS, GENERIC_EXPORT_TABLES, isExportDataset, type ExportDataset, type ExportFormat } from '../../shared/marketdata.js'
import { csvRow } from './csv.js'

// Dataset exporter. Table names come ONLY from the whitelist in
// shared/marketdata.ts, and column names from PRAGMA table_info, so nothing
// user-supplied is ever interpolated into SQL.

export interface ExportFilters {
  symbol?: string
  source?: string
  from?: string
  to?: string
}

export interface ExportQuery {
  dataset: ExportDataset
  sql: string
  params: unknown[]
}

export class ExportNotFoundError extends Error {}

export function tableExists(name: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
}

export function tableColumns(name: string): string[] {
  return (getDb().prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string }[]).map((c) => c.name)
}

const DATE_COLUMNS = ['date', 'as_of', 'asof', 'report_date', 'trade_date', 'snapshot_date', 'created_at', 'generated_at', 'recorded_at', 'timestamp', 'ts']

/** The column generic exports filter and sort on, if the table has one. */
export function dateColumn(columns: string[]): string | null {
  return DATE_COLUMNS.find((c) => columns.includes(c)) ?? null
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`

/** Build the SELECT for a dataset + filters. Throws ExportNotFoundError for unknown/missing tables. */
export function buildExportQuery(dataset: string, f: ExportFilters): ExportQuery {
  if (!isExportDataset(dataset)) throw new ExportNotFoundError(`Unknown dataset '${dataset}'`)
  if (!tableExists(dataset)) throw new ExportNotFoundError(`Dataset '${dataset}' does not exist yet (its domain has not created the table)`)
  const where: string[] = []
  const params: unknown[] = []
  const add = (clause: string, value: unknown) => {
    where.push(clause)
    params.push(value)
  }
  const range = (col: string) => {
    if (f.from) {
      where.push(`${col} >= ?`)
      params.push(f.from)
    }
    if (f.to) {
      where.push(`${col} <= ?`)
      // A bare date is inclusive of the whole day, also for timestamp columns
      // ('2026-09-30 12:00' sorts before '2026-09-30~').
      params.push(f.to.length === 10 ? `${f.to}~` : f.to)
    }
  }
  const isRoot = !!f.symbol && (DATABENTO_ROOTS as readonly string[]).includes(f.symbol)
  let sql: string
  switch (dataset) {
    case 'prices_daily':
      if (f.symbol) add('symbol = ?', f.symbol)
      if (f.source) add('source = ?', f.source)
      range('date')
      sql = `SELECT symbol, date, open, high, low, close, volume, open_interest, source FROM prices_daily`
      sql += where.length ? ` WHERE ${where.join(' AND ')}` : ''
      sql += ' ORDER BY symbol, source, date'
      break
    case 'contracts':
      if (f.symbol) add(isRoot ? 'root = ?' : 'symbol = ?', f.symbol)
      sql = `SELECT symbol, root, year, month, last_trade, first_notice FROM contracts`
      sql += where.length ? ` WHERE ${where.join(' AND ')}` : ''
      sql += ' ORDER BY root, year, month'
      break
    case 'contract_bars':
      if (f.symbol) add(isRoot ? 'c.root = ?' : 'b.symbol = ?', f.symbol)
      if (f.source) add('b.source = ?', f.source)
      range('b.date')
      sql = `SELECT b.symbol, c.root, b.date, b.open, b.high, b.low, b.close, b.volume, b.open_interest, b.source
             FROM contract_bars b LEFT JOIN contracts c ON c.symbol = b.symbol`
      sql += where.length ? ` WHERE ${where.join(' AND ')}` : ''
      sql += ' ORDER BY c.root, c.year, c.month, b.symbol, b.date'
      break
    case 'macro_series':
      if (f.symbol) add('series_id = ?', f.symbol)
      if (f.source) add('source = ?', f.source)
      range('date')
      sql = `SELECT series_id, date, value, source FROM macro_series`
      sql += where.length ? ` WHERE ${where.join(' AND ')}` : ''
      sql += ' ORDER BY series_id, date'
      break
    case 'cot_reports':
      if (f.symbol) add('market = ?', f.symbol)
      range('report_date')
      sql = `SELECT * FROM cot_reports`
      sql += where.length ? ` WHERE ${where.join(' AND ')}` : ''
      sql += ' ORDER BY market, report_date'
      break
    default: {
      // Generic whitelisted table owned by another domain: export verbatim.
      const cols = tableColumns(dataset)
      const dc = dateColumn(cols)
      if (dc) range(q(dc))
      sql = `SELECT * FROM ${q(dataset)}`
      sql += where.length ? ` WHERE ${where.join(' AND ')}` : ''
      if (dc) sql += ` ORDER BY ${q(dc)}`
    }
  }
  return { dataset, sql, params }
}

export function exportFilename(dataset: string, f: ExportFilters, ext: string): string {
  const parts = [dataset, f.symbol, f.source, f.from, f.to && `to-${f.to}`].filter(Boolean) as string[]
  return `${parts.join('_').replace(/[^A-Za-z0-9._-]+/g, '-')}.${ext}`
}

const PAGE = 5000

/**
 * Stream a query as CSV or a JSON array, page by page (LIMIT/OFFSET) so the
 * shared SQLite connection is never held across an await, honouring
 * back-pressure between pages.
 */
export async function streamExport(res: Response, query: ExportQuery, format: ExportFormat, filename: string): Promise<number> {
  const db = getDb()
  const stmt = db.prepare(`${query.sql} LIMIT ? OFFSET ?`)
  const columns = stmt.columns().map((c) => c.name)
  res.status(200)
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Cache-Control', 'no-store')
  const write = async (chunk: string) => {
    if (!res.write(chunk)) await once(res, 'drain')
  }
  let total = 0
  await write(format === 'csv' ? csvRow(columns) : '[')
  for (let offset = 0; ; offset += PAGE) {
    const rows = stmt.all(...query.params, PAGE, offset) as Record<string, unknown>[]
    if (!rows.length) break
    let chunk = ''
    for (const r of rows) {
      if (format === 'csv') chunk += csvRow(columns.map((c) => r[c]))
      else chunk += (total > 0 ? ',\n' : '\n') + JSON.stringify(r)
      total++
    }
    await write(chunk)
    if (rows.length < PAGE) break
  }
  if (format === 'json') await write(total ? '\n]\n' : ']\n')
  res.end()
  return total
}

export const GENERIC_TABLES = GENERIC_EXPORT_TABLES

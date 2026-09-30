import { getDb } from './client.js'

// Repositories for the cross-domain market tables (migrations 030 and 040).
// Writers: marketdata (contracts, contract_bars), macro (macro_series, cot_reports).
// Readers: quant, ml, markets, overview. Keep signatures stable; extend, don't change.

export interface ContractRow {
  symbol: string
  root: string
  year: number
  month: number
  lastTrade: string | null
  firstNotice: string | null
}

export interface ContractBar {
  symbol: string
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  openInterest: number | null
  source: string
}

export function upsertContracts(rows: ContractRow[]): void {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO contracts (symbol, root, year, month, last_trade, first_notice)
     VALUES (@symbol, @root, @year, @month, @lastTrade, @firstNotice)
     ON CONFLICT(symbol) DO UPDATE SET last_trade = excluded.last_trade, first_notice = excluded.first_notice`,
  )
  db.transaction((rs: ContractRow[]) => rs.forEach((r) => stmt.run(r)))(rows)
}

export function listContracts(root: string): ContractRow[] {
  return getDb()
    .prepare(
      `SELECT symbol, root, year, month, last_trade AS lastTrade, first_notice AS firstNotice
       FROM contracts WHERE root = ? ORDER BY year, month`,
    )
    .all(root) as ContractRow[]
}

export function upsertContractBars(rows: ContractBar[]): number {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO contract_bars (symbol, date, open, high, low, close, volume, open_interest, source)
     VALUES (@symbol, @date, @open, @high, @low, @close, @volume, @openInterest, @source)
     ON CONFLICT(symbol, date) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
       volume = COALESCE(excluded.volume, contract_bars.volume),
       open_interest = COALESCE(excluded.open_interest, contract_bars.open_interest),
       source = excluded.source`,
  )
  db.transaction((rs: ContractBar[]) => rs.forEach((r) => stmt.run(r)))(rows)
  return rows.length
}

/** Bars for one contract, ascending by date. */
export function readContractBars(symbol: string, from?: string): ContractBar[] {
  return getDb()
    .prepare(
      `SELECT symbol, date, open, high, low, close, volume, open_interest AS openInterest, source
       FROM contract_bars WHERE symbol = ? AND (? IS NULL OR date >= ?) ORDER BY date`,
    )
    .all(symbol, from ?? null, from ?? null) as ContractBar[]
}

/** All bars for every contract of a root (e.g. 'GC'), ascending by symbol then date. */
export function readRootBars(root: string, from?: string): ContractBar[] {
  return getDb()
    .prepare(
      `SELECT b.symbol, b.date, b.open, b.high, b.low, b.close, b.volume, b.open_interest AS openInterest, b.source
       FROM contract_bars b JOIN contracts c ON c.symbol = b.symbol
       WHERE c.root = ? AND (? IS NULL OR b.date >= ?)
       ORDER BY c.year, c.month, b.date`,
    )
    .all(root, from ?? null, from ?? null) as ContractBar[]
}

export interface MacroPoint {
  seriesId: string
  date: string
  value: number
  source: string
}

export function upsertMacro(points: MacroPoint[]): number {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO macro_series (series_id, date, value, source) VALUES (@seriesId, @date, @value, @source)
     ON CONFLICT(series_id, date) DO UPDATE SET value = excluded.value, source = excluded.source`,
  )
  db.transaction((ps: MacroPoint[]) => ps.forEach((p) => stmt.run(p)))(points)
  return points.length
}

export function readMacro(seriesId: string, from?: string): MacroPoint[] {
  return getDb()
    .prepare(
      `SELECT series_id AS seriesId, date, value, source FROM macro_series
       WHERE series_id = ? AND (? IS NULL OR date >= ?) ORDER BY date`,
    )
    .all(seriesId, from ?? null, from ?? null) as MacroPoint[]
}

export interface CotRow {
  market: string
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  prodLong: number | null
  prodShort: number | null
  swapLong: number | null
  swapShort: number | null
  mmLong: number | null
  mmShort: number | null
  otherLong: number | null
  otherShort: number | null
  nonrepLong: number | null
  nonrepShort: number | null
}

export function upsertCot(rows: CotRow[]): number {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO cot_reports (market, report_date, published_at, open_interest, prod_long, prod_short, swap_long, swap_short,
       mm_long, mm_short, other_long, other_short, nonrep_long, nonrep_short)
     VALUES (@market, @reportDate, @publishedAt, @openInterest, @prodLong, @prodShort, @swapLong, @swapShort,
       @mmLong, @mmShort, @otherLong, @otherShort, @nonrepLong, @nonrepShort)
     ON CONFLICT(market, report_date) DO UPDATE SET
       published_at = excluded.published_at, open_interest = excluded.open_interest,
       prod_long = excluded.prod_long, prod_short = excluded.prod_short, swap_long = excluded.swap_long,
       swap_short = excluded.swap_short, mm_long = excluded.mm_long, mm_short = excluded.mm_short,
       other_long = excluded.other_long, other_short = excluded.other_short,
       nonrep_long = excluded.nonrep_long, nonrep_short = excluded.nonrep_short`,
  )
  db.transaction((rs: CotRow[]) => rs.forEach((r) => stmt.run(r)))(rows)
  return rows.length
}

export function readCot(market: string, from?: string): CotRow[] {
  return getDb()
    .prepare(
      `SELECT market, report_date AS reportDate, published_at AS publishedAt, open_interest AS openInterest,
         prod_long AS prodLong, prod_short AS prodShort, swap_long AS swapLong, swap_short AS swapShort,
         mm_long AS mmLong, mm_short AS mmShort, other_long AS otherLong, other_short AS otherShort,
         nonrep_long AS nonrepLong, nonrep_short AS nonrepShort
       FROM cot_reports WHERE market = ? AND (? IS NULL OR report_date >= ?) ORDER BY report_date`,
    )
    .all(market, from ?? null, from ?? null) as CotRow[]
}

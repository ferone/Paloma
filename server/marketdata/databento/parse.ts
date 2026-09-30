import { parseRawSymbol, type ParsedContract } from '../contracts.js'

// PURE decoders for Databento GLBX.MDP3 JSON-lines payloads (encoding=json,
// map_symbols=true). Verified against real records (see __fixtures__):
//  - prices are fixed-point integers in units of 1e-9, serialized as strings;
//  - timestamps are nanoseconds since the Unix epoch, serialized as strings
//    (beyond Number's safe range, so they go through BigInt);
//  - `symbol` is the raw symbol (1-digit year) when map_symbols=true;
//  - statistics: open interest is stat_type 9, value in `quantity`, keyed to
//    the SESSION date in `ts_ref` (the record is published the next morning).

export const PRICE_SCALE = 1e-9
export const STAT_OPEN_INTEREST = 9
const UINT64_UNDEF = '18446744073709551615'
const INT64_UNDEF = '9223372036854775807'
const INT32_UNDEF = 2147483647

export interface DbnHeader {
  ts_event: string
  instrument_id: number
  rtype?: number
  publisher_id?: number
}

export interface DbnOhlcvRecord {
  hd: DbnHeader
  open: string
  high: string
  low: string
  close: string
  volume: string
  symbol?: string
}

export interface DbnStatRecord {
  hd: DbnHeader
  ts_recv?: string
  ts_ref: string
  price: string
  quantity: string | number
  stat_type: number
  sequence?: number
  update_action?: number
  symbol?: string
}

/** Nanosecond epoch string → YYYY-MM-DD (UTC). */
export function nsToDate(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(0, 10)
}

/** Fixed-point 1e-9 price string → number, rounded to 1e-6 to drop float noise. null for the undefined sentinel. */
export function fixedPrice(raw: string): number | null {
  if (raw === INT64_UNDEF || raw === '') return null
  return Math.round(Number(raw) * PRICE_SCALE * 1e6) / 1e6
}

/** Parse a JSON-lines body (tolerates CRLF and trailing blank lines). */
export function parseJsonLines<T>(body: string): T[] {
  const out: T[] = []
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim()
    if (t) out.push(JSON.parse(t) as T)
  }
  return out
}

export interface DecodedBar {
  contract: ParsedContract
  date: string
  instrumentId: number
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number
}

export interface DecodeResult<T> {
  rows: T[]
  /** Records dropped because they were spreads / other instruments. */
  skippedSpreads: number
  /** Records with no symbol mapping (instrument_id unresolved). */
  unmapped: number[]
}

/**
 * Decode ohlcv-1d records for `root`, keeping only outright contracts. Symbols
 * come from the record (`map_symbols`) or, failing that, `symbolById`
 * (symbology.resolve). Unresolved instrument ids are reported, never guessed.
 */
export function decodeOhlcv(records: DbnOhlcvRecord[], root: string, symbolById: Record<number, string> = {}): DecodeResult<DecodedBar> {
  const rows: DecodedBar[] = []
  const unmapped = new Set<number>()
  let skippedSpreads = 0
  for (const r of records) {
    const id = r.hd.instrument_id
    const raw = r.symbol ?? symbolById[id]
    if (!raw) {
      unmapped.add(id)
      continue
    }
    const date = nsToDate(r.hd.ts_event)
    const contract = parseRawSymbol(raw, root, date)
    if (!contract) {
      skippedSpreads++
      continue
    }
    const close = fixedPrice(r.close)
    if (close == null || close <= 0) continue
    rows.push({
      contract,
      date,
      instrumentId: id,
      open: fixedPrice(r.open),
      high: fixedPrice(r.high),
      low: fixedPrice(r.low),
      close,
      volume: Number(r.volume),
    })
  }
  return { rows, skippedSpreads, unmapped: [...unmapped] }
}

export interface DecodedOi {
  contract: ParsedContract
  /** Session date the open interest applies to. */
  date: string
  openInterest: number
}

/**
 * Decode statistics records into one open-interest value per (contract,
 * session date). Later publications for the same session supersede earlier
 * ones (ordered by ts_recv, then sequence). Non-OI stats and sentinels are
 * ignored; spreads are dropped.
 */
export function decodeOpenInterest(records: DbnStatRecord[], root: string, symbolById: Record<number, string> = {}): DecodeResult<DecodedOi> {
  const best = new Map<string, { oi: DecodedOi; key: bigint }>()
  const unmapped = new Set<number>()
  let skippedSpreads = 0
  for (const r of records) {
    if (r.stat_type !== STAT_OPEN_INTEREST) continue
    const qty = String(r.quantity)
    if (qty === INT64_UNDEF || Number(qty) === INT32_UNDEF) continue
    const oi = Number(qty)
    if (!Number.isFinite(oi) || oi < 0) continue
    const id = r.hd.instrument_id
    const raw = r.symbol ?? symbolById[id]
    if (!raw) {
      unmapped.add(id)
      continue
    }
    const ref = r.ts_ref && r.ts_ref !== UINT64_UNDEF ? r.ts_ref : r.hd.ts_event
    const date = nsToDate(ref)
    const contract = parseRawSymbol(raw, root, date)
    if (!contract) {
      skippedSpreads++
      continue
    }
    const key = BigInt(r.ts_recv ?? r.hd.ts_event) * 1_000_000_000n + BigInt(r.sequence ?? 0)
    const k = `${contract.symbol}|${date}`
    const prev = best.get(k)
    if (!prev || key >= prev.key) best.set(k, { oi: { contract, date, openInterest: oi }, key })
  }
  return {
    rows: [...best.values()].map((v) => v.oi).sort((a, b) => (a.date === b.date ? a.contract.symbol.localeCompare(b.contract.symbol) : a.date < b.date ? -1 : 1)),
    skippedSpreads,
    unmapped: [...unmapped],
  }
}

function isWeekendDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Databento daily bars are UTC-day aggregates, so the Sunday-evening Globex
 * open produces a small Sunday-dated bar. Fold it into the following Monday
 * (open from Sunday, high/low extremes, volumes summed) so the series only has
 * weekday dates. A weekend bar with no Monday bar in the batch is dropped
 * (ingest windows end on Saturdays so Sunday and Monday always travel together).
 */
export function foldWeekendBars(bars: DecodedBar[]): DecodedBar[] {
  const byKey = new Map<string, DecodedBar>()
  const weekend: DecodedBar[] = []
  for (const b of bars) {
    const w = isWeekendDate(b.date)
    if (w === 0 || w === 6) weekend.push(b)
    else byKey.set(`${b.contract.symbol}|${b.date}`, { ...b })
  }
  for (const s of weekend) {
    const monday = addDays(s.date, isWeekendDate(s.date) === 6 ? 2 : 1)
    const m = byKey.get(`${s.contract.symbol}|${monday}`)
    if (!m) continue
    m.open = s.open ?? m.open
    m.high = m.high == null ? s.high : s.high == null ? m.high : Math.max(m.high, s.high)
    m.low = m.low == null ? s.low : s.low == null ? m.low : Math.min(m.low, s.low)
    m.volume += s.volume
  }
  return [...byKey.values()].sort((a, b) => (a.date === b.date ? a.contract.symbol.localeCompare(b.contract.symbol) : a.date < b.date ? -1 : 1))
}

/** Decode a symbology.resolve response (stype_in=instrument_id → raw_symbol). */
export function decodeSymbology(json: { result?: Record<string, { d0: string; d1: string; s: string }[]> }): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [idStr, maps] of Object.entries(json.result ?? {})) {
    const id = Number(idStr)
    if (!Number.isFinite(id)) continue
    for (const m of maps ?? []) if (m?.s) out[id] = m.s
  }
  return out
}

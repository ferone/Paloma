import {
  DATABENTO_SCHEMAS,
  type BackfillRequest,
  type CostEstimate,
  type DatabentoRoot,
  type DatabentoSchema,
} from '../../../shared/marketdata.js'
import { upsertContracts, upsertContractBars, type ContractBar, type ContractRow } from '../../db/shared-repo.js'
import type { JobContext } from '../../jobs/registry.js'
import { contractRow } from '../contracts.js'
import { refreshFrontMonth } from '../continuous.js'
import { latestContractDate, recordDatabentoPull, updateOpenInterest } from '../repo.js'
import type { DatabentoClient } from './client.js'
import { OverBudgetError, assertWithinBudget, costLimit, estimate, todayUtc } from './cost.js'
import {
  decodeOhlcv,
  decodeOpenInterest,
  foldWeekendBars,
  parseJsonLines,
  type DbnOhlcvRecord,
  type DbnStatRecord,
} from './parse.js'

// Databento → contracts / contract_bars / prices_daily orchestration.

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function dow(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}
function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** Saturday on or before `date`. */
export function saturdayOnOrBefore(date: string): string {
  return addDays(date, -((dow(date) + 1) % 7))
}

/**
 * Split [start, end) into ~monthly windows whose boundaries fall on Saturdays,
 * so a Sunday-evening bar always travels with its Monday. PURE.
 */
export function monthlyWindows(start: string, end: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = []
  let cur = start
  while (cur < end) {
    let next = addMonths(cur, 1)
    next = addDays(next, (6 - dow(next) + 7) % 7) // forward to Saturday
    if (next <= cur) next = addDays(cur, 7)
    if (next > end) next = end
    out.push({ start: cur, end: next })
    cur = next
  }
  return out
}

/**
 * Incremental resume point: the Saturday on/before the latest stored date (so
 * the last partial week is re-pulled idempotently), or `fallbackDays` ago for a
 * root with nothing stored.
 */
export function resumeStart(latest: string | null, today: string, fallbackDays = 30): string {
  return latest ? saturdayOnOrBefore(latest) : addDays(today, -fallbackDays)
}

export interface IngestDeps {
  client: DatabentoClient
  budget: number
  jobRunId?: number | null
}

export interface IngestResult {
  estimate: CostEstimate
  spent: number
  bars: number
  openInterest: number
  contracts: number
  frontMonthRows: number
  skippedSpreads: number
}

const noopCtx: JobContext = { progress() {}, log() {} }

/**
 * Cost-guarded pull. The FREE estimate for the whole request is checked first
 * (refused over budget unless maxCost allows it); each monthly chunk is then
 * re-estimated (free) and the running total may never exceed the limit.
 */
export async function ingestDatabento(req: BackfillRequest, deps: IngestDeps, ctx: JobContext = noopCtx): Promise<IngestResult> {
  const schemas = DATABENTO_SCHEMAS.filter((s) => req.schemas.includes(s)) // ohlcv before statistics
  const range = await deps.client.getDatasetRange()
  const est = await estimate(deps.client, { ...req, schemas }, deps.budget, range.end)
  assertWithinBudget(est, req.maxCost)
  const limit = costLimit(deps.budget, req.maxCost)
  ctx.log(`Estimate $${est.total.toFixed(4)} for ${req.roots.join(',')} ${est.start}→${est.end} (limit $${limit.toFixed(2)})`)

  const windows = monthlyWindows(est.start, est.end)
  const steps = req.roots.length * windows.length * schemas.length
  let done = 0
  const result: IngestResult = { estimate: est, spent: 0, bars: 0, openInterest: 0, contracts: 0, frontMonthRows: 0, skippedSpreads: 0 }
  const seenContracts = new Set<string>()

  for (const root of req.roots) {
    for (const w of windows) {
      for (const schema of schemas) {
        const q = { symbols: [`${root}.FUT`], stypeIn: 'parent', schema, start: w.start, end: w.end }
        const cost = await deps.client.getCost(q)
        if (result.spent + cost > limit + 1e-9) {
          throw new OverBudgetError({ ...est, total: Math.round((result.spent + cost) * 1e6) / 1e6 }, limit)
        }
        const body = await deps.client.getRange(q)
        result.spent += cost
        const written = await applyChunk(root, schema, body, w, deps, result, seenContracts)
        recordDatabentoPull({
          jobRunId: deps.jobRunId ?? null,
          root,
          schema,
          start: w.start,
          end: w.end,
          estimatedCost: cost,
          records: written.records,
          rowsWritten: written.rows,
        })
        done++
        ctx.progress(done / (steps + 1), `${root} ${schema} ${w.start}→${w.end}: ${written.rows} rows`)
      }
    }
    if (schemas.includes('ohlcv-1d') || schemas.includes('statistics')) {
      result.frontMonthRows += refreshFrontMonth(root, addDays(est.start, -7))
    }
  }
  result.spent = Math.round(result.spent * 1e6) / 1e6
  result.contracts = seenContracts.size
  return result
}

async function applyChunk(
  root: DatabentoRoot,
  schema: DatabentoSchema,
  body: string,
  w: { start: string; end: string },
  deps: IngestDeps,
  result: IngestResult,
  seen: Set<string>,
): Promise<{ records: number; rows: number }> {
  if (schema === 'ohlcv-1d') {
    const records = parseJsonLines<DbnOhlcvRecord>(body)
    let dec = decodeOhlcv(records, root)
    if (dec.unmapped.length) dec = decodeOhlcv(records, root, await deps.client.resolveInstrumentIds(dec.unmapped, w.start, w.end))
    result.skippedSpreads += dec.skippedSpreads
    const bars = foldWeekendBars(dec.rows)
    const contracts = new Map<string, ContractRow>()
    for (const b of bars) {
      if (!contracts.has(b.contract.symbol)) contracts.set(b.contract.symbol, contractRow(b.contract))
      seen.add(b.contract.symbol)
    }
    upsertContracts([...contracts.values()])
    const rows: ContractBar[] = bars.map((b) => ({
      symbol: b.contract.symbol,
      date: b.date,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      openInterest: null,
      source: 'databento',
    }))
    upsertContractBars(rows)
    result.bars += rows.length
    return { records: records.length, rows: rows.length }
  }
  const records = parseJsonLines<DbnStatRecord>(body)
  let dec = decodeOpenInterest(records, root)
  if (dec.unmapped.length) dec = decodeOpenInterest(records, root, await deps.client.resolveInstrumentIds(dec.unmapped, w.start, w.end))
  result.skippedSpreads += dec.skippedSpreads
  const n = updateOpenInterest(dec.rows.map((r) => ({ symbol: r.contract.symbol, date: r.date, openInterest: r.openInterest })))
  result.openInterest += n
  return { records: records.length, rows: n }
}

/** Incremental request per root: resume from the latest stored Databento date. */
export function incrementalRequests(roots: readonly DatabentoRoot[], today = todayUtc()): { root: DatabentoRoot; start: string }[] {
  return roots.map((root) => ({ root, start: resumeStart(latestContractDate(root, 'databento'), today) }))
}

// Contracts for the market-data domain (/api/marketdata). Owned by the
// marketdata workstream. Server and client both import from here.
import { ASSETS, UNIVERSE, futuresRoots } from './universe.js'

/**
 * Futures roots pulled from Databento GLBX.MDP3 (`<root>.FUT` parent
 * symbology): every futures product in the universe, in universe order.
 */
export const DATABENTO_ROOTS = futuresRoots() as unknown as readonly [string, ...string[]]
/** A futures root from the universe (validated at the API boundary with `isDatabentoRoot`). */
export type DatabentoRoot = string

export const DATABENTO_SCHEMAS = ['ohlcv-1d', 'statistics'] as const
export type DatabentoSchema = (typeof DATABENTO_SCHEMAS)[number]

export const DATABENTO_DATASET = 'GLBX.MDP3'
/** First date GLBX.MDP3 history is licensed from. */
export const DATABENTO_HISTORY_START = '2010-06-06'

/** Symbol of the continuous front-month series written to prices_daily (source 'databento'). */
export function continuousSymbol(root: string): string {
  return `${root}.c.0`
}

/** CFTC market keys of every asset with a COT report (cot_reports.market). */
export const COT_MARKETS: readonly string[] = ASSETS.flatMap((a) => {
  const cot = UNIVERSE[a].cot
  return cot ? [cot.market] : []
})

export function isDatabentoRoot(x: unknown): x is DatabentoRoot {
  return typeof x === 'string' && (DATABENTO_ROOTS as readonly string[]).includes(x)
}

// ── Cost estimate / backfill ────────────────────────────────────────────────

export interface CostLine {
  root: DatabentoRoot
  schema: DatabentoSchema
  /** USD, from the free metadata.get_cost endpoint. */
  cost: number
}

export interface CostEstimate {
  dataset: string
  start: string
  /** Exclusive end (YYYY-MM-DD). */
  end: string
  lines: CostLine[]
  total: number
  /** DATABENTO_BUDGET: the most a pull may cost without an explicit maxCost. */
  budget: number
  withinBudget: boolean
}

export interface EstimateRequest {
  roots: DatabentoRoot[]
  start: string
  /** Exclusive; defaults to the dataset's available end. */
  end?: string
  schemas: DatabentoSchema[]
}

export interface BackfillRequest extends EstimateRequest {
  /** Explicit spending cap (USD). Required to exceed DATABENTO_BUDGET. */
  maxCost?: number
  /**
   * Months per request window (default 1). Cost is identical — Databento bills by
   * data, not requests — so large backfills of light schemas (ohlcv-1d) run far
   * faster with 12. Keep statistics at 1: it is heavy and slow server-side.
   */
  windowMonths?: number
}

/** 402 body when a pull would exceed its allowed cost. */
export interface OverBudgetBody {
  error: 'over_budget'
  message: string
  limit: number
  estimate: CostEstimate
}

export interface DatabentoSpend {
  /** Sum of estimated cost of every pull actually downloaded. */
  totalUsd: number
  pulls: number
  lastPullAt: string | null
}

// ── Freshness ───────────────────────────────────────────────────────────────

export interface FreshnessRow {
  /** Table name (prices_daily, contract_bars, …). */
  dataset: string
  /** Data source within the table ('yahoo', 'databento', 'fred', …) or '—'. */
  source: string
  exists: boolean
  rows: number
  symbols: number
  from: string | null
  to: string | null
  /** Most recent successful job that writes this dataset. */
  lastJob: { name: string; finishedAt: string } | null
  /** Days between `to` and today. */
  ageDays: number | null
  stale: boolean
  /** Max acceptable age in days for this dataset (null = not tracked). */
  maxAgeDays: number | null
}

export interface FreshnessResponse {
  generatedAt: string
  rows: FreshnessRow[]
}

// ── Series / contracts ─────────────────────────────────────────────────────

export interface Bar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  openInterest: number | null
  source: string
}

export interface ContractSummary {
  symbol: string
  root: string
  year: number
  month: number
  lastTrade: string | null
  firstNotice: string | null
  bars: number
  firstDate: string | null
  lastDate: string | null
  lastClose: number | null
  lastOpenInterest: number | null
}

export interface SeriesResponse {
  symbol: string
  source: string | null
  bars: Bar[]
  provenance: { source: string; asOf: string | null; note?: string }
}

export interface SymbolListRow {
  symbol: string
  source: string
  rows: number
  from: string
  to: string
}

// ── Export ─────────────────────────────────────────────────────────────────

/** Market tables with typed filters. */
export const MARKET_EXPORT_DATASETS = ['prices_daily', 'contracts', 'contract_bars', 'macro_series', 'cot_reports'] as const
/** Tables owned by other domains, exported verbatim if they exist. */
export const GENERIC_EXPORT_TABLES = ['pf_transactions', 'pf_nav_snapshots', 'pf_physical_items', 'pf_fund_units', 'cot_positions', 'ai_reports', 'ml_predictions', 'ml_runs'] as const
export const EXPORT_DATASETS = [...MARKET_EXPORT_DATASETS, ...GENERIC_EXPORT_TABLES] as const
export type ExportDataset = (typeof EXPORT_DATASETS)[number]
export type ExportFormat = 'csv' | 'json'

export function isExportDataset(x: unknown): x is ExportDataset {
  return typeof x === 'string' && (EXPORT_DATASETS as readonly string[]).includes(x)
}

// ── Scheduler / jobs ────────────────────────────────────────────────────────

export interface ScheduleConfig {
  enabled: boolean
  /** Daily run time, "HH:MM" in UTC (after the CME close, e.g. 22:30). */
  timeUtc: string
  skipWeekends: boolean
  /** Registered job names, run sequentially in this order. */
  jobs: string[]
}

export interface ScheduleStatus extends ScheduleConfig {
  /** ISO timestamp of the next scheduled run (null when disabled). */
  nextRunAt: string | null
  lastRun: { date: string; startedAt: string; finishedAt: string | null; results: { job: string; outcome: string }[] } | null
  running: boolean
  /** Configured jobs no domain has registered (yet). */
  unknownJobs: string[]
  /** True until a schedule is saved: the built-in default (on, 22:30 UTC) applies. */
  isDefault?: boolean
}

export interface JobRunRow {
  id: number
  name: string
  state: 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt: string | null
  message: string | null
}

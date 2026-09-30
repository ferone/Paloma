// Macro & positioning API contracts (owned by the macro workstream).
// Server: server/macro/*. Client: src/features/macro/*.
import type { JobStatus, Provenance } from './api.js'
import type { AssetId } from './universe.js'

export type Stance = 'tailwind' | 'headwind' | 'neutral'

/** How a series' 1m/3m change is expressed: absolute difference (rates, pp) or percent change (levels). */
export type ChangeKind = 'diff' | 'pct'

export type SeriesUnit = 'percent' | 'index' | 'usd_bn' | 'ratio' | 'usd'

export interface MacroSeriesMeta {
  id: string
  label: string
  /** Short explanation for tooltips (jargon explainer). */
  description: string
  unit: SeriesUnit
  changeKind: ChangeKind
  frequency: 'daily' | 'weekly' | 'monthly'
  /** 'fred' | 'yahoo' | 'derived' */
  source: string
  /** Where the raw data can be checked by a human. */
  url: string | null
}

export interface SeriesPoint {
  date: string
  value: number
}

export interface MacroSeriesSnapshot extends MacroSeriesMeta {
  latest: number | null
  latestDate: string | null
  /** Change vs the observation on/before latestDate − 1 month (pp for diff, fraction for pct). */
  change1m: number | null
  change3m: number | null
  /** z-score of the latest level vs the trailing 3 years of observations. */
  z: number | null
  /** Percentile (0..1) of the latest level vs the trailing 3 years. */
  percentile: number | null
  observations: number
  provenance: Provenance
}

export interface ScorecardRow {
  /** Driver id (usually a series id, e.g. DFII10, or the COT speculator driver COT_MM / COT_LF). */
  id: string
  label: string
  seriesId: string
  value: number | null
  unit: SeriesUnit
  changeKind: ChangeKind
  change1m: number | null
  change3m: number | null
  z: number | null
  stance: Stance
  /** Human-readable rule that produced the stance, with the numbers plugged in. */
  reason: string
  /** The documented rule (static text). */
  rule: string
  asOf: string | null
}

export interface RegimePart {
  key: 'realYields' | 'dollar' | 'risk'
  label: string
  stance: Stance
}

export interface MacroRegime {
  label: string
  parts: RegimePart[]
}

export interface MacroDashboard {
  asset: AssetId
  asOf: string | null
  regime: MacroRegime
  scorecard: ScorecardRow[]
  /** Count of tailwinds minus headwinds across the scorecard. */
  netScore: number
  tailwinds: number
  headwinds: number
  series: MacroSeriesSnapshot[]
  refresh: { fred: JobStatus | null; cot: JobStatus | null; all: JobStatus | null }
  /** True when nothing has been fetched yet (UI shows an empty state + refresh). */
  empty: boolean
}

export interface SeriesResponse {
  series: (MacroSeriesMeta & { points: SeriesPoint[]; provenance: Provenance })[]
}

/** CFTC market key (`AssetSpec.cot.market`, e.g. GOLD, SILVER, BTC). */
export type CotMarket = string

/** CFTC report family: disaggregated (commodities) or Traders in Financial Futures (financials, incl. bitcoin). */
export type CotReportFamily = 'disagg' | 'tff'

/**
 * The speculator category of a report family: managed money (disaggregated) or
 * leveraged funds (TFF). Positioning signals (scorecard, ML) read through it.
 */
export interface CotSpeculatorMeta {
  /** Category id in cot_positions (`mm`, `lev_money`). */
  category: string
  /** "Managed money", "Leveraged funds". */
  label: string
  /** Compact label for stats ("MM", "Lev. funds"). */
  short: string
  /** Scorecard driver id (`COT_MM`, `COT_LF`). */
  driverId: string
}

export interface CotPoint {
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  /** Speculator (managed money / leveraged funds) net long. */
  specNet: number | null
  /** Speculator net as a fraction of open interest. */
  specNetPctOi: number | null
  /** Percentile (0..1) of specNetPctOi within the trailing 3 years (156 reports), inclusive. */
  specPercentile3y: number | null
  specZ3y: number | null
  specNetChange: number | null
  /** Net long of every category in the report family, keyed by category id. */
  nets: Record<string, number | null>
}

export interface CotCategoryRow {
  /** Category id (prod, swap, mm, … or dealer, asset_mgr, lev_money, …). */
  id: string
  name: string
  /** True for the family's speculator category. */
  speculator: boolean
  long: number | null
  short: number | null
  net: number | null
  /** Week-over-week changes. */
  changeLong: number | null
  changeShort: number | null
  changeNet: number | null
  /** Net as a fraction of open interest. */
  netPctOi: number | null
}

export interface CotResponse {
  market: CotMarket
  marketName: string
  report: CotReportFamily
  speculator: CotSpeculatorMeta
  latest: {
    reportDate: string
    publishedAt: string | null
    openInterest: number | null
    changeOpenInterest: number | null
    categories: CotCategoryRow[]
    specNetPctOi: number | null
    specPercentile3y: number | null
    specZ3y: number | null
  } | null
  history: CotPoint[]
  provenance: Provenance
}

/** Market factors every asset is correlated against. */
export type MacroFactor = 'realYield' | 'dxy' | 'vix' | 'spy'

/**
 * A correlation factor: another asset (the relative-value partner where a pair
 * exists, otherwise the asset's class peers) or a market factor.
 */
export type CorrelationFactor = AssetId | MacroFactor

export interface CorrelationFactorMeta {
  id: CorrelationFactor
  label: string
  /** What the daily observation is (return, change in pp, …). */
  transform: string
}

export interface RollingCorrelationPoint {
  date: string
  /** Correlation of the asset's return with each factor; null when insufficient data. */
  values: Partial<Record<CorrelationFactor, number | null>>
}

export interface BetaRow {
  factor: CorrelationFactor
  /** Correlation over the window. */
  correlation: number | null
  /** OLS slope of the asset's daily return on the factor's daily change. */
  beta: number | null
  /** Observations used. */
  n: number
}

export interface CorrelationResponse {
  asset: AssetId
  window: number
  asOf: string | null
  factors: CorrelationFactorMeta[]
  rolling: RollingCorrelationPoint[]
  matrix: { factors: CorrelationFactor[]; values: (number | null)[][] }
  betas: BetaRow[]
  provenance: Provenance
}

export interface RefreshResponse {
  job: JobStatus
}

/** Series id of an asset's reference price in /api/macro/series (GOLD, SILVER, ...). */
export const priceSeriesId = (asset: AssetId): string => asset.toUpperCase()

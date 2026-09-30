// Macro & positioning API contracts (owned by the macro workstream).
// Server: server/macro/*. Client: src/features/macro/*.
import type { JobStatus, Provenance } from './api.js'
import type { Metal } from './universe.js'

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
  /** Driver id (usually a series id, e.g. DFII10, or COT_MM). */
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
  metal: Metal
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

export type CotMarket = 'GOLD' | 'SILVER'

export interface CotPoint {
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  mmNet: number | null
  /** Managed-money net as a fraction of open interest. */
  mmNetPctOi: number | null
  /** Percentile (0..1) of mmNetPctOi within the trailing 3 years (156 reports), inclusive. */
  mmPercentile3y: number | null
  mmZ3y: number | null
  mmNetChange: number | null
  prodNet: number | null
  swapNet: number | null
}

export interface CotCategoryRow {
  name: string
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
  latest: {
    reportDate: string
    publishedAt: string | null
    openInterest: number | null
    changeOpenInterest: number | null
    categories: CotCategoryRow[]
    mmNetPctOi: number | null
    mmPercentile3y: number | null
    mmZ3y: number | null
  } | null
  history: CotPoint[]
  provenance: Provenance
}

export type CorrelationFactor = 'gold' | 'silver' | 'realYield' | 'dxy' | 'vix' | 'spy'

export interface CorrelationFactorMeta {
  id: CorrelationFactor
  label: string
  /** What the daily observation is (return, change in pp, …). */
  transform: string
}

export interface RollingCorrelationPoint {
  date: string
  /** Correlation of the metal's return with each factor; null when insufficient data. */
  values: Partial<Record<CorrelationFactor, number | null>>
}

export interface BetaRow {
  factor: CorrelationFactor
  /** Correlation over the window. */
  correlation: number | null
  /** OLS slope of the metal's daily return on the factor's daily change. */
  beta: number | null
  /** Observations used. */
  n: number
}

export interface CorrelationResponse {
  metal: Metal
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

// Cross-domain "published" summaries. Each owning domain writes its artifact
// (server/db/repo.ts writeArtifact) whenever it recomputes; other domains read
// it (readArtifact) instead of importing each other's code. Keep these small
// and stable — rich shapes live in shared/<domain>.ts.
import type { Metal } from './universe.js'

export const ARTIFACTS = {
  /** Written by portfolio on every NAV recompute. */
  portfolioSummary: 'portfolio:summary',
  /** Written by quant on every engine run. */
  quantSnapshot: 'quant:snapshot',
  /** Written by ml on every inference. */
  mlPredictions: 'ml:predictions',
  /** Written by macro on every refresh. */
  macroDashboard: 'macro:dashboard',
} as const

export type Sleeve = 'etf' | 'futures' | 'physical' | 'cash' | 'equity'

export interface PortfolioSummaryLite {
  asOf: string
  nav: number
  navPerUnit: number | null
  unitsOutstanding: number | null
  /** Fractions (0.012 = 1.2%). null when not computable (e.g. no history). */
  dayReturn: number | null
  mtdReturn: number | null
  ytdReturn: number | null
  sinceInceptionReturn: number | null
  dayPnl: number | null
  allocation: { sleeve: Sleeve; value: number; weight: number }[]
  byMetal: { metal: Metal | 'cash' | 'other'; value: number; weight: number }[]
}

export interface QuantOpportunityLite {
  id: string
  metal: Metal
  label: string
  /** long/short the instrument (spread, fly, ratio or outright). */
  side: 'long' | 'short'
  tier: 'STRONG' | 'MODERATE' | 'WATCH' | 'AVOID'
  verdict: 'BUY' | 'SELL' | 'AVOID'
  qtRank: number
  z: number | null
  oosStatus: 'passed' | 'failed' | 'untested'
}

export interface QuantSnapshotLite {
  asOf: string
  dataThrough: string | null
  opportunities: QuantOpportunityLite[]
}

export interface MlPredictionLite {
  /** Quant instrument id (e.g. 'GC.fly.0-1-2') or outright target id (e.g. 'GC.out'). */
  instrumentId: string
  metal: Metal
  horizonDays: number
  /** P(price up over horizon) for outrights. */
  pUp?: number
  /** P(spread converges toward mean) for spreads/flies. */
  pConverge?: number
  expectedMove?: number
  validationStatus: 'passed' | 'failed' | 'untested'
  asOf: string
}

export interface MlPredictionsLite {
  asOf: string
  modelRunId: number | null
  predictions: MlPredictionLite[]
}

export interface MacroDriverLite {
  id: string
  label: string
  value: number | null
  change: number | null
  /** Effect on the metal given the current reading. */
  stance: 'tailwind' | 'headwind' | 'neutral'
}

export interface MacroDashboardLite {
  asOf: string
  regime: string
  drivers: MacroDriverLite[]
}

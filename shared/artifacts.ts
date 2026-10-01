// Cross-domain "published" summaries. Each owning domain writes its artifact
// (server/db/repo.ts writeArtifact) whenever it recomputes; other domains read
// it (readArtifact) instead of importing each other's code. Keep these small
// and stable — rich shapes live in shared/<domain>.ts.
import type { AssetId } from './universe.js'

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
  byAsset: { asset: AssetId | 'cash' | 'other'; value: number; weight: number }[]
}

export interface QuantOpportunityLite {
  id: string
  asset: AssetId
  label: string
  /** long/short the instrument (spread, fly, ratio or outright). */
  side: 'long' | 'short'
  tier: 'STRONG' | 'MODERATE' | 'WATCH' | 'AVOID'
  verdict: 'BUY' | 'SELL' | 'AVOID'
  qtRank: number
  z: number | null
  oosStatus: 'passed' | 'failed' | 'untested'
}

/** Cash-and-carry basis summary (annualized percent). */
export interface QuantBasisLite {
  id: string
  asset: AssetId
  asOf: string
  contract: string
  daysToExpiry: number
  basis: number
  tbill: number
  excess: number
  z: number | null
  halfLife: number | null
  oosStatus: 'passed' | 'failed' | 'untested'
  verdict: 'BUY' | 'SELL' | 'AVOID'
}

export interface QuantSnapshotLite {
  asOf: string
  dataThrough: string | null
  opportunities: QuantOpportunityLite[]
  /** Cash-and-carry basis per asset that has one (always published, whatever its rank). */
  basis?: QuantBasisLite[]
}

export interface MlPredictionLite {
  /** Quant instrument id (e.g. 'GC.fly.0-1-2') or outright target id (e.g. 'GC.out'). */
  instrumentId: string
  asset: AssetId
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
  /** Effect on the asset given the current reading. */
  stance: 'tailwind' | 'headwind' | 'neutral'
}

export interface MacroDashboardLite {
  asOf: string
  regime: string
  drivers: MacroDriverLite[]
}

// ── One-release compatibility shim for stored artifacts ─────────────────────
// Artifacts written before the alias cleanup used `metal` / `byMetal` keys
// (PortfolioSummaryLite.byMetal[].metal, QuantOpportunityLite.metal,
// QuantBasisLite.metal, MlPredictionLite.metal, the macro artifact's byMetal).
// Writers now emit only `asset` / `byAsset`; `readArtifact` passes stored
// payloads through `upgradeArtifact`, which renames the old keys. Remove this
// shim one release after the rename, once every stored artifact was rewritten.

type Loose = Record<string, unknown>
const isObj = (x: unknown): x is Loose => typeof x === 'object' && x !== null && !Array.isArray(x)

/** `{ metal }` → `{ asset }` on one object (no-op when `asset` is already present). */
function renameMetal(x: unknown): unknown {
  if (!isObj(x) || !('metal' in x) || 'asset' in x) return x
  const { metal, ...rest } = x
  return { ...rest, asset: metal }
}

const mapList = (x: unknown, f: (v: unknown) => unknown): unknown => (Array.isArray(x) ? x.map(f) : x)

/** Upgrade a stored artifact payload to the current key names. PURE. */
export function upgradeArtifact<T>(name: string, data: T): T {
  if (!isObj(data)) return data
  const d: Loose = { ...data }
  if ('byMetal' in d && !('byAsset' in d)) {
    d.byAsset = name === ARTIFACTS.portfolioSummary ? mapList(d.byMetal, renameMetal) : d.byMetal
    delete d.byMetal
  }
  if (name === ARTIFACTS.quantSnapshot) {
    d.opportunities = mapList(d.opportunities, renameMetal)
    if ('basis' in d) d.basis = mapList(d.basis, renameMetal)
  }
  if (name === ARTIFACTS.mlPredictions) d.predictions = mapList(d.predictions, renameMetal)
  return d as T
}

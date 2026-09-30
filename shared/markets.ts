// API contracts for the Markets section (server/markets <-> src/features/markets).
// Fractions everywhere (0.012 = 1.2%) unless a field name says otherwise.
import type { Provenance } from './api.js'
import type { AssetId } from './universe.js'

/** @deprecated Kept for the `metal` field name; the value is any `AssetId`. */
type Metal = AssetId

/** Legacy live quote shape (GET /api/quotes/:symbol, /api/batch). Percent fields are in percent units. */
export interface Quote {
  symbol: string
  shortName: string
  price: number
  previousClose: number
  change: number
  /** Percent units: 1.2 = 1.2%. */
  changePercent: number
  dayHigh: number
  dayLow: number
  volume: number
  marketState: string
  timestamp: number
}

/** Daily or intraday bar (GET /api/historical/:symbol). */
export interface OHLCV {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const TIME_RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y', 'ALL'] as const
export type TimeRange = (typeof TIME_RANGES)[number]

// ── Term structure ────────────────────────────────────────────────────────

export type CurveShape = 'contango' | 'backwardation' | 'flat' | 'mixed' | 'insufficient'

export interface CurveContract {
  /** Yahoo symbol, e.g. GCZ26.CMX. */
  symbol: string
  root: string
  month: number
  year: number
  /** "Dec 26". */
  label: string
  /** Last trade / expiry date (YYYY-MM-DD) as reported by Yahoo. */
  expiry: string | null
  daysToExpiry: number | null
  price: number
  change: number | null
  volume: number | null
  openInterest: number | null
  /** ISO time of the last trade. */
  lastTrade: string | null
  /** Last trade older than 3 days: price may not reflect the market. */
  stale: boolean
  /** The most-traded (highest open interest) contract; spreads/carry are measured from it. */
  isReference: boolean
  /** Price minus reference price, in the asset's price unit (see `unitLabel`). */
  spread: number | null
  /** Simple annualized carry vs the reference contract (ACT/360), fraction. */
  carry: number | null
}

export interface CurveResponse {
  metal: Metal
  /** Main futures root; null when the asset has no listed futures (contracts is then empty). */
  root: string | null
  /** Exchange of the root (COMEX, NYMEX, CME). */
  exchange: string | null
  /** Price unit of the contracts, e.g. "$/oz". */
  unitLabel: string
  contracts: CurveContract[]
  referenceSymbol: string | null
  /** 13-week T-bill discount yield (^IRX), fraction. */
  rate: { symbol: string; value: number | null }
  shape: CurveShape
  /** Annualized carry from the reference to the live contract nearest one year later ("12M carry"). */
  termCarry: number | null
  /** termCarry − rate. Negative ≈ positive implied lease rate. */
  carryMinusRate: number | null
  provenance: Provenance
}

export interface CurveHistoryPoint {
  date: string
  termCarry: number | null
  rate: number | null
  referencePrice: number | null
}

export interface CurveHistoryResponse {
  metal: Metal
  points: CurveHistoryPoint[]
  provenance: Provenance
}

// ── ETFs ──────────────────────────────────────────────────────────────────

export type PremiumMethod = 'nav' | 'modeled' | 'none'

export interface EtfRow {
  symbol: string
  name: string
  kind: 'physical' | 'miners'
  price: number
  changePercent: number | null
  volume: number | null
  dollarVolume: number | null
  aum: number | null
  expenseRatio: number | null
  /** Published NAV per share (Yahoo summaryDetail.navPrice), or modeled NAV. */
  nav: number | null
  premium: number | null
  premiumMethod: PremiumMethod
  returns: { m1: number | null; m3: number | null; ytd: number | null; y1: number | null }
  /** 1Y ETF return − 1Y spot (front future) return. */
  trackingDiff1y: number | null
  /** Annualized stdev of weekly (ETF − spot) return differences over 1Y. */
  trackingError1y: number | null
  /** Correlation of weekly returns with spot over 1Y. */
  correlation1y: number | null
}

export interface EtfsResponse {
  metal: Metal
  spotSymbol: string
  spotReturns: EtfRow['returns']
  rows: EtfRow[]
  provenance: Provenance
}

// ── Liquidity ─────────────────────────────────────────────────────────────

export interface InstrumentLiquidity {
  symbol: string
  name: string
  kind: 'future' | 'etf' | 'miners'
  price: number
  /** Shares or contracts. */
  volume: number
  dollarVolume: number
}

export interface SourceShare {
  key: 'institutional' | 'centralBanks' | 'privateRetail' | 'jewelry' | 'mining'
  label: string
  /** Fraction of total (modeled). */
  share: number
}

export interface CountryShare {
  country: string
  /** Fraction of global demand (modeled). */
  share: number
  breakdown: { type: string; share: number }[]
}

export interface RegionShare {
  region: string
  share: number
  countries: CountryShare[]
}

/** Modeled World Gold Council-style splits. Only provided for gold. */
export interface ModeledSplit {
  sources: SourceShare[]
  regions: RegionShare[]
  provenance: Provenance
}

export interface LiquiditySnapshot {
  metal: Metal
  totalDollarVolume: number
  instruments: InstrumentLiquidity[]
  /** Daily contracts traded, summed over the listed active months, last ~30 sessions. */
  futuresVolume: { date: string; volume: number }[]
  /** Futures root (GC, SI); null for an asset without listed futures. */
  futuresSymbol: string | null
  split: ModeledSplit | null
  provenance: Provenance
}

export interface LiquidityHistoryRow {
  date: string
  total: number
  /** Dollar volume per instrument symbol. */
  bySymbol: Record<string, number>
}

export interface LiquiditySpike {
  date: string
  total: number
  /** Standard deviations above the range mean. */
  z: number
  title: string | null
  description: string | null
}

export interface LiquidityHistoryResponse {
  metal: Metal
  range: string
  /** Bar size: 5Y is weekly and ALL monthly, so "per bar" figures are not daily there. */
  interval: '1d' | '1wk' | '1mo'
  symbols: { symbol: string; name: string }[]
  history: LiquidityHistoryRow[]
  summary: { total: number; avgDaily: number; sessions: number }
  spikes: LiquiditySpike[]
  split: ModeledSplit | null
  provenance: Provenance
}

// Quant Lab API contracts (/api/quant/*). Owned by the quant domain.
// Server: server/quant/*. Client: src/features/quant/*.
import type { Provenance } from './api.js'
import type { AssetId } from './universe.js'

export type QuantMode = 'conservative' | 'aggressive'
export type OosStatus = 'passed' | 'failed' | 'untested'
export type QuantTier = 'STRONG' | 'MODERATE' | 'WATCH' | 'AVOID'
export type QuantKind = 'outright' | 'calendar' | 'butterfly' | 'seasonal' | 'ratio' | 'inter' | 'basis'
/** User-facing action: BUY = go long the structure, SELL = go short it, AVOID = stand aside. */
export type QuantAction = 'BUY' | 'SELL' | 'AVOID'

/**
 * Returned instead of data when there is nothing to show yet:
 *  - no_data: contract_bars is empty (run the Databento backfill in the Data Center);
 *  - not_computed: bars exist but the engine has not run yet;
 *  - computing: the quant.recompute job is running now.
 */
export interface QuantEmpty {
  status: 'no_data' | 'not_computed' | 'computing'
  /** Why there is nothing to show. */
  message: string
  /** What the user should do about it. */
  action: string
}

export function isQuantEmpty(x: unknown): x is QuantEmpty {
  const st = typeof x === 'object' && x !== null ? (x as { status?: unknown }).status : undefined
  return st === 'no_data' || st === 'not_computed' || st === 'computing'
}

export interface EngineInfo {
  profile: string
  configVersion: number
  /** z-score lookback (bars). */
  N: number
  /** Seasonal drift / holding horizon (bars). */
  H: number
  tiers: { strong: number; moderate: number; watch: number }
  ouBounds: { min: number; max: number }
}

export interface ScoreView {
  z: number
  score: number
  base: number
  seasonFactor: number
  fundFactor: number
  volFactor: number | null
  tier: QuantTier
  avoidOverride: boolean
}

export interface OuView {
  n: number
  b: number
  mu: number | null
  theta: number | null
  halfLife: number | null
  sigmaEq: number | null
  r2: number
  tradable: boolean
  reason: string
  /** Adaptive lookback (bars) and the z computed on it. */
  nEff: number | null
  zEff: number | null
  expectedDays: number | null
}

export interface CarryView {
  regime: 'contango' | 'backwardation' | 'flat'
  /** c1 − c0 in price units. */
  slope: number
  slopePctile: number | null
  slopeMomZ: number | null
  trending: boolean
  alignment: 'aligned' | 'conflict' | 'neutral' | null
  detail: string | null
}

export interface GatesView {
  ouTradable: boolean
  carryConflict: boolean
  /** Structural-move gate: the front outright / curve slope is breaking its noise band. null = not applicable. */
  structural: boolean | null
  structuralDetail: string | null
}

export interface VerdictView {
  mode: QuantMode
  /** The engine decision (BUY = take the trade in `direction`). */
  decision: 'BUY' | 'AVOID'
  action: QuantAction
  direction: 'long' | 'short' | null
  /** Plain-language instruction, e.g. "Short the calendar: sell GCZ26, buy GCG27". */
  instruction: string
  reasons: string[]
  blockers: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface OosYear {
  year: number
  netPnl: number
}

export interface OosView {
  status: OosStatus
  method: 'seasonal-window' | 'z-fade'
  reason: string
  trades: number
  winRate: number
  avgPnl: number
  totalPnl: number
  sharpe: number
  tStat: number
  maxDrawdown: number
  /** Unit of the P&L figures, e.g. "$ per contract, net of $35 costs". */
  pnlUnit: string
  yearly: OosYear[]
  regime: {
    survives: boolean
    exRegimeStatus: OosStatus
    regimesHit: string[]
    excludedTrades: number
    note: string
  } | null
}

export interface KellyView {
  /** Full Kelly fraction f* = p − (1 − p)/b (may be ≤ 0 ⇒ no bet). */
  fullKelly: number
  /** Suggested fraction of risk capital = max(0, half of f*), capped at 25%. */
  halfKelly: number
  winRate: number
  /** Average win ÷ average loss (OOS, net). */
  payoff: number
  trades: number
  note: string
}

export interface ContractLegView {
  /** Continuous leg, e.g. "GC.c.0". */
  leg: string
  /** Real contract on the as-of date, e.g. "GCZ26" (null when unresolved). */
  contract: string | null
  side: 'long' | 'short'
  /** Contracts per 1 unit of the structure (e.g. 2 for the fly body). */
  qty: number
}

export interface CapacityView {
  medianAdv: number
  tier: 'deep' | 'moderate' | 'thin' | 'unknown'
  suggestedMaxContracts: number
  note: string
}

export interface TradePlanView {
  side: 1 | -1 | 0
  entry: number
  target: number
  stop: number | null
  /** $ per 1 structure (per contract set). */
  expectedUsd: number
  riskUsd: number | null
  rewardRisk: number | null
  entryZone: [number, number] | null
  pointValue: number
  /** Unit of entry/target/stop, e.g. "$/oz" or "ratio". */
  unit: string
  legs: ContractLegView[]
  capacity: CapacityView
  kelly: KellyView | null
  note: string
}

export interface SeasonalWindowView {
  entryDoy: number
  exitDoy: number
  /** Calendar labels of the entry/exit day, e.g. "12 Mar". */
  entryLabel: string
  exitLabel: string
  side: 'long' | 'short'
  years: number
  winRate: number
  avgPnl: number
  medianPnl: number
  tStat: number
  profitFactor: number
  avgMae: number
  avgMfe: number
  /** Today inside this window? */
  active: boolean
  perYear: { year: number; entryDate: string; exitDate: string; pnl: number; mae: number; mfe: number }[]
}

export interface MlView {
  pConverge: number | null
  pUp: number | null
  expectedMove: number | null
  horizonDays: number
  validationStatus: OosStatus
  /** True only when validationStatus === 'passed' (then it moves the rank). */
  counted: boolean
}

export interface LensView {
  key: string
  label: string
  stance: 'supports' | 'contradicts' | 'neutral' | 'absent'
  weight: number
  detail: string
}

export interface DecisionView {
  conviction: number
  convictionLabel: 'high' | 'moderate' | 'low' | 'conflicted'
  trap: boolean
  headline: string
  lenses: LensView[]
}

/** One row of the ranked scanner. */
export interface QuantOpportunity {
  id: string
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  label: string
  kind: QuantKind
  product: string
  asOf: string
  value: number
  unit: string
  z: number | null
  zEff: number | null
  halfLife: number | null
  score: number | null
  tier: QuantTier
  qtRank: number
  verdict: VerdictView
  carry: 'aligned' | 'conflict' | 'neutral' | null
  gates: GatesView
  oos: OosStatus
  survivesRegime: boolean | null
  mlProb: number | null
  mlCounted: boolean
  /** Active seasonal window, if today is inside one. */
  window: { side: 'long' | 'short'; entryLabel: string; exitLabel: string; winRate: number } | null
  evidence: string[]
}

export interface QuantSnapshot {
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  asOf: string
  dataThrough: string | null
  engine: EngineInfo
  counts: { instruments: number; buys: number; sells: number; passedOos: number }
  top: QuantOpportunity[]
  provenance: Provenance
  /** ML predictions were read and used (validated) for this many instruments. */
  mlCounted: number
}

export interface OpportunitiesResponse {
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  mode: QuantMode
  asOf: string
  dataThrough: string | null
  rows: QuantOpportunity[]
  provenance: Provenance
}

export interface SeriesBandPoint {
  date: string
  value: number
  mean: number | null
  sd: number | null
  z: number | null
}

export interface StructuralPoint {
  date: string
  /** σ-distance of the front outright from its trailing noise band. */
  outZ: number | null
  /** σ-distance of the curve slope (c1 − c0) from its trailing noise band. */
  slopeZ: number | null
}

/** One date of a cash-and-carry basis series. Rates are annualized percent (5.2 = 5.2%/yr). */
export interface BasisPointView {
  date: string
  /** Front contract used that day (the continuous-series roll), e.g. "BTCV26". */
  contract: string
  /** Calendar days from `date` to that contract's last trade. */
  daysToExpiry: number
  spot: number
  future: number
  /** (F/S − 1) × 365 / daysToExpiry, in % p.a. */
  basis: number
  /** Cash benchmark (13-week T-bill) in % p.a. */
  tbill: number
  /** basis − tbill: the long-spot / short-future return over cash, in % p.a. */
  excess: number
}

/** The cash-and-carry basis behind a `<root>.basis` instrument. */
export interface BasisView {
  spotSymbol: string
  rateSymbol: string
  rateLabel: string
  /** Reference rate the futures settle to (e.g. CME CF Bitcoin Reference Rate). */
  settlement: string
  /** Futures root and contract size (units of the asset per contract). */
  root: string
  contractSize: number
  priceUnit: string
  latest: BasisPointView
  /** Last trade of the latest front contract. */
  lastTrade: string | null
  /** Dates dropped because the front was within `minDays` calendar days of expiry. */
  excluded: number
  minDays: number
  /** $ per 1 bp of annualized basis, per contract, at today's spot and days to expiry. */
  dollarsPerBp: number
  /** Locked-in basis to expiry, $ per contract: (F − S) × contract size. */
  grossCarryUsd: number
  /** Cash cost of financing the spot leg to expiry at the T-bill, $ per contract. */
  fundingUsd: number
  /** Excess carry to expiry, $ per contract (gross carry − funding). */
  excessCarryUsd: number
  points: BasisPointView[]
}

export interface InstrumentDetail {
  id: string
  label: string
  kind: QuantKind
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  product: string
  unit: string
  pointValue: number
  asOf: string
  dataThrough: string | null
  legs: ContractLegView[]
  /** Value with its rolling mean/σ (the z-band chart). */
  series: SeriesBandPoint[]
  bandWindow: number
  score: ScoreView | null
  ou: OuView | null
  carry: CarryView | null
  gates: GatesView
  structural: { k: number; n: number; points: StructuralPoint[] } | null
  /** Butterfly curvature (mid − avg(wings)), flies only. */
  curvature: { date: string; value: number }[] | null
  verdicts: Record<QuantMode, VerdictView>
  decision: DecisionView
  plan: TradePlanView
  oos: OosView
  ml: MlView | null
  qtRank: number
  evidence: string[]
  window: SeasonalWindowView | null
  caveats: string[]
  provenance: Provenance
  /** Cash-and-carry basis instruments only. */
  basis?: BasisView | null
}

export interface EnvelopePoint {
  doy: number
  p10: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  mean: number | null
}

export interface YearPath {
  /** Contract/calendar year the path belongs to. */
  year: number
  points: { doy: number; value: number }[]
}

export interface MonthlyReturnsView {
  basis: 'pct' | 'abs'
  years: number[]
  cells: { year: number; month: number; ret: number | null }[]
  summary: { month: number; pctPositive: number; median: number; avg: number; best: number; worst: number }[]
}

export interface SeasonalityDetail {
  id: string
  label: string
  kind: QuantKind
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  unit: string
  /** 1 = calendar day-of-year axis; > 1 = season-day axis starting at this day-of-year. */
  originDoy: number
  /** Ticks for the x-axis on the (possibly shifted) day axis. */
  monthTicks: { doy: number; label: string }[]
  rebase: 'absolute' | 'rebaseZero' | 'rebasePct'
  envelope: EnvelopePoint[]
  current: YearPath | null
  perYear: YearPath[]
  monthly: MonthlyReturnsView
  windows: SeasonalWindowView[]
  oos: OosView
  asOf: string
  dataThrough: string | null
  provenance: Provenance
}

export interface RatioBandPoint {
  date: string
  value: number
  mean: number | null
  sd: number | null
}

/**
 * One relative-value pair from `RELATIVE_VALUE_PAIRS` (`pair` = its `key`, e.g.
 * 'gold-silver'). Numerator/denominator assets and their front futures come from
 * the universe; the payload keeps its original field names for compatibility.
 */
export interface RelativeValueDetail {
  /** `RelativeValuePair.key`. */
  pair: string
  asOf: string
  dataThrough: string | null
  ratio: {
    latest: number
    z: number | null
    zLong: number | null
    percentile: number | null
    bandWindow: number
    series: RatioBandPoint[]
    ou: OuView | null
    oos: OosView
    verdicts: Record<QuantMode, VerdictView>
    /**
     * Dollar-neutral ratio trade at the current front prices. Legacy field names:
     * `goldContracts` = NUMERATOR contracts (always 1), `silverContracts` =
     * DENOMINATOR contracts per 1 numerator contract.
     */
    hedge: { goldContracts: number; silverContracts: number; note: string }
  }
  spread: {
    latest: number
    z: number | null
    sigma: number | null
    /** Denominator contracts per 1 numerator contract that equalise trailing dollar volatility. */
    volParityRatio: number | null
    series: SeriesBandPoint[]
    ou: OuView | null
    oos: OosView
    verdicts: Record<QuantMode, VerdictView>
  }
  provenance: Provenance
}

export interface CurvePointView {
  symbol: string
  month: number
  year: number
  label: string
  lastTrade: string | null
  /** Calendar days from the curve date to the contract's last trade. */
  days: number | null
  price: number
  volume: number | null
  openInterest: number | null
  active: boolean
  source: 'databento' | 'yahoo'
  /** Annualized carry vs the front ACTIVE contract (fraction; 0.03 = 3%/yr). */
  annualizedCarry: number | null
}

export interface CurveView {
  root: string
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  asOf: string | null
  regime: 'contango' | 'backwardation' | 'flat' | 'mixed' | 'unknown'
  /** Annualized carry between the first two active contracts. */
  frontCarry: number | null
  points: CurvePointView[]
  /** Same curve ~1 month earlier (stored bars), for comparison. */
  prior: { asOf: string; points: { label: string; days: number | null; price: number }[] } | null
  live: { asOf: string; points: CurvePointView[] } | null
  liveNote: string | null
  provenance: Provenance
}

export interface EquityPointView {
  date: string
  model: number
  passive: number
  drawdown: number
}

export interface HistogramBin {
  from: number
  to: number
  count: number
}

export interface BacktestInstrumentRow {
  instrumentId: string
  label: string
  decisions: number
  buys: number
  modelPnl: number
  passivePnl: number
  modelAvg: number
  passiveAvg: number
  modelWinRate: number
}

export interface BacktestDecisionRow {
  date: string
  instrumentId: string
  z: number
  score: number
  direction: -1 | 0 | 1
  verdict: 'BUY' | 'AVOID'
  validationStatus: OosStatus
  exitDate: string
  modelPnl: number
  passivePnl: number
}

export interface BacktestView {
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  mode: QuantMode
  start: string
  end: string
  horizonDays: number
  dollarsAtRisk: number
  costPerTrade: number
  totals: {
    decisions: number
    buys: number
    modelPnl: number
    passivePnl: number
    modelAvg: number
    passiveAvg: number
    modelWinRate: number
    passiveWinRate: number
    maxDrawdown: number
    verdict: 'made money' | 'lost money' | 'flat'
  }
  equity: EquityPointView[]
  histogram: HistogramBin[]
  byInstrument: BacktestInstrumentRow[]
  decisions: BacktestDecisionRow[]
  provenance: Provenance
}

export interface GateAblationRow {
  gate: 'ou' | 'carry'
  label: string
  keptTrades: number
  removedTrades: number
  keptAvg: number
  removedAvg: number
  allAvg: number
  upliftPerTrade: number
  exShockUplift: number
  verdict: 'helps' | 'hurts' | 'neutral' | 'insufficient'
}

export interface GatesResponse {
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
  decisions: number
  rows: GateAblationRow[]
  note: string
  provenance: Provenance
}

export interface RecomputeResponse {
  job: string
  state: string
  startedAt: string | null
}

export interface InstrumentListItem {
  id: string
  label: string
  kind: QuantKind
  /** Asset id (wire name kept as `metal` for compatibility). */
  metal: AssetId
}

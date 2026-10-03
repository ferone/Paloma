// ML (Intelligence) domain contracts, shared by server/ml and src/features/intelligence.
// The cross-domain summary other domains read is `MlPredictionsLite` in shared/artifacts.ts.
import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetClass, type AssetId } from './universe.js'

/** Forecast horizon in trading days. Targets look H rows ahead. */
export const ML_HORIZON = 20

/** Gate thresholds (see `MlGate`). */
export const ML_GATE = {
  /**
   * Family-wise significance level across ALL trained markets. The per-model
   * permutation p must be below the Bonferroni-adjusted level
   * `ML_ALPHA_ADJUSTED` (= pValue / ML_TEST_COUNT), not below this.
   */
  pValue: 0.05,
  auc: 0.55,
  hit: 0.52,
  /** Fewer out-of-sample test years than this → "untested". */
  minTestYears: 3,
  /** Minimum calendar years of training history before a year can be a test year. */
  minTrainYears: 5,
  /** Recency: mean AUC over the last `recentYears` test years must reach `recentMinAuc` (an edge that has faded does not count). */
  recentYears: 2,
  recentMinAuc: 0.5,
} as const

/**
 * Number of hypotheses tested by the ML gate: one per trained market, i.e.
 * every asset in the universe (server/ml trains them all). Bonferroni divides
 * the family-wise α by this so that the chance of ANY market passing by luck
 * stays at about α, not 1 − (1 − α)^m (≈ 26% for six markets).
 */
export const ML_TEST_COUNT = ASSETS.length

/** Per-model permutation-p threshold after the Bonferroni correction. */
export const ML_ALPHA_ADJUSTED = ML_GATE.pValue / ML_TEST_COUNT

/** Chance that at least one of `m` independent null models passes at level `alpha`. */
export const familywiseFalsePassRate = (m: number = ML_TEST_COUNT, alpha: number = ML_GATE.pValue): number => 1 - (1 - alpha) ** m

export type ValidationStatus = 'passed' | 'failed' | 'untested'

export type FeatureGroup = 'momentum' | 'volatility' | 'trend' | 'cross-asset' | 'macro' | 'positioning' | 'curve' | 'seasonal' | 'flows'

export interface FeatureSpec {
  id: string
  label: string
  group: FeatureGroup
  /** Plain-words definition including the look-ahead rule. */
  description: string
  /** Where the input comes from. */
  source: 'yahoo' | 'fred' | 'cftc' | 'contracts' | 'calendar'
  /** Optional features may be absent (their feed not loaded yet); the model drops them. */
  optional: boolean
  /**
   * Asset classes for which an otherwise-core feature is optional because its
   * input starts much later than the asset's price history (e.g. spot bitcoin
   * ETFs launched in 2024; a 3-year seasonal needs 3 years). Core features
   * drop every row where they are missing, so without this a late feed would
   * truncate the whole training set.
   */
  optionalFor?: AssetClass[]
  /** Asset classes the feature applies to (default: every class). */
  classes?: AssetClass[]
  /** Explicit asset allow-list (default: every asset of the allowed classes). */
  onlyFor?: AssetId[]
  /** Applies only to assets that belong to a relative-value pair (the pair ratio is the input). */
  needsPair?: boolean
}

/**
 * Feature catalogue. Every feature at date t uses only data dated ≤ t
 * (macro series: < t, i.e. lagged one day; COT: only reports published before t).
 * `P` is the asset's reference close (`AssetSpec.spot`, e.g. GC=F / SI=F), returns are log returns.
 *
 * The catalogue is filtered per asset by `featuresFor` (`classes`, `onlyFor`,
 * `needsPair`); the CSV columns and their order follow this list.
 * - gsr_z252 needs a relative-value pair (gold and silver via gold/silver).
 * - gvz_level is an explicit gold + silver list: GVZ is gold's implied vol, and
 *   silver has always been trained with it as a precious-metals vol proxy. New
 *   precious assets (platinum, palladium) do NOT inherit it; decide per asset.
 */
export const FEATURES: FeatureSpec[] = [
  { id: 'mom5', label: '5-day momentum', group: 'momentum', source: 'yahoo', optional: false, description: 'ln(P_t / P_t−5).' },
  { id: 'mom20', label: '20-day momentum', group: 'momentum', source: 'yahoo', optional: false, description: 'ln(P_t / P_t−20).' },
  { id: 'mom60', label: '60-day momentum', group: 'momentum', source: 'yahoo', optional: false, description: 'ln(P_t / P_t−60).' },
  { id: 'mom120', label: '120-day momentum', group: 'momentum', source: 'yahoo', optional: false, description: 'ln(P_t / P_t−120).' },
  { id: 'rv20', label: '20-day realized vol', group: 'volatility', source: 'yahoo', optional: false, description: 'Annualized std. dev. of the last 20 daily log returns.' },
  { id: 'rv60', label: '60-day realized vol', group: 'volatility', source: 'yahoo', optional: false, description: 'Annualized std. dev. of the last 60 daily log returns.' },
  { id: 'volvol60', label: 'Vol of vol', group: 'volatility', source: 'yahoo', optional: false, description: 'Std. dev. of the 20-day realized vol over the last 60 days.' },
  { id: 'ma50_dist', label: 'Distance from 50d MA', group: 'trend', source: 'yahoo', optional: false, description: 'P_t / mean(P, 50d) − 1.' },
  { id: 'ma200_dist', label: 'Distance from 200d MA', group: 'trend', source: 'yahoo', optional: false, description: 'P_t / mean(P, 200d) − 1.' },
  { id: 'rsi14', label: 'RSI 14', group: 'trend', source: 'yahoo', optional: false, description: 'Wilder relative strength index over 14 days (0–100).' },
  { id: 'gsr_z252', label: 'Pair ratio z', group: 'cross-asset', source: 'yahoo', optional: false, needsPair: true, description: 'z-score over the trailing 252 days of the asset\'s relative-value pair ratio (numerator / denominator reference closes, e.g. GC/SI for gold and silver).' },
  { id: 'dxy_mom20', label: 'Dollar index 20d momentum', group: 'cross-asset', source: 'yahoo', optional: false, description: 'ln change of DX-Y.NYB over 20 days (as-of aligned).' },
  { id: 'tnx_chg20', label: '10y yield 20d change', group: 'cross-asset', source: 'yahoo', optional: false, description: 'Change in ^TNX (percentage points) over 20 days.' },
  { id: 'vix_level', label: 'VIX level', group: 'cross-asset', source: 'yahoo', optional: false, description: '^VIX close.' },
  { id: 'vix_chg20', label: 'VIX 20d change', group: 'cross-asset', source: 'yahoo', optional: false, description: 'Change in ^VIX over 20 days.' },
  { id: 'spy_mom20', label: 'S&P 500 20d momentum', group: 'cross-asset', source: 'yahoo', optional: false, description: 'ln change of SPY over 20 days.' },
  { id: 'etf_volume_z', label: 'ETF volume z (flows proxy)', group: 'flows', source: 'yahoo', optional: true, description: 'z-score (120d) of the 5-day mean log volume of the asset\'s benchmark ETF (GLD for gold, SLV for silver).' },
  { id: 'doy_sin', label: 'Day of year (sin)', group: 'seasonal', source: 'calendar', optional: false, description: 'sin(2π·doy/365.25).' },
  { id: 'doy_cos', label: 'Day of year (cos)', group: 'seasonal', source: 'calendar', optional: false, description: 'cos(2π·doy/365.25).' },
  { id: 'seasonal_drift', label: 'Seasonal drift', group: 'seasonal', source: 'yahoo', optional: true, classes: ['precious', 'industrial'], description: 'Mean 20-day forward return from the same ±10 calendar days in prior years, using only windows fully completed by t (≥3 years).' },
  { id: 'real_yield_chg20', label: 'Real yield 20d change', group: 'macro', source: 'fred', optional: true, description: 'Change in 10y TIPS yield (FRED DFII10) over 20 observations, lagged one day.' },
  { id: 'breakeven_chg20', label: 'Breakeven 20d change', group: 'macro', source: 'fred', optional: true, description: 'Change in 10y breakeven inflation (FRED T10YIE) over 20 observations, lagged one day.' },
  { id: 'usd_broad_mom20', label: 'Broad dollar 20d momentum', group: 'macro', source: 'fred', optional: true, description: 'ln change of the trade-weighted dollar (FRED DTWEXBGS) over 20 observations, lagged one day.' },
  { id: 'gvz_level', label: 'Gold VIX (GVZ)', group: 'macro', source: 'fred', optional: true, onlyFor: ['gold', 'silver'], description: 'CBOE gold volatility index (FRED GVZCLS), lagged one day.' },
  { id: 'cot_mm_z', label: 'COT speculator z', group: 'positioning', source: 'cftc', optional: true, description: 'z-score (156 reports) of speculator net positions as % of open interest (managed money in the disaggregated report, leveraged funds in TFF); a report is used only from the day after it was published.' },
  { id: 'oi_z', label: 'Open interest z', group: 'positioning', source: 'contracts', optional: true, description: 'z-score over the trailing 252 sessions of front-month open interest (the most-held contract before its first-notice day). Open interest for day d is published after d\'s settlement, so it is used from d+1.' },
  { id: 'oi_chg20', label: 'Open interest 20d change', group: 'positioning', source: 'contracts', optional: true, description: '% change over 20 sessions of total open interest across all listed contracts (front month when no total is available); each day\'s figure is used from the next day.' },
  { id: 'oi_price_div', label: 'Price / open interest agreement', group: 'positioning', source: 'contracts', optional: true, description: 'sign(20d price change) × sign(20d open-interest change): +1 when price and open interest move together (new positions behind the move), −1 when they diverge (short covering or liquidation). Open interest used from d+1.' },
  { id: 'curve_spread_z', label: 'Front spread z', group: 'curve', source: 'contracts', optional: true, description: 'z-score (252d) of (2nd − 1st active contract) / 1st.' },
  { id: 'curve_fly_z', label: 'Front butterfly z', group: 'curve', source: 'contracts', optional: true, description: 'z-score (252d) of (1st − 2·2nd + 3rd) / 1st.' },
  { id: 'carry_slope', label: 'Carry slope', group: 'curve', source: 'contracts', optional: true, description: 'Annualized ln(2nd / 1st) per month between the two contracts.' },
]

/** Every feature id in the catalogue (the union across assets). */
export const FEATURE_IDS = FEATURES.map((f) => f.id)

/** Whether a catalogue feature applies to an asset. */
export function featureApplies(f: FeatureSpec, asset: AssetId): boolean {
  if (f.classes && !f.classes.includes(UNIVERSE[asset].assetClass)) return false
  if (f.onlyFor && !f.onlyFor.includes(asset)) return false
  if (f.needsPair && !RELATIVE_VALUE_PAIRS.some((p) => p.numerator === asset || p.denominator === asset)) return false
  return true
}

/** Whether a feature is optional for this asset (always-optional, or optional for its class). */
export function isOptionalFor(f: FeatureSpec, asset: AssetId): boolean {
  return f.optional || (f.optionalFor?.includes(UNIVERSE[asset].assetClass) ?? false)
}

/** The features modelled for an asset, in catalogue order. */
export function featuresFor(asset: AssetId): FeatureSpec[] {
  return FEATURES.filter((f) => featureApplies(f, asset))
}

/** Instrument id used in ml_predictions and the cross-domain artifact: `<front root>.out`. */
export const mlInstrumentFor = (asset: AssetId): string => `${UNIVERSE[asset].futures[0]?.root ?? asset.toUpperCase()}.out`

/** Instrument id per asset (derived from each spec's front futures root). */
export const ML_INSTRUMENT = Object.fromEntries(ASSETS.map((a) => [a, mlInstrumentFor(a)])) as Record<AssetId, string>

export interface FeatureAvailability {
  id: string
  used: boolean
  /** Why it was dropped (e.g. "COT not loaded yet", "coverage 41% < 60%"). */
  reason?: string
  /** Fraction of trainable rows where the feature is present. */
  coverage: number
  firstDate: string | null
  /** Core features must exist on every trainable row (they set the span); optional ones may be missing. Absent on older runs. */
  core?: boolean
}

/** Where a run's model families ran (ML_DEVICE / settings `ml.device`). */
export type MlDeviceMode = 'auto' | 'cuda' | 'cpu'
export type MlDevice = 'cuda' | 'cpu'
export const ML_DEVICE_MODES: readonly MlDeviceMode[] = ['auto', 'cuda', 'cpu']

/** Per-family timings of the `auto` micro-benchmark, in seconds for one fold's fits over all permutation shifts. */
export interface MlDeviceBenchmark {
  fold: number
  trainRows: number
  features: number
  nPerm: number
  gb: { workers: number; cpu: number | null; cuda: number | null }
  logit: { columns: number; cpu: number | null; cuda: number | null }
}

export interface MlCompute {
  requested: MlDeviceMode
  devices: Record<MlFamily, MlDevice>
  gpu: string | null
  cudaAvailable: boolean
  /** CPU worker threads for the per-shift tree fits. */
  workers: number
  benchmark: MlDeviceBenchmark | null
  notes: string[]
  timings: {
    wallSec: number
    benchmarkSec: number
    walkForwardSec: number
    permutationSec: number
    finalFitSec: number
    /** Seconds spent per family inside the permutation test. */
    permutationFamilySec: Partial<Record<MlFamily, number>>
  }
}

/** Training span: labeled rows where every core feature exists. */
export interface MlSpan {
  from: string
  to: string
  rows: number
  testFrom: number | null
  testTo: number | null
  /** Out-of-sample (walk-forward test) rows. */
  oosRows: number
}

/** Per-day walk-forward out-of-sample series, columnar (every `step`-th day when downsampled). */
export interface MlOosSeries {
  date: string[]
  /** Out-of-sample P(up) from the model chosen for that test year. */
  p: number[]
  /** Realized outcome: 1 if the 20-day forward return was positive. */
  y: (0 | 1)[]
  testYear: number[]
  step: number
}

/** Direction-model families the pipeline selects between (nested, per training window). */
export type MlFamily = 'gb' | 'logit'
export const ML_FAMILY_LABEL: Record<MlFamily, string> = {
  gb: 'Gradient boosting',
  logit: 'Logistic regression',
}
/** The comparator of the "beats baseline" check: the next simpler model. */
export type MlBaselineKind = 'logistic' | 'naive'
export const ML_BASELINE_LABEL: Record<MlBaselineKind | 'mixed', string> = {
  logistic: 'logistic regression',
  naive: 'naive base rate',
  mixed: 'next simpler model per fold',
}

export interface MlSelection {
  /** Family of the saved model, chosen on all labeled rows by the same inner walk-forward. */
  family: MlFamily
  label: string
  innerAuc: Partial<Record<MlFamily, number | null>>
  innerYears: number[]
  /** How often each family was chosen across the outer walk-forward folds. */
  foldFamilies: Partial<Record<MlFamily, number>>
  method: string
}

export interface MlFold {
  testYear: number
  nTrain: number
  nTest: number
  /** Rows purged from the end of the training window (label overlap). */
  purged: number
  /** Model family chosen on this fold's training window only (absent on older runs = gradient boosting). */
  family?: MlFamily
  /** Mean inner walk-forward AUC per family that drove the choice. */
  innerAuc?: Partial<Record<MlFamily, number | null>>
  /** What `baselineAuc` measures: the logistic model, or the naive base rate when logistic itself was chosen. */
  baselineKind?: MlBaselineKind
  auc: number | null
  hit: number
  brier: number
  /** Share of up-moves in the test year (hit rate of "always up"). */
  baseRate: number
  baselineAuc: number | null
  baselineHit: number
  /** Regressor RMSE on 20d log return. */
  rmse: number
  /** Spearman rank correlation between predicted and realized return. */
  ic: number | null
}

export interface MlPermutation {
  /** Latest test year. Older runs tested only this year; newer runs test them all (`testYears`). */
  holdoutYear: number
  /** What realAuc / nullAucs measure. Absent on older runs (holdout-year AUC of a lighter model). */
  statistic?: string
  /** Test years the statistic averages over (newer runs: every walk-forward fold). */
  testYears?: number[]
  /** Family chosen per fold on the real labels. */
  foldFamilies?: MlFamily[]
  /** Newer runs: equals summary.auc (mean walk-forward AUC of the full procedure). */
  realAuc: number
  nullAucs: number[]
  nullMean: number
  null95: number
  nPerm: number
  pValue: number
  /** How labels were shuffled (block permutation preserves overlap). */
  method: string
  /** Share of null fold fits that selected each family. */
  nullFamilyShare?: Partial<Record<MlFamily, number>>
}

export interface MlGate {
  status: ValidationStatus
  /** Human-readable reasons, e.g. "AUC 0.53 < 0.55". Empty when passed. */
  reasons: string[]
  checks: { id: 'pValue' | 'auc' | 'hit' | 'baseline' | 'folds' | 'recent'; label: string; value: number | null; threshold: number | null; ok: boolean }[]
  /**
   * Multiple-testing correction applied to the permutation p (the pValue
   * check's threshold is `alphaAdjusted`). Absent on runs trained before the
   * correction existed, which were gated at the raw 0.05.
   */
  multipleTesting?: MlMultipleTesting
}

export interface MlMultipleTesting {
  method: 'bonferroni'
  /** Markets tested (hypotheses in the family). */
  tests: number
  /** Family-wise α. */
  alpha: number
  /** α / tests: the per-model threshold the gate uses. */
  alphaAdjusted: number
}

export interface MlSummaryMetrics {
  folds: number
  /** Folds per chosen family (absent on older runs). */
  familyCounts?: Partial<Record<MlFamily, number>>
  /** Comparator behind `baselineAuc`; 'mixed' when folds chose different families. */
  baselineKind?: MlBaselineKind | 'mixed' | null
  auc: number | null
  hit: number | null
  brier: number | null
  baseRate: number | null
  baselineAuc: number | null
  baselineHit: number | null
  rmse: number | null
  ic: number | null
  /** AUC over all out-of-sample predictions pooled together. */
  pooledAuc: number | null
}

export interface MlImportance {
  feature: string
  mean: number
  std: number
}

export interface MlCalibrationBin {
  lo: number
  hi: number
  meanPredicted: number | null
  observed: number | null
  count: number
}

export interface MlMetrics {
  summary: MlSummaryMetrics
  folds: MlFold[]
  permutation: MlPermutation | null
  gate: MlGate
  /** Model-family selection (absent on runs before selection existed: gradient boosting only). */
  selection?: MlSelection
  /** Out-of-sample residual quantiles of the 20d log return (for the move band). */
  residualQuantiles: { q10: number; q90: number } | null
  nRows: number
  dataFrom: string | null
  dataThrough: string | null
  /** Last date with a realized 20d label. */
  labelThrough: string | null
  durationSec: number
  sklearnVersion: string | null
  xgboostVersion?: string | null
  torchVersion?: string | null
  /** Training span (absent on older runs: use dataFrom / labelThrough / nRows). */
  span?: MlSpan
  /** Devices, benchmark and timings (absent on runs before the GPU pipeline). */
  compute?: MlCompute
  /** Walk-forward out-of-sample P(up) per day with the realized outcome (absent on older runs). */
  oos?: MlOosSeries
}

export interface MlRunSummary {
  id: number
  metal: AssetId
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'succeeded' | 'failed'
  validationStatus: ValidationStatus | null
  auc: number | null
  pValue: number | null
  folds: number | null
  dataThrough: string | null
  error: string | null
  /** Pipeline wall time in seconds (absent on older runs). */
  durationSec?: number | null
  /** Device per family (absent on runs before the GPU pipeline). */
  devices?: Record<MlFamily, MlDevice> | null
  gpu?: string | null
  /** Training span (first / last labeled date, rows). */
  span?: { from: string; to: string; rows: number } | null
}

export interface MlRunParams {
  horizon: number
  nPerm: number
  /** Bonferroni family size the run was gated with (absent on older runs). */
  nTests?: number
  /** Family of the saved model (absent on older runs = gradient boosting). */
  family?: MlFamily
  /** Requested device mode (absent on older runs = CPU). */
  device?: MlDeviceMode
  minTrainYears: number
  model: string
  baseline: string
}

export interface MlRunDetail extends MlRunSummary {
  params: MlRunParams | null
  featuresUsed: string[]
  availability: FeatureAvailability[]
  metrics: MlMetrics | null
  importance: MlImportance[]
  calibration: MlCalibrationBin[]
  modelPath: string | null
}

export interface MlPrediction {
  runId: number
  metal: AssetId
  instrumentId: string
  /** Date of the feature row that was scored. */
  date: string
  horizonDays: number
  pUp: number
  /** 80% interval of the historical hit frequency when the model gave a similar probability. */
  pUpLow: number | null
  pUpHigh: number | null
  /** Expected 20d move as a fraction (0.012 = +1.2%). */
  expectedMove: number
  /** 10th–90th percentile band for the move, from out-of-sample residuals. */
  lower: number | null
  upper: number | null
  validationStatus: ValidationStatus
  /** Gate reasons carried with the prediction for display. */
  reasons: string[]
  createdAt: string
  trainedAt: string | null
}

export interface MlPythonStatus {
  available: boolean
  interpreter: string | null
  pythonVersion: string | null
  sklearnVersion: string | null
  xgboostVersion?: string | null
  torchVersion?: string | null
  /** CUDA usable by torch, and the GPU name. */
  cuda?: boolean
  gpu?: string | null
  /** Device mode the next run will request (settings `ml.device`, else env ML_DEVICE, else auto). */
  deviceMode?: MlDeviceMode
  error: string | null
}

export interface MlStatus {
  python: MlPythonStatus
  lastRuns: Partial<Record<AssetId, MlRunSummary>>
  /** Model older than this many days is retrained automatically on inference. */
  maxModelAgeDays: number
}

export interface MlPredictionsResponse {
  predictions: MlPrediction[]
}

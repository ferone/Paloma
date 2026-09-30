// Portfolio domain contracts: ledger entities, request bodies (zod) and every
// /api/portfolio response shape. Shared by the server and the client.
import { z } from 'zod'
import type { Provenance } from './api.js'
import type { PortfolioSummaryLite, Sleeve } from './artifacts.js'
import { ASSETS, UNIVERSE, type AssetId, type AssetSpec, type InstrumentKind, type PhysicalSpec, type PriceUnit } from './universe.js'

export type { Sleeve } from './artifacts.js'

// ---------------------------------------------------------------------------
// Ledger entities
// ---------------------------------------------------------------------------

export const CUSTODY_TYPES = ['broker', 'vault', 'bank', 'wallet', 'exchange'] as const
export type CustodyType = (typeof CUSTODY_TYPES)[number]
export const CUSTODY_LABEL: Record<CustodyType, string> = {
  broker: 'Broker',
  vault: 'Vault',
  bank: 'Bank',
  wallet: 'Wallet (self-custody)',
  exchange: 'Exchange account',
}

/**
 * Transaction semantics (quantity is always the number of units the type
 * speaks about; `price` is per unit; `fees` are extra cash paid):
 * - buy / sell            ETF, equity or a physical holding. Quantity in shares
 *                         or the asset's physical unit (fine troy oz for
 *                         bullion; e.g. BTC for a custody balance).
 *                         Cash −(q·p + fees) / +(q·p − fees).
 * - futures_open          Quantity = signed contracts (+ long, − short); price
 *                         = entry price in the asset's quote (spec.unitLabel).
 *                         Only fees move cash (variation margin is marked
 *                         through NAV, not as a cash payment).
 * - futures_close         Quantity = contracts closed (> 0), FIFO against the
 *                         open position; price = exit price. Realized P&L
 *                         (Δprice × pointValue × contracts) is credited to cash.
 * - subscription / redemption  Investor cash in/out (USD amount in quantity,
 *                         price 1). Issues/cancels units at that day's NAV/unit.
 * - deposit / withdrawal  In-kind contribution/withdrawal of an instrument
 *                         (or cash) valued at `price`. Also unitized.
 * - fee / storage_fee     Expense (USD amount in quantity). Attributed to the
 *                         instrument given (fund-level when USD cash).
 * - dividend / interest   Income (USD amount in quantity).
 * - transfer              Moves quantity from account_id to counter_account_id.
 *                         No value effect.
 */
export const TXN_TYPES = [
  'buy',
  'sell',
  'deposit',
  'withdrawal',
  'subscription',
  'redemption',
  'fee',
  'storage_fee',
  'dividend',
  'interest',
  'futures_open',
  'futures_close',
  'transfer',
] as const
export type TxnType = (typeof TXN_TYPES)[number]

/** Instrument kinds each transaction type may reference. */
export const TXN_ALLOWED_KINDS: Record<TxnType, readonly InstrumentKind[]> = {
  buy: ['etf', 'equity', 'physical'],
  sell: ['etf', 'equity', 'physical'],
  futures_open: ['future'],
  futures_close: ['future'],
  subscription: ['cash'],
  redemption: ['cash'],
  interest: ['cash'],
  dividend: ['etf', 'equity', 'cash'],
  fee: ['cash', 'etf', 'equity', 'physical', 'future'],
  storage_fee: ['cash', 'physical'],
  deposit: ['cash', 'etf', 'equity', 'physical'],
  withdrawal: ['cash', 'etf', 'equity', 'physical'],
  transfer: ['cash', 'etf', 'equity', 'physical'],
}

/** Types whose quantity is a USD amount (price is fixed to 1). */
export const CASH_AMOUNT_TYPES: readonly TxnType[] = ['subscription', 'redemption', 'fee', 'storage_fee', 'dividend', 'interest']
/** External capital flows (unitized; excluded from performance). */
export const EXTERNAL_FLOW_TYPES: readonly TxnType[] = ['subscription', 'redemption', 'deposit', 'withdrawal']

export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  buy: 'Buy',
  sell: 'Sell',
  deposit: 'Deposit (in kind)',
  withdrawal: 'Withdrawal (in kind)',
  subscription: 'Subscription',
  redemption: 'Redemption',
  fee: 'Fee',
  storage_fee: 'Storage fee',
  dividend: 'Dividend',
  interest: 'Interest',
  futures_open: 'Futures open',
  futures_close: 'Futures close',
  transfer: 'Transfer',
}

export interface Account {
  id: number
  name: string
  custody: CustodyType
  institution: string | null
  notes: string | null
  createdAt: string
}

export interface Instrument {
  /** Stable id: ETF/equity ticker, futures root, a spec's `physical.instrumentId`, 'USD'. */
  id: string
  name: string
  kind: InstrumentKind
  asset: AssetId | null
  /** Yahoo symbol used to value the instrument. null for cash. */
  priceSymbol: string | null
  /** Dollars per 1.00 price move per contract (futures only; the universe `pointValue`). */
  pointValue: number | null
  /** Units of the underlying per contract, in the asset's `priceUnit` (futures only). */
  contractSize: number | null
}

export interface Transaction {
  id: number
  tradeDate: string
  settleDate: string | null
  accountId: number
  counterAccountId: number | null
  instrumentId: string
  type: TxnType
  quantity: number
  price: number
  fees: number
  currency: 'USD'
  notes: string | null
  importBatch: string | null
  createdAt: string
  updatedAt: string
}

/** `bar` / `coin` / `round`: bullion. `balance`: a custody balance (wallet or exchange account). */
export const PHYSICAL_FORMS = ['bar', 'coin', 'round', 'balance'] as const
export type PhysicalForm = (typeof PHYSICAL_FORMS)[number]
export const BULLION_FORMS: readonly PhysicalForm[] = ['bar', 'coin', 'round']
/** Weight units for bullion (converted to fine troy oz). */
export const BULLION_WEIGHT_UNITS = ['oz', 'g', 'kg'] as const
export type BullionWeightUnit = (typeof BULLION_WEIGHT_UNITS)[number]
/** Every unit a register item may be recorded in: bullion weights plus custody units. */
export const WEIGHT_UNITS = ['oz', 'g', 'kg', 'BTC'] as const
export type WeightUnit = (typeof WEIGHT_UNITS)[number]

export interface PhysicalItem {
  id: number
  asset: AssetId
  form: PhysicalForm
  description: string
  /** Bullion: gross weight in `weightUnit`. Custody: the balance, in the asset's physical unit. */
  weight: number
  weightUnit: WeightUnit
  /** Fineness, e.g. 0.9999 (1 for custody balances). */
  purity: number
  /** Fine quantity in the asset's physical unit: bullion weight (troy oz) × purity; custody = the balance. */
  fineQty: number
  serial: string | null
  refiner: string | null
  accountId: number | null
  acquisitionTxnId: number | null
  acquiredDate: string | null
  /** Premium over spot paid at acquisition (USD, total). */
  premiumPaid: number | null
  /** Annual storage fee rate as a fraction of value (0.0012 = 12 bp). */
  storageFeeRateAnnual: number | null
  status: 'held' | 'sold'
  notes: string | null
}

export interface ImportBatch {
  id: string
  filename: string | null
  createdAt: string
  rowCount: number
  status: 'committed' | 'rolled_back'
  rolledBackAt: string | null
}

export interface AuditEntry {
  id: number
  entity: string
  entityId: string
  action: 'create' | 'update' | 'delete'
  before: unknown
  after: unknown
  at: string
}

export interface PortfolioSettings {
  /** First valuation date; null = date of the first transaction. */
  inceptionDate: string | null
  /** NAV/unit set by the first subscription. */
  baseNavPerUnit: number
  /** Haircut applied to physical metal valuation (0.01 = 1%). */
  physicalHaircut: number
  /** Annual risk-free rate as a fraction, or 'irx' to use ^IRX (13-week T-bill). */
  riskFree: number | 'irx'
  /** Custom benchmark blend weights by Yahoo symbol (sum to 1). */
  blend: { symbol: string; weight: number }[]
}

/**
 * Default benchmark blend: the precious-metals sleeve, weighted by policy and
 * resolved to each asset's `benchmarkEtf`. Assets without a weight are left
 * out of the default blend (the blend is editable in Fund setup).
 */
export const DEFAULT_BLEND_WEIGHTS: Partial<Record<AssetId, number>> = { gold: 0.7, silver: 0.3 }

export function defaultBlend(): { symbol: string; weight: number }[] {
  return ASSETS.filter((a) => DEFAULT_BLEND_WEIGHTS[a]).map((a) => ({ symbol: UNIVERSE[a].benchmarkEtf, weight: DEFAULT_BLEND_WEIGHTS[a]! }))
}

export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  inceptionDate: null,
  baseNavPerUnit: 100,
  physicalHaircut: 0,
  riskFree: 0,
  blend: defaultBlend(),
}

// ---------------------------------------------------------------------------
// Request bodies (validated with zod on the server; reused by client forms)
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  custody: z.enum(CUSTODY_TYPES),
  institution: z.string().trim().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
})
export type AccountInput = z.infer<typeof accountInputSchema>

export const transactionInputSchema = z
  .object({
    tradeDate: isoDate,
    settleDate: isoDate.nullish(),
    accountId: z.number().int().positive(),
    counterAccountId: z.number().int().positive().nullish(),
    instrumentId: z.string().trim().min(1),
    type: z.enum(TXN_TYPES),
    quantity: z.number().finite(),
    price: z.number().finite().nonnegative().default(1),
    fees: z.number().finite().nonnegative().default(0),
    notes: z.string().max(2000).nullish(),
  })
  .superRefine((t, ctx) => {
    if (t.type === 'futures_open') {
      if (t.quantity === 0) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Contracts must be non-zero (+long / −short)' })
    } else if (!(t.quantity > 0)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Quantity must be positive' })
    }
    if (t.type === 'transfer' && !t.counterAccountId)
      ctx.addIssue({ code: 'custom', path: ['counterAccountId'], message: 'Transfers need a destination account' })
    if (t.type === 'transfer' && t.counterAccountId === t.accountId)
      ctx.addIssue({ code: 'custom', path: ['counterAccountId'], message: 'Destination must differ from source' })
    if (t.settleDate && t.settleDate < t.tradeDate)
      ctx.addIssue({ code: 'custom', path: ['settleDate'], message: 'Settlement precedes trade date' })
  })
export type TransactionInput = z.input<typeof transactionInputSchema>

export const physicalItemInputSchema = z
  .object({
    asset: z.enum(ASSETS as [AssetId, ...AssetId[]]).refine((a) => UNIVERSE[a].physical != null, 'This asset cannot be held directly'),
    form: z.enum(PHYSICAL_FORMS),
    description: z.string().trim().min(1).max(200),
    weight: z.number().positive(),
    weightUnit: z.enum(WEIGHT_UNITS),
    purity: z.number().gt(0).max(1),
    serial: z.string().trim().max(80).nullish(),
    refiner: z.string().trim().max(120).nullish(),
    accountId: z.number().int().positive().nullish(),
    acquisitionTxnId: z.number().int().positive().nullish(),
    acquiredDate: isoDate.nullish(),
    premiumPaid: z.number().nonnegative().nullish(),
    storageFeeRateAnnual: z.number().min(0).max(0.2).nullish(),
    status: z.enum(['held', 'sold']).default('held'),
    notes: z.string().max(2000).nullish(),
    /** When set, also records a `buy` of the asset's physical instrument at this all-in total cost. */
    recordPurchase: z
      .object({ totalCost: z.number().positive(), fees: z.number().nonnegative().default(0), accountId: z.number().int().positive() })
      .nullish(),
  })
  .superRefine((p, ctx) => {
    const phys = UNIVERSE[p.asset].physical
    if (!phys) return
    for (const i of physicalItemIssues(phys, p)) ctx.addIssue({ code: 'custom', path: [i.path], message: i.message })
  })
export type PhysicalItemInput = z.input<typeof physicalItemInputSchema>

export const settingsInputSchema = z.object({
  inceptionDate: isoDate.nullable().optional(),
  baseNavPerUnit: z.number().positive().optional(),
  physicalHaircut: z.number().min(0).max(0.5).optional(),
  riskFree: z.union([z.number().min(-0.05).max(0.25), z.literal('irx')]).optional(),
  blend: z
    .array(z.object({ symbol: z.string().trim().min(1), weight: z.number().min(0).max(1) }))
    .min(1)
    .refine((b) => Math.abs(b.reduce((s, x) => s + x.weight, 0) - 1) < 1e-6, 'Blend weights must sum to 1')
    .optional(),
})
export type SettingsInput = z.infer<typeof settingsInputSchema>

/** Canonical import fields a CSV column can map to. */
export const IMPORT_FIELDS = ['tradeDate', 'settleDate', 'type', 'instrument', 'account', 'quantity', 'price', 'fees', 'amount', 'notes', 'counterAccount'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
export type ImportMapping = Partial<Record<ImportField, string>>

export const importPreviewSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  mapping: z.record(z.string(), z.string()).optional(),
  defaultAccountId: z.number().int().positive().nullish(),
  filename: z.string().max(260).nullish(),
})
export type ImportPreviewRequest = z.infer<typeof importPreviewSchema>

export const importCommitSchema = importPreviewSchema.extend({
  /** Skip rows flagged as duplicates of existing ledger rows (default true). */
  skipDuplicates: z.boolean().default(true),
})
export type ImportCommitRequest = z.input<typeof importCommitSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface LotView {
  txnId: number | null
  accountId: number | null
  openDate: string
  /** Signed quantity (negative = short). */
  quantity: number
  /** Cost per unit incl. acquisition fees (futures: entry $/oz). */
  unitCost: number
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  holdingDays: number
}

export interface HoldingView {
  instrumentId: string
  name: string
  kind: InstrumentKind
  sleeve: Sleeve
  asset: AssetId | null
  /** Shares, physical units (fine oz, BTC…) or contracts (signed). */
  quantity: number
  /**
   * Signed exposure in the asset's unit (`unitLabel`): the physical quantity;
   * futures contracts × contractSize; ETFs value ÷ spot (unit-equivalent).
   * null for miners/equities, cash, or when no price is available.
   */
  exposureUnits: number | null
  /** Unit of `exposureUnits`: the asset's `priceUnit` (oz, lb, BTC). null without an asset. */
  unitLabel: PriceUnit | null
  /** Signed USD exposure to the underlying (notional × direction). null for miners/equities and cash. */
  exposureNotional: number | null
  price: number | null
  priceDate: string | null
  /** True when the mark is a fallback (last trade price) or older than 5 days. */
  priceStale: boolean
  /** NAV contribution: market value; futures = unrealized variation P&L. */
  value: number
  /** Gross notional exposure (futures: contracts × oz × price). */
  notional: number
  costBasis: number
  avgCost: number | null
  unrealizedPnl: number
  realizedPnl: number
  income: number
  expenses: number
  /** Total P&L since inception: realized + unrealized + income − expenses. */
  totalPnl: number
  weight: number
  dayPnl: number | null
  lots: LotView[]
}

export interface CashBalance {
  accountId: number | null
  accountName: string
  balance: number
}

export interface HoldingsResponse {
  asOf: string | null
  nav: number
  holdings: HoldingView[]
  cash: CashBalance[]
  totalCash: number
  warnings: string[]
  provenance: Provenance
}

export interface AllocationSlice {
  key: string
  label: string
  value: number
  weight: number
}

export interface PortfolioSummary extends PortfolioSummaryLite {
  empty: boolean
  inceptionDate: string | null
  cash: number
  grossExposure: number
  /** Net exposure per asset, each in its own unit (miners excluded). */
  netExposure: AssetExposure[]
  unrealizedPnl: number
  realizedPnl: number
  income: number
  expenses: number
  totalPnl: number
  netContributions: number
  transactionCount: number
  warnings: string[]
  provenance: Provenance
}

export interface AssetExposure {
  asset: AssetId
  exposureUnits: number
  unitLabel: PriceUnit
}

export interface NavPointView {
  date: string
  nav: number
  units: number
  navPerUnit: number | null
  cash: number
  grossExposure: number
  netFlow: number
  bySleeve: Partial<Record<Sleeve, number>>
  byAsset: Partial<Record<AssetId | 'cash' | 'other', number>>
}

export interface NavSeriesResponse {
  points: NavPointView[]
  provenance: Provenance
}

export interface UnitEntry {
  date: string
  txnId: number
  type: 'subscription' | 'redemption' | 'deposit' | 'withdrawal'
  amount: number
  navPerUnit: number
  /** Signed: + issued, − cancelled. */
  units: number
  unitsOutstanding: number
}

export interface UnitsResponse {
  entries: UnitEntry[]
  unitsOutstanding: number
  navPerUnit: number | null
  provenance: Provenance
}

/** "Gold (GC=F)": an asset's reference price series. */
export function spotLabel(spec: AssetSpec): string {
  return `${spec.label} (${spec.spot})`
}

/** A Yahoo symbol listed in BENCHMARKS, or 'blend' (the settings blend). */
export type BenchmarkId = string
/** From the universe: each asset's benchmark ETF, then each asset's reference series, then the blend. */
export const BENCHMARKS: { id: BenchmarkId; label: string }[] = [
  ...ASSETS.map((a) => ({ id: UNIVERSE[a].benchmarkEtf, label: UNIVERSE[a].benchmarkEtf })),
  ...ASSETS.map((a) => ({ id: UNIVERSE[a].spot, label: spotLabel(UNIVERSE[a]) })),
  { id: 'blend', label: 'Blend' },
]
/** Default benchmark: the first asset's benchmark ETF. */
export const DEFAULT_BENCHMARK: BenchmarkId = UNIVERSE[ASSETS[0]].benchmarkEtf

export interface DrawdownInfo {
  maxDrawdown: number
  peakDate: string | null
  troughDate: string | null
  recoveryDate: string | null
  /** Calendar days from peak to recovery (or to the last date if not recovered). */
  durationDays: number | null
  current: number
}

export interface MonthlyReturnsRow {
  year: number
  /** Index 0 = Jan. null where the fund had no NAV that month. */
  months: (number | null)[]
  ytd: number | null
}

export interface PerformanceStats {
  twr: number | null
  annualizedReturn: number | null
  irr: number | null
  volatility: number | null
  sharpe: number | null
  sortino: number | null
  calmar: number | null
  bestDay: number | null
  worstDay: number | null
  positiveDays: number | null
  days: number
}

export interface PerformanceResponse {
  from: string | null
  to: string | null
  benchmark: BenchmarkId
  benchmarkLabel: string
  riskFreeRate: number
  /** NAV/unit and the benchmark, both rebased to 100 at `from`. */
  series: { date: string; fund: number; benchmark: number | null }[]
  drawdownSeries: { date: string; drawdown: number }[]
  rollingVol: { date: string; vol: number }[]
  monthly: MonthlyReturnsRow[]
  stats: PerformanceStats
  benchmarkStats: PerformanceStats | null
  drawdown: DrawdownInfo
  periodReturns: { day: number | null; mtd: number | null; ytd: number | null; itd: number | null }
  provenance: Provenance
}

export interface VarEstimate {
  confidence: number
  horizonDays: number
  historicalPct: number | null
  historicalUsd: number | null
  historicalCvarPct: number | null
  historicalCvarUsd: number | null
  parametricPct: number | null
  parametricUsd: number | null
  parametricCvarPct: number | null
  parametricCvarUsd: number | null
}

export interface BetaEstimate {
  symbol: string
  label: string
  beta: number | null
  correlation: number | null
  observations: number
}

export interface RiskResponse {
  asOf: string | null
  nav: number
  observations: number
  volatility: number | null
  var: VarEstimate[]
  betas: BetaEstimate[]
  drawdown: DrawdownInfo
  grossExposure: number
  grossLeverage: number | null
  exposureByAsset: (AssetExposure & { notional: number })[]
  provenance: Provenance
}

export interface AttributionRow {
  key: string
  label: string
  pnl: number
  /** Growth-linked contribution to TWR over the period (fraction); rows sum to `twr`. */
  contribution: number
  startValue: number
  endValue: number
}

export interface AttributionResponse {
  from: string | null
  to: string | null
  totalPnl: number
  /** Chain-linked TWR over the period. */
  twr: number | null
  /** TWR minus the sum of contributions (≈ 0; non-zero only with data gaps or zero-unit periods). */
  residual: number | null
  byHolding: AttributionRow[]
  bySleeve: AttributionRow[]
  byAsset: AttributionRow[]
  provenance: Provenance
}

export interface ImportRowPreview {
  rowNumber: number
  raw: Record<string, string>
  parsed: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'importBatch' | 'currency'> | null
  errors: string[]
  warnings: string[]
  duplicateOfTxnId: number | null
  duplicateInFile: boolean
}

export interface ImportPreviewResponse {
  headers: string[]
  mapping: ImportMapping
  rows: ImportRowPreview[]
  validCount: number
  errorCount: number
  duplicateCount: number
}

export interface ImportCommitResponse {
  batch: ImportBatch
  inserted: number
  skipped: number
}

export interface TransactionsQuery {
  from?: string
  to?: string
  type?: TxnType
  instrumentId?: string
  accountId?: number
  batch?: string
  q?: string
}

export interface PhysicalItemView extends PhysicalItem {
  accountName: string | null
  spot: number | null
  value: number
  /** Storage cost accrued since acquisition at storageFeeRateAnnual. */
  storageAccrued: number
}

export interface VaultResponse {
  items: PhysicalItemView[]
  totals: {
    asset: AssetId
    /** Unit of `fineQty` and `ledgerQty` (the physical spec's unit). */
    unitLabel: PhysicalSpec['unit']
    items: number
    fineQty: number
    value: number
    premiumPaid: number
    storageAccrued: number
    /** Net quantity of the asset's physical instrument on the ledger. */
    ledgerQty: number
  }[]
  haircut: number
  warnings: string[]
  provenance: Provenance
}

export interface PortfolioSettingsResponse {
  settings: PortfolioSettings
  effectiveInceptionDate: string | null
}

/** Sleeve of an instrument kind. */
export function sleeveOfKind(kind: InstrumentKind): Sleeve {
  switch (kind) {
    case 'etf':
      return 'etf'
    case 'future':
      return 'futures'
    case 'physical':
      return 'physical'
    case 'cash':
      return 'cash'
    case 'equity':
      return 'equity'
  }
}

export const SLEEVE_LABEL: Record<Sleeve, string> = {
  etf: 'ETFs',
  futures: 'Futures',
  physical: 'Physical',
  cash: 'Cash',
  equity: 'Miners',
}

/** Troy ounces for a bullion weight. Bullion only (`physical.kind === 'bullion'`). */
export function toTroyOz(weight: number, unit: BullionWeightUnit): number {
  if (unit === 'oz') return weight
  if (unit === 'g') return weight / 31.1034768
  return (weight * 1000) / 31.1034768
}

function isBullionUnit(u: WeightUnit): u is BullionWeightUnit {
  return (BULLION_WEIGHT_UNITS as readonly string[]).includes(u)
}

/**
 * Fine quantity of a register item in the asset's physical unit.
 * Bullion: weight in troy oz × purity. Custody: the balance itself.
 * Takes the spec (not an AssetId) so assets outside the universe can be tested.
 */
export function physicalQuantity(phys: PhysicalSpec, item: { weight: number; weightUnit: WeightUnit; purity: number }): number {
  if (phys.kind === 'custody') return item.weight
  if (!isBullionUnit(item.weightUnit)) throw new Error(`${item.weightUnit} is not a bullion weight unit`)
  return toTroyOz(item.weight, item.weightUnit) * item.purity
}

/** Checks a register item against its asset's physical spec (form, unit, purity). */
export function physicalItemIssues(phys: PhysicalSpec, item: { form: PhysicalForm; weightUnit: WeightUnit; purity: number }): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = []
  if (phys.kind === 'custody') {
    if (item.form !== 'balance') out.push({ path: 'form', message: 'Custody holdings are recorded as a balance' })
    if (item.weightUnit !== phys.unit) out.push({ path: 'weightUnit', message: `Custody balances are recorded in ${phys.unit}` })
    if (item.purity !== 1) out.push({ path: 'purity', message: 'Custody balances have no fineness (use 1)' })
  } else {
    if (!BULLION_FORMS.includes(item.form)) out.push({ path: 'form', message: 'Bullion is a bar, coin or round' })
    if (!isBullionUnit(item.weightUnit)) out.push({ path: 'weightUnit', message: 'Bullion weight is in oz, g or kg' })
  }
  return out
}

/** Unit a holding's exposure is measured in: the asset's price unit (oz, lb, BTC). */
export function exposureUnitOf(asset: AssetId | null): PriceUnit | null {
  return asset ? UNIVERSE[asset].priceUnit : null
}

/** Label of an allocation bucket key: an asset's label, 'Cash', or 'Other'. */
export function assetBucketLabel(key: string): string {
  if (key === 'cash') return 'Cash'
  return (UNIVERSE as Partial<Record<string, AssetSpec>>)[key]?.label ?? 'Other'
}

/** Beta of the fund to its dominant asset's reference series (from a RiskResponse). */
export function dominantAssetBeta(risk: Pick<RiskResponse, 'exposureByAsset' | 'betas'>): { asset: AssetId; beta: BetaEstimate | undefined } {
  const asset = dominantAsset(risk.exposureByAsset)
  return { asset, beta: risk.betas.find((b) => b.symbol === UNIVERSE[asset].spot) }
}

/** The asset with the largest absolute notional exposure; the first asset when flat. */
export function dominantAsset(exposure: { asset: AssetId; notional: number }[]): AssetId {
  return [...exposure].sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional))[0]?.asset ?? ASSETS[0]
}

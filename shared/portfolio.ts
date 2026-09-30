// Portfolio domain contracts: ledger entities, request bodies (zod) and every
// /api/portfolio response shape. Shared by the server and the client.
import { z } from 'zod'
import type { Provenance } from './api.js'
import type { PortfolioSummaryLite, Sleeve } from './artifacts.js'
import type { InstrumentKind, Metal } from './universe.js'

export type { Sleeve } from './artifacts.js'

// ---------------------------------------------------------------------------
// Ledger entities
// ---------------------------------------------------------------------------

export const CUSTODY_TYPES = ['broker', 'vault', 'bank'] as const
export type CustodyType = (typeof CUSTODY_TYPES)[number]

/**
 * Transaction semantics (quantity is always the number of units the type
 * speaks about; `price` is per unit; `fees` are extra cash paid):
 * - buy / sell            ETF, equity or physical metal. Quantity in shares or
 *                         fine troy oz. Cash −(q·p + fees) / +(q·p − fees).
 * - futures_open          Quantity = signed contracts (+ long, − short); price
 *                         = entry $/oz. Only fees move cash (variation margin
 *                         is marked through NAV, not as a cash payment).
 * - futures_close         Quantity = contracts closed (> 0), FIFO against the
 *                         open position; price = exit $/oz. Realized P&L is
 *                         credited to cash.
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
  /** Stable id: ETF/equity ticker, futures root, 'XAU-PHYS', 'XAG-PHYS', 'USD'. */
  id: string
  name: string
  kind: InstrumentKind
  metal: Metal | null
  /** Yahoo symbol used to value the instrument. null for cash. */
  priceSymbol: string | null
  /** Troy oz per contract (futures only). */
  ozPerContract: number | null
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

export const PHYSICAL_FORMS = ['bar', 'coin', 'round'] as const
export type PhysicalForm = (typeof PHYSICAL_FORMS)[number]
export const WEIGHT_UNITS = ['oz', 'g', 'kg'] as const
export type WeightUnit = (typeof WEIGHT_UNITS)[number]

export interface PhysicalItem {
  id: number
  metal: Metal
  form: PhysicalForm
  description: string
  weight: number
  weightUnit: WeightUnit
  /** Fineness, e.g. 0.9999. */
  purity: number
  /** weight (in troy oz) × purity. */
  fineOz: number
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

export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  inceptionDate: null,
  baseNavPerUnit: 100,
  physicalHaircut: 0,
  riskFree: 0,
  blend: [
    { symbol: 'GLD', weight: 0.7 },
    { symbol: 'SLV', weight: 0.3 },
  ],
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

export const physicalItemInputSchema = z.object({
  metal: z.enum(['gold', 'silver']),
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
  /** When set, also records a `buy` of the metal's physical instrument at this all-in total cost. */
  recordPurchase: z
    .object({ totalCost: z.number().positive(), fees: z.number().nonnegative().default(0), accountId: z.number().int().positive() })
    .nullish(),
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
  metal: Metal | null
  /** Shares, fine oz or contracts (signed). */
  quantity: number
  /** Troy-oz exposure (physical oz; futures contracts × oz/contract). null for ETFs. */
  ounces: number | null
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
  netExposureOz: { metal: Metal; ounces: number }[]
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

export interface NavPointView {
  date: string
  nav: number
  units: number
  navPerUnit: number | null
  cash: number
  grossExposure: number
  netFlow: number
  bySleeve: Partial<Record<Sleeve, number>>
  byMetal: Partial<Record<Metal | 'cash' | 'other', number>>
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

export type BenchmarkId = 'GLD' | 'SLV' | 'GC=F' | 'blend'
export const BENCHMARKS: { id: BenchmarkId; label: string }[] = [
  { id: 'GLD', label: 'GLD' },
  { id: 'SLV', label: 'SLV' },
  { id: 'GC=F', label: 'Gold (GC=F)' },
  { id: 'blend', label: 'Blend' },
]

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
  exposureByMetal: { metal: Metal; ounces: number; notional: number }[]
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
  byMetal: AttributionRow[]
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
  totals: { metal: Metal; items: number; fineOz: number; value: number; premiumPaid: number; storageAccrued: number; ledgerOz: number }[]
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

/** Troy ounces for a weight in the given unit. */
export function toTroyOz(weight: number, unit: WeightUnit): number {
  if (unit === 'oz') return weight
  if (unit === 'g') return weight / 31.1034768
  return (weight * 1000) / 31.1034768
}

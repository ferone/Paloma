// CSV import/export for the ledger. Pure: parsing, column auto-mapping,
// normalization, row validation and duplicate detection. No DB access.
import Papa from 'papaparse'
import {
  CASH_AMOUNT_TYPES,
  IMPORT_FIELDS,
  TXN_TYPES,
  transactionInputSchema,
  type Account,
  type ImportField,
  type ImportMapping,
  type ImportRowPreview,
  type Instrument,
  type Transaction,
  type TxnType,
} from '../../shared/portfolio.js'
import { validateSemantics } from './validate.js'

export const EXPORT_HEADERS = ['trade_date', 'settle_date', 'type', 'instrument', 'account', 'counter_account', 'quantity', 'price', 'fees', 'notes'] as const

const SYNONYMS: Record<ImportField, string[]> = {
  tradeDate: ['trade_date', 'tradedate', 'date', 'trade date', 'transaction date', 'txn date', 'as of', 'executed'],
  settleDate: ['settle_date', 'settledate', 'settlement date', 'settle date', 'value date', 'settlement'],
  type: ['type', 'action', 'side', 'transaction type', 'txn type', 'activity', 'buy/sell'],
  instrument: ['instrument', 'symbol', 'ticker', 'security', 'instrument_id', 'asset', 'product', 'contract'],
  account: ['account', 'account name', 'custodian', 'broker', 'portfolio'],
  counterAccount: ['counter_account', 'to account', 'destination', 'to', 'counter account'],
  quantity: ['quantity', 'qty', 'shares', 'units', 'contracts', 'ounces', 'oz', 'size'],
  price: ['price', 'unit price', 'trade price', 'execution price', 'px', 'cost per share'],
  fees: ['fees', 'fee', 'commission', 'commissions', 'costs', 'brokerage'],
  amount: ['amount', 'net amount', 'value', 'total', 'gross amount', 'proceeds'],
  notes: ['notes', 'note', 'description', 'memo', 'comment', 'comments'],
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-./]+/g, ' ')

export function parseCsv(csv: string): { headers: string[]; records: Record<string, string>[]; parseErrors: string[] } {
  const res = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const headers = (res.meta.fields ?? []).filter((h) => h !== '')
  const parseErrors = res.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`)
  return { headers, records: res.data, parseErrors }
}

/** Map canonical fields to CSV headers by normalized synonym match. */
export function autoMap(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {}
  const used = new Set<string>()
  for (const field of IMPORT_FIELDS) {
    const syns = SYNONYMS[field].map(norm)
    const hit = headers.find((h) => !used.has(h) && syns.includes(norm(h)))
    if (hit) {
      mapping[field] = hit
      used.add(hit)
    }
  }
  return mapping
}

const TYPE_ALIASES: Record<string, TxnType> = {
  buy: 'buy',
  bought: 'buy',
  b: 'buy',
  purchase: 'buy',
  sell: 'sell',
  sold: 'sell',
  s: 'sell',
  sale: 'sell',
  subscription: 'subscription',
  subscribe: 'subscription',
  sub: 'subscription',
  contribution: 'subscription',
  redemption: 'redemption',
  redeem: 'redemption',
  red: 'redemption',
  deposit: 'deposit',
  'in kind deposit': 'deposit',
  withdrawal: 'withdrawal',
  withdraw: 'withdrawal',
  fee: 'fee',
  fees: 'fee',
  commission: 'fee',
  'management fee': 'fee',
  'storage fee': 'storage_fee',
  storage: 'storage_fee',
  'storage fee vault': 'storage_fee',
  dividend: 'dividend',
  div: 'dividend',
  distribution: 'dividend',
  interest: 'interest',
  int: 'interest',
  'futures open': 'futures_open',
  open: 'futures_open',
  'open long': 'futures_open',
  'futures close': 'futures_close',
  close: 'futures_close',
  transfer: 'transfer',
  'transfer out': 'transfer',
}

export function normalizeType(raw: string): TxnType | null {
  const k = norm(raw)
  if ((TXN_TYPES as readonly string[]).includes(k.replace(/ /g, '_'))) return k.replace(/ /g, '_') as TxnType
  return TYPE_ALIASES[k] ?? null
}

/** Parse "1,234.50", "$1,234.50", "(12.00)", "-3" → number; blank → null. */
export function parseNumber(raw: string | undefined): number | null | 'invalid' {
  if (raw == null) return null
  let s = raw.trim()
  if (s === '') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$,\s]/g, '').replace(/^USD/i, '').replace('−', '-')
  const n = Number(s)
  if (!Number.isFinite(n)) return 'invalid'
  return neg ? -n : n
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, M/D/YYYY (US) and DD.MM.YYYY. */
export function parseDate(raw: string | undefined): string | null | 'invalid' {
  if (raw == null || raw.trim() === '') return null
  const s = raw.trim()
  let y: number, m: number, d: number
  let mt = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/)
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])]
  else if ((mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [m, d, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])]
  else if ((mt = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])]
  else return 'invalid'
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalid'
  return dt.toISOString().slice(0, 10)
}

const INSTRUMENT_ALIASES: Record<string, string> = {
  cash: 'USD',
  usd: 'USD',
  '$': 'USD',
  xau: 'XAU-PHYS',
  'physical gold': 'XAU-PHYS',
  'gold bar': 'XAU-PHYS',
  'gold bullion': 'XAU-PHYS',
  xag: 'XAG-PHYS',
  'physical silver': 'XAG-PHYS',
  'silver bar': 'XAG-PHYS',
  'silver bullion': 'XAG-PHYS',
}

/** Resolve a symbol to an instrument id: exact id, alias, or futures contract (e.g. GCZ26 → GC). */
export function resolveInstrument(raw: string, instruments: Map<string, Instrument>): string | null {
  const s = raw.trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (instruments.has(up)) return up
  const alias = INSTRUMENT_ALIASES[norm(s)]
  if (alias && instruments.has(alias)) return alias
  const roots = [...instruments.values()].filter((i) => i.kind === 'future').sort((a, b) => b.id.length - a.id.length)
  const base = up.replace(/=F$/, '').replace(/\.CMX$/, '')
  for (const r of roots) {
    if (base === r.id || new RegExp(`^${r.id}[FGHJKMNQUVXZ]\\d{1,2}$`).test(base)) return r.id
    if (r.priceSymbol?.toUpperCase() === up) return r.id
  }
  return null
}

export interface PreviewContext {
  instruments: Map<string, Instrument>
  accounts: Account[]
  defaultAccountId?: number | null
  existing: Transaction[]
}

export function dedupeKey(t: { tradeDate: string; accountId: number; instrumentId: string; type: string; quantity: number; price: number }): string {
  return [t.tradeDate, t.accountId, t.instrumentId, t.type, t.quantity.toFixed(6), t.price.toFixed(6)].join('|')
}

export function buildPreview(records: Record<string, string>[], mapping: ImportMapping, ctx: PreviewContext): ImportRowPreview[] {
  const existing = new Map(ctx.existing.map((t) => [dedupeKey(t), t.id]))
  const seen = new Set<string>()
  const byName = new Map(ctx.accounts.map((a) => [a.name.trim().toLowerCase(), a.id]))
  const get = (rec: Record<string, string>, f: ImportField) => (mapping[f] ? (rec[mapping[f]!] ?? '').trim() : '')

  const resolveAccount = (raw: string, errors: string[], label: string): number | null => {
    if (!raw) return null
    const id = byName.get(raw.toLowerCase()) ?? (/^\d+$/.test(raw) && ctx.accounts.some((a) => a.id === Number(raw)) ? Number(raw) : undefined)
    if (id == null) errors.push(`Unknown ${label} "${raw}"`)
    return id ?? null
  }

  return records.map((rec, i) => {
    const errors: string[] = []
    const warnings: string[] = []
    const raw = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, String(v ?? '')]))

    const tradeDate = parseDate(get(rec, 'tradeDate'))
    if (tradeDate === 'invalid') errors.push(`Unrecognized date "${get(rec, 'tradeDate')}"`)
    else if (tradeDate == null) errors.push('Missing trade date')
    const settleDate = parseDate(get(rec, 'settleDate'))
    if (settleDate === 'invalid') errors.push(`Unrecognized settle date "${get(rec, 'settleDate')}"`)

    const typeRaw = get(rec, 'type')
    let type = typeRaw ? normalizeType(typeRaw) : null
    if (!typeRaw) errors.push('Missing type')
    else if (!type) errors.push(`Unknown type "${typeRaw}"`)

    const instRaw = get(rec, 'instrument')
    let instrumentId = instRaw ? resolveInstrument(instRaw, ctx.instruments) : null
    if (!instRaw && type && CASH_AMOUNT_TYPES.includes(type) && type !== 'dividend' && type !== 'storage_fee') instrumentId = 'USD'
    if (instRaw && !instrumentId) errors.push(`Unknown instrument "${instRaw}"`)
    else if (!instrumentId) errors.push('Missing instrument')

    const accRaw = get(rec, 'account')
    const accountId = resolveAccount(accRaw, errors, 'account') ?? (accRaw ? null : (ctx.defaultAccountId ?? null))
    if (!accRaw && accountId == null) errors.push('Missing account (map a column or choose a default account)')
    const counterAccountId = resolveAccount(get(rec, 'counterAccount'), errors, 'destination account')

    const nums: Partial<Record<'quantity' | 'price' | 'fees' | 'amount', number | null>> = {}
    for (const f of ['quantity', 'price', 'fees', 'amount'] as const) {
      const v = parseNumber(get(rec, f))
      if (v === 'invalid') errors.push(`${f} "${get(rec, f)}" is not a number`)
      else nums[f] = v
    }
    let quantity = nums.quantity ?? null
    let price = nums.price ?? null
    let fees = nums.fees ?? 0
    const amount = nums.amount ?? null

    // Sign conventions: brokers often export sells/redemptions as negatives.
    if (type === 'buy' && quantity != null && quantity < 0) type = 'sell'
    if (type && type !== 'futures_open' && quantity != null) quantity = Math.abs(quantity)
    if (fees < 0) fees = Math.abs(fees)

    if (type && CASH_AMOUNT_TYPES.includes(type)) {
      if (quantity == null && amount != null) quantity = Math.abs(amount)
      else if (quantity != null && price != null && price !== 1) {
        quantity = quantity * price
      }
      price = 1
    } else if (price == null && amount != null && quantity) {
      price = Math.abs(amount) / Math.abs(quantity)
      warnings.push('Price derived from amount ÷ quantity')
    }
    if (type === 'transfer' && price == null) price = 1
    if (quantity == null) errors.push('Missing quantity')
    if (price == null) errors.push('Missing price')

    let parsed: ImportRowPreview['parsed'] = null
    if (errors.length === 0) {
      const candidate = {
        tradeDate: tradeDate as string,
        settleDate: (settleDate as string | null) ?? null,
        accountId: accountId!,
        counterAccountId,
        instrumentId: instrumentId!,
        type: type!,
        quantity: quantity!,
        price: price!,
        fees,
        notes: get(rec, 'notes') || null,
      }
      const z = transactionInputSchema.safeParse(candidate)
      if (!z.success) for (const iss of z.error.issues) errors.push(`${iss.path.join('.') || 'row'}: ${iss.message}`)
      errors.push(...validateSemantics(candidate, ctx.instruments.get(candidate.instrumentId)))
      if (errors.length === 0) parsed = { ...candidate, counterAccountId: candidate.counterAccountId ?? null }
    }

    let duplicateOfTxnId: number | null = null
    let duplicateInFile = false
    if (parsed) {
      const key = dedupeKey(parsed)
      duplicateOfTxnId = existing.get(key) ?? null
      duplicateInFile = seen.has(key)
      seen.add(key)
      if (duplicateInFile) warnings.push('Same as an earlier row in this file')
      if (duplicateOfTxnId) warnings.push(`Matches existing transaction #${duplicateOfTxnId}`)
    }
    return { rowNumber: i + 2, raw, parsed, errors, warnings, duplicateOfTxnId, duplicateInFile }
  })
}

export function exportCsv(txns: Transaction[], accounts: Account[]): string {
  const name = new Map(accounts.map((a) => [a.id, a.name]))
  return Papa.unparse({
    fields: [...EXPORT_HEADERS],
    data: txns.map((t) => [
      t.tradeDate,
      t.settleDate ?? '',
      t.type,
      t.instrumentId,
      name.get(t.accountId) ?? String(t.accountId),
      t.counterAccountId ? (name.get(t.counterAccountId) ?? String(t.counterAccountId)) : '',
      t.quantity,
      t.price,
      t.fees,
      t.notes ?? '',
    ]),
  })
}

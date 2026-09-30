// Portfolio repositories (pf_* tables). Every ledger mutation writes an
// audit_log row with before/after JSON inside the same transaction.
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/client.js'
import { getSetting, setSetting } from '../db/repo.js'
import { UNIVERSE, type AssetId, type AssetSpec } from '../../shared/universe.js'
import {
  DEFAULT_PORTFOLIO_SETTINGS,
  physicalQuantity,
  type Account,
  type AccountInput,
  type AuditEntry,
  type ImportBatch,
  type Instrument,
  type PhysicalItem,
  type PortfolioSettings,
  type Transaction,
  type TransactionsQuery,
  type UnitEntry,
} from '../../shared/portfolio.js'
import type { z } from 'zod'
import type { physicalItemInputSchema, transactionInputSchema } from '../../shared/portfolio.js'

export type TxnData = z.output<typeof transactionInputSchema>
export type PhysicalData = Omit<z.output<typeof physicalItemInputSchema>, 'recordPurchase'>

const SETTINGS_KEY = 'portfolio.settings'

// --------------------------------------------------------------------------
// Instruments (seeded from the universe)
// --------------------------------------------------------------------------

/**
 * Every instrument the fund can trade, derived from the universe: the asset's
 * ETFs, its miners proxy (optional), its futures (with `pointValue` and
 * `contractSize`) and, only when `spec.physical` is set, its physical holding.
 * The universe is a parameter so tests can seed assets outside it.
 */
export function universeInstruments(universe: Partial<Record<AssetId, AssetSpec>> = UNIVERSE): Instrument[] {
  const out: Instrument[] = [{ id: 'USD', name: 'US dollar cash', kind: 'cash', asset: null, priceSymbol: null, pointValue: null, contractSize: null }]
  for (const spec of Object.values(universe) as AssetSpec[]) {
    const a = spec.id
    const base = { asset: a, pointValue: null, contractSize: null }
    for (const etf of spec.etfs) out.push({ ...base, id: etf, name: `${etf} (${spec.label} ETF)`, kind: 'etf', priceSymbol: etf })
    if (spec.miners) out.push({ ...base, id: spec.miners, name: `${spec.miners} (${spec.label} miners)`, kind: 'equity', priceSymbol: spec.miners })
    for (const f of spec.futures) out.push({ id: f.root, name: f.name, kind: 'future', asset: a, priceSymbol: f.yahoo, pointValue: f.pointValue, contractSize: f.contractSize })
    if (spec.physical) {
      out.push({ ...base, id: spec.physical.instrumentId, name: physicalInstrumentName(spec), kind: 'physical', priceSymbol: spec.spot })
    }
  }
  return out
}

function physicalInstrumentName(spec: AssetSpec): string {
  return spec.physical?.kind === 'custody' ? `${spec.label} (custody)` : `Physical ${spec.label.toLowerCase()} (allocated)`
}

/** Ledger instrument of an asset's direct holding (vault bullion or custody balance). */
export function physicalInstrumentId(asset: AssetId): string {
  const phys = UNIVERSE[asset].physical
  if (!phys) throw new Error(`${UNIVERSE[asset].label} cannot be held directly`)
  return phys.instrumentId
}

let seeded = false
let seededDb: unknown = null

/** Idempotently upsert the universe instruments (runs once per connection). */
export function ensureInstruments(): void {
  const db = getDb()
  if (seeded && seededDb === db) return
  const stmt = db.prepare(
    `INSERT INTO pf_instruments (id, name, kind, metal, price_symbol, point_value, contract_size)
     VALUES (@id, @name, @kind, @asset, @priceSymbol, @pointValue, @contractSize)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, metal = excluded.metal,
       price_symbol = excluded.price_symbol, point_value = excluded.point_value, contract_size = excluded.contract_size`,
  )
  db.transaction(() => universeInstruments().forEach((i) => stmt.run(i)))()
  seeded = true
  seededDb = db
}

export function listInstruments(): Instrument[] {
  ensureInstruments()
  return getDb()
    .prepare(
      `SELECT id, name, kind, metal AS asset, price_symbol AS priceSymbol, point_value AS pointValue, contract_size AS contractSize
       FROM pf_instruments ORDER BY kind, id`,
    )
    .all() as Instrument[]
}

export function instrumentMap(): Map<string, Instrument> {
  return new Map(listInstruments().map((i) => [i.id, i]))
}

// --------------------------------------------------------------------------
// Audit
// --------------------------------------------------------------------------

export function audit(entity: string, entityId: string | number, action: AuditEntry['action'], before: unknown, after: unknown): void {
  getDb()
    .prepare(`INSERT INTO pf_audit_log (entity, entity_id, action, before, after) VALUES (?, ?, ?, ?, ?)`)
    .run(entity, String(entityId), action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after))
}

export function listAudit(opts: { entity?: string; entityId?: string; limit?: number } = {}): AuditEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT id, entity, entity_id AS entityId, action, before, after, at FROM pf_audit_log
       WHERE (? IS NULL OR entity = ?) AND (? IS NULL OR entity_id = ?) ORDER BY id DESC LIMIT ?`,
    )
    .all(opts.entity ?? null, opts.entity ?? null, opts.entityId ?? null, opts.entityId ?? null, opts.limit ?? 200) as (Omit<AuditEntry, 'before' | 'after'> & {
    before: string | null
    after: string | null
  })[]
  return rows.map((r) => ({ ...r, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null }))
}

// --------------------------------------------------------------------------
// Accounts
// --------------------------------------------------------------------------

const ACCOUNT_COLS = `id, name, custody, institution, notes, created_at AS createdAt`

export function listAccounts(): Account[] {
  return getDb().prepare(`SELECT ${ACCOUNT_COLS} FROM pf_accounts ORDER BY name`).all() as Account[]
}

export function getAccount(id: number): Account | undefined {
  return getDb().prepare(`SELECT ${ACCOUNT_COLS} FROM pf_accounts WHERE id = ?`).get(id) as Account | undefined
}

export function createAccount(input: AccountInput): Account {
  const db = getDb()
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(`INSERT INTO pf_accounts (name, custody, institution, notes) VALUES (?, ?, ?, ?)`)
        .run(input.name, input.custody, input.institution ?? null, input.notes ?? null).lastInsertRowid,
    )
    const acc = getAccount(id)!
    audit('account', id, 'create', null, acc)
    return acc
  })()
}

export function updateAccount(id: number, input: AccountInput): Account | undefined {
  const db = getDb()
  return db.transaction(() => {
    const before = getAccount(id)
    if (!before) return undefined
    db.prepare(`UPDATE pf_accounts SET name = ?, custody = ?, institution = ?, notes = ? WHERE id = ?`).run(
      input.name,
      input.custody,
      input.institution ?? null,
      input.notes ?? null,
      id,
    )
    const after = getAccount(id)!
    audit('account', id, 'update', before, after)
    return after
  })()
}

export class InUseError extends Error {}

export function deleteAccount(id: number): boolean {
  const db = getDb()
  return db.transaction(() => {
    const before = getAccount(id)
    if (!before) return false
    const used = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM pf_transactions WHERE account_id = ? OR counter_account_id = ?)
              + (SELECT COUNT(*) FROM pf_physical_items WHERE account_id = ?) AS n`,
      )
      .get(id, id, id) as { n: number }
    if (used.n > 0) throw new InUseError(`Account "${before.name}" is referenced by ${used.n} ledger rows or vault items.`)
    db.prepare(`DELETE FROM pf_accounts WHERE id = ?`).run(id)
    audit('account', id, 'delete', before, null)
    return true
  })()
}

// --------------------------------------------------------------------------
// Transactions
// --------------------------------------------------------------------------

const TXN_COLS = `id, trade_date AS tradeDate, settle_date AS settleDate, account_id AS accountId,
  counter_account_id AS counterAccountId, instrument_id AS instrumentId, type, quantity, price, fees,
  currency, notes, import_batch AS importBatch, created_at AS createdAt, updated_at AS updatedAt`

export function listTransactions(q: TransactionsQuery = {}): Transaction[] {
  const where: string[] = []
  const args: unknown[] = []
  const add = (clause: string, ...values: unknown[]) => {
    where.push(clause)
    args.push(...values)
  }
  if (q.from) add('trade_date >= ?', q.from)
  if (q.to) add('trade_date <= ?', q.to)
  if (q.type) add('type = ?', q.type)
  if (q.instrumentId) add('instrument_id = ?', q.instrumentId)
  if (q.accountId) add('(account_id = ? OR counter_account_id = ?)', q.accountId, q.accountId)
  if (q.batch) add('import_batch = ?', q.batch)
  if (q.q) add('(notes LIKE ? OR instrument_id LIKE ?)', `%${q.q}%`, `%${q.q}%`)
  return getDb()
    .prepare(`SELECT ${TXN_COLS} FROM pf_transactions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY trade_date, id`)
    .all(...args) as Transaction[]
}

export function getTransaction(id: number): Transaction | undefined {
  return getDb().prepare(`SELECT ${TXN_COLS} FROM pf_transactions WHERE id = ?`).get(id) as Transaction | undefined
}

export function countTransactions(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM pf_transactions`).get() as { n: number }).n
}

function txnParams(t: TxnData, importBatch: string | null) {
  return {
    tradeDate: t.tradeDate,
    settleDate: t.settleDate ?? null,
    accountId: t.accountId,
    counterAccountId: t.counterAccountId ?? null,
    instrumentId: t.instrumentId,
    type: t.type,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    notes: t.notes ?? null,
    importBatch,
  }
}

function insertTxn(t: TxnData, importBatch: string | null): number {
  ensureInstruments()
  return Number(
    getDb()
      .prepare(
        `INSERT INTO pf_transactions (trade_date, settle_date, account_id, counter_account_id, instrument_id, type, quantity, price, fees, notes, import_batch)
         VALUES (@tradeDate, @settleDate, @accountId, @counterAccountId, @instrumentId, @type, @quantity, @price, @fees, @notes, @importBatch)`,
      )
      .run(txnParams(t, importBatch)).lastInsertRowid,
  )
}

export function createTransaction(t: TxnData): Transaction {
  const db = getDb()
  return db.transaction(() => {
    const id = insertTxn(t, null)
    const row = getTransaction(id)!
    audit('transaction', id, 'create', null, row)
    return row
  })()
}

export function updateTransaction(id: number, t: TxnData): Transaction | undefined {
  const db = getDb()
  return db.transaction(() => {
    const before = getTransaction(id)
    if (!before) return undefined
    db.prepare(
      `UPDATE pf_transactions SET trade_date = @tradeDate, settle_date = @settleDate, account_id = @accountId,
         counter_account_id = @counterAccountId, instrument_id = @instrumentId, type = @type, quantity = @quantity,
         price = @price, fees = @fees, notes = @notes, updated_at = datetime('now') WHERE id = @id`,
    ).run({ ...txnParams(t, before.importBatch), id })
    const after = getTransaction(id)!
    audit('transaction', id, 'update', before, after)
    return after
  })()
}

export function deleteTransaction(id: number): boolean {
  const db = getDb()
  return db.transaction(() => {
    const before = getTransaction(id)
    if (!before) return false
    db.prepare(`DELETE FROM pf_transactions WHERE id = ?`).run(id)
    audit('transaction', id, 'delete', before, null)
    return true
  })()
}

// --------------------------------------------------------------------------
// Import batches
// --------------------------------------------------------------------------

const BATCH_COLS = `id, filename, created_at AS createdAt, row_count AS rowCount, status, rolled_back_at AS rolledBackAt`

export function listBatches(): ImportBatch[] {
  return getDb().prepare(`SELECT ${BATCH_COLS} FROM pf_import_batches ORDER BY created_at DESC, rowid DESC`).all() as ImportBatch[]
}

export function getBatch(id: string): ImportBatch | undefined {
  return getDb().prepare(`SELECT ${BATCH_COLS} FROM pf_import_batches WHERE id = ?`).get(id) as ImportBatch | undefined
}

/** Insert rows as one import batch, atomically. */
export function commitBatch(rows: TxnData[], filename: string | null): ImportBatch {
  const db = getDb()
  return db.transaction(() => {
    const id = `imp_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${randomUUID().slice(0, 8)}`
    db.prepare(`INSERT INTO pf_import_batches (id, filename, row_count) VALUES (?, ?, ?)`).run(id, filename, rows.length)
    for (const r of rows) {
      const txnId = insertTxn(r, id)
      audit('transaction', txnId, 'create', null, { ...r, importBatch: id })
    }
    const batch = getBatch(id)!
    audit('import_batch', id, 'create', null, batch)
    return batch
  })()
}

/** Delete every transaction of a batch and mark it rolled back. */
export function rollbackBatch(id: string): { batch: ImportBatch; removed: number } | undefined {
  const db = getDb()
  return db.transaction(() => {
    const before = getBatch(id)
    if (!before) return undefined
    const txns = listTransactions({ batch: id })
    for (const t of txns) {
      db.prepare(`DELETE FROM pf_transactions WHERE id = ?`).run(t.id)
      audit('transaction', t.id, 'delete', t, null)
    }
    db.prepare(`UPDATE pf_import_batches SET status = 'rolled_back', rolled_back_at = datetime('now') WHERE id = ?`).run(id)
    const batch = getBatch(id)!
    audit('import_batch', id, 'update', before, batch)
    return { batch, removed: txns.length }
  })()
}

// --------------------------------------------------------------------------
// Physical items
// --------------------------------------------------------------------------

const PHYS_COLS = `id, metal AS asset, form, description, weight, weight_unit AS weightUnit, purity, fine_oz AS fineQty, serial,
  refiner, account_id AS accountId, acquisition_txn_id AS acquisitionTxnId, acquired_date AS acquiredDate,
  premium_paid AS premiumPaid, storage_fee_rate_annual AS storageFeeRateAnnual, status, notes`

export function listPhysical(): PhysicalItem[] {
  return getDb().prepare(`SELECT ${PHYS_COLS} FROM pf_physical_items ORDER BY metal, acquired_date, id`).all() as PhysicalItem[]
}

export function getPhysical(id: number): PhysicalItem | undefined {
  return getDb().prepare(`SELECT ${PHYS_COLS} FROM pf_physical_items WHERE id = ?`).get(id) as PhysicalItem | undefined
}

/** Asset specs the register resolves against; a parameter so tests can register assets outside the universe. */
export type SpecLookup = (asset: AssetId) => AssetSpec | undefined
const universeSpec: SpecLookup = (a) => UNIVERSE[a]

function physicalSpecOf(asset: AssetId, specOf: SpecLookup) {
  const spec = specOf(asset)
  if (!spec?.physical) throw new Error(`${spec?.label ?? asset} cannot be held directly`)
  return spec.physical
}

function physParams(p: PhysicalData, specOf: SpecLookup) {
  const phys = physicalSpecOf(p.asset, specOf)
  return {
    asset: p.asset,
    form: p.form,
    description: p.description,
    weight: p.weight,
    weightUnit: p.weightUnit,
    purity: p.purity,
    fineQty: physicalQuantity(phys, p),
    serial: p.serial ?? null,
    refiner: p.refiner ?? null,
    accountId: p.accountId ?? null,
    acquisitionTxnId: p.acquisitionTxnId ?? null,
    acquiredDate: p.acquiredDate ?? null,
    premiumPaid: p.premiumPaid ?? null,
    storageFeeRateAnnual: p.storageFeeRateAnnual ?? null,
    status: p.status,
    notes: p.notes ?? null,
  }
}

/**
 * Create a register item (vault bullion or a custody balance). With `purchase`,
 * also records the matching `buy` of the asset's physical instrument (fine
 * quantity at totalCost / fine quantity) and links it.
 */
export function createPhysical(
  p: PhysicalData,
  purchase?: { totalCost: number; fees: number; accountId: number } | null,
  specOf: SpecLookup = universeSpec,
): PhysicalItem {
  const db = getDb()
  return db.transaction(() => {
    const params = physParams(p, specOf)
    if (purchase) {
      const txn = createTransaction({
        tradeDate: p.acquiredDate ?? new Date().toISOString().slice(0, 10),
        settleDate: null,
        accountId: purchase.accountId,
        counterAccountId: null,
        instrumentId: physicalSpecOf(p.asset, specOf).instrumentId,
        type: 'buy',
        quantity: params.fineQty,
        price: purchase.totalCost / params.fineQty,
        fees: purchase.fees,
        notes: `${p.description}${p.serial ? ` · serial ${p.serial}` : ''}${p.notes ? ` · ${p.notes}` : ''}`,
      })
      params.acquisitionTxnId = txn.id
      params.accountId ??= purchase.accountId
    }
    const id = Number(
      db
        .prepare(
          `INSERT INTO pf_physical_items (metal, form, description, weight, weight_unit, purity, fine_oz, serial, refiner, account_id,
             acquisition_txn_id, acquired_date, premium_paid, storage_fee_rate_annual, status, notes)
           VALUES (@asset, @form, @description, @weight, @weightUnit, @purity, @fineQty, @serial, @refiner, @accountId,
             @acquisitionTxnId, @acquiredDate, @premiumPaid, @storageFeeRateAnnual, @status, @notes)`,
        )
        .run(params).lastInsertRowid,
    )
    const item = getPhysical(id)!
    audit('physical_item', id, 'create', null, item)
    return item
  })()
}

export function updatePhysical(id: number, p: PhysicalData, specOf: SpecLookup = universeSpec): PhysicalItem | undefined {
  const db = getDb()
  return db.transaction(() => {
    const before = getPhysical(id)
    if (!before) return undefined
    db.prepare(
      `UPDATE pf_physical_items SET metal = @asset, form = @form, description = @description, weight = @weight,
         weight_unit = @weightUnit, purity = @purity, fine_oz = @fineQty, serial = @serial, refiner = @refiner,
         account_id = @accountId, acquisition_txn_id = @acquisitionTxnId, acquired_date = @acquiredDate,
         premium_paid = @premiumPaid, storage_fee_rate_annual = @storageFeeRateAnnual, status = @status, notes = @notes,
         updated_at = datetime('now') WHERE id = @id`,
    ).run({ ...physParams(p, specOf), id })
    const after = getPhysical(id)!
    audit('physical_item', id, 'update', before, after)
    return after
  })()
}

export function deletePhysical(id: number): boolean {
  const db = getDb()
  return db.transaction(() => {
    const before = getPhysical(id)
    if (!before) return false
    db.prepare(`DELETE FROM pf_physical_items WHERE id = ?`).run(id)
    audit('physical_item', id, 'delete', before, null)
    return true
  })()
}

// --------------------------------------------------------------------------
// Derived: units ledger + NAV snapshots (rewritten on every recompute)
// --------------------------------------------------------------------------

export interface SnapshotRow {
  date: string
  nav: number
  units: number
  navPerUnit: number | null
  cash: number
  grossExposure: number
  netFlow: number
  bySleeve: Record<string, number>
  byAsset: Record<string, number>
}

export function replaceDerived(units: UnitEntry[], snapshots: SnapshotRow[]): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare(`DELETE FROM pf_fund_units`).run()
    db.prepare(`DELETE FROM pf_nav_snapshots`).run()
    const u = db.prepare(
      `INSERT INTO pf_fund_units (date, txn_id, type, amount, units, nav_per_unit, units_outstanding)
       VALUES (@date, @txnId, @type, @amount, @units, @navPerUnit, @unitsOutstanding)`,
    )
    for (const e of units) u.run(e)
    const s = db.prepare(
      `INSERT INTO pf_nav_snapshots (date, nav, units, nav_per_unit, cash, gross_exposure, net_flow, by_sleeve, by_metal)
       VALUES (@date, @nav, @units, @navPerUnit, @cash, @grossExposure, @netFlow, @bySleeve, @byAsset)`,
    )
    for (const r of snapshots) s.run({ ...r, bySleeve: JSON.stringify(r.bySleeve), byAsset: JSON.stringify(r.byAsset) })
  })()
}

export function listUnits(): UnitEntry[] {
  return getDb()
    .prepare(
      `SELECT date, txn_id AS txnId, type, amount, units, nav_per_unit AS navPerUnit, units_outstanding AS unitsOutstanding
       FROM pf_fund_units ORDER BY date, id`,
    )
    .all() as UnitEntry[]
}

export function listSnapshots(from?: string): SnapshotRow[] {
  const rows = getDb()
    .prepare(
      `SELECT date, nav, units, nav_per_unit AS navPerUnit, cash, gross_exposure AS grossExposure, net_flow AS netFlow,
         by_sleeve AS bySleeve, by_metal AS byAsset FROM pf_nav_snapshots WHERE (? IS NULL OR date >= ?) ORDER BY date`,
    )
    .all(from ?? null, from ?? null) as (Omit<SnapshotRow, 'bySleeve' | 'byAsset'> & { bySleeve: string; byAsset: string })[]
  return rows.map((r) => ({ ...r, bySleeve: JSON.parse(r.bySleeve), byAsset: JSON.parse(r.byAsset) }))
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

export function getPortfolioSettings(): PortfolioSettings {
  return { ...DEFAULT_PORTFOLIO_SETTINGS, ...getSetting<Partial<PortfolioSettings>>(SETTINGS_KEY, {}) }
}

export function setPortfolioSettings(patch: Partial<PortfolioSettings>): PortfolioSettings {
  const before = getPortfolioSettings()
  const next = { ...before, ...patch }
  setSetting(SETTINGS_KEY, next)
  audit('settings', SETTINGS_KEY, 'update', before, next)
  return next
}

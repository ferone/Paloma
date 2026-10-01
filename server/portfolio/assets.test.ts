// Multi-asset portfolio: migration 071, universe-seeded instruments, custody
// holdings (a fake BTC spec, since no universe asset uses custody yet) and the
// business-day valuation calendar.
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client.js'
import { runMigrations } from '../db/migrate.js'
import type { Instrument, Transaction } from '../../shared/portfolio.js'
import { UNIVERSE, type AssetId, type AssetSpec } from '../../shared/universe.js'
import { MemoryPriceBook, runLedger, valuePosition } from './engine/ledger.js'
import { instrumentAliases, resolveInstrument } from './csv.js'
import * as repo from './repo.js'
import { valuationDates } from './service.js'
import { vaultTotals } from './views.js'

const BTC = 'btc' as AssetId
const BTC_SPEC: AssetSpec = {
  id: BTC,
  label: 'Bitcoin',
  short: 'BTC',
  assetClass: 'crypto',
  spot: 'BTC-USD',
  priceUnit: 'BTC',
  unitLabel: '$/BTC',
  displayDecimals: 0,
  session: '24x7',
  futures: [
    { root: 'BTC', name: 'CME Bitcoin', exchange: 'CME', yahoo: 'BTC=F', contractSize: 5, pointValue: 5, tickSize: 5, activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], cashSettled: true },
  ],
  etfs: ['IBIT'],
  benchmarkEtf: 'IBIT',
  physical: { unit: 'BTC', kind: 'custody', instrumentId: 'BTC-CUSTODY' },
  cot: null,
  colorVar: '--series-4',
}
const specOf = (a: AssetId) => (a === BTC ? BTC_SPEC : UNIVERSE[a])

describe('071_portfolio_assets migration', () => {
  it('renames oz_per_contract to point_value, adds contract_size and preserves every row', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    // Apply everything up to 070, write rows in the old shape, then apply 071.
    db.exec(`CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.prepare(`INSERT INTO _migrations (name) VALUES ('071_portfolio_assets.sql')`).run()
    runMigrations(db)
    db.exec(`
      INSERT INTO pf_accounts (id, name, custody) VALUES (1, 'Vault', 'vault');
      INSERT INTO pf_instruments (id, name, kind, metal, price_symbol, oz_per_contract) VALUES
        ('GC', 'COMEX Gold', 'future', 'gold', 'GC=F', 100),
        ('SI', 'COMEX Silver', 'future', 'silver', 'SI=F', 5000),
        ('XAU-PHYS', 'Physical gold (allocated)', 'physical', 'gold', 'GC=F', NULL);
      INSERT INTO pf_transactions (id, trade_date, account_id, instrument_id, type, quantity, price) VALUES
        (7, '2024-01-02', 1, 'XAU-PHYS', 'buy', 32.1475, 2050);
      INSERT INTO pf_physical_items (id, metal, form, description, weight, weight_unit, purity, fine_oz, account_id, acquisition_txn_id)
        VALUES (3, 'gold', 'bar', '1 kg bar', 1, 'kg', 0.9999, 32.1475, 1, 7);
    `)
    db.prepare(`DELETE FROM _migrations WHERE name = '071_portfolio_assets.sql'`).run()
    expect(runMigrations(db)).toEqual(['071_portfolio_assets.sql'])

    const cols = (db.prepare(`SELECT name FROM pragma_table_info('pf_instruments')`).all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('point_value')
    expect(cols).toContain('contract_size')
    expect(cols).not.toContain('oz_per_contract')
    expect(db.prepare(`SELECT id, point_value AS pv, contract_size AS cs FROM pf_instruments ORDER BY id`).all()).toEqual([
      { id: 'GC', pv: 100, cs: 100 },
      { id: 'SI', pv: 5000, cs: 5000 },
      { id: 'XAU-PHYS', pv: null, cs: null },
    ])
    expect(db.prepare(`SELECT id, metal, fine_oz, acquisition_txn_id AS txn FROM pf_physical_items`).all()).toEqual([
      { id: 3, metal: 'gold', fine_oz: 32.1475, txn: 7 },
    ])
    expect(db.prepare(`SELECT COUNT(*) AS n FROM pf_transactions`).get()).toEqual({ n: 1 })

    // Custody balances are a register form now; unknown forms are still rejected.
    db.prepare(`INSERT INTO pf_physical_items (metal, form, description, weight, weight_unit, purity, fine_oz) VALUES ('btc', 'balance', 'Cold wallet', 1.5, 'BTC', 1, 1.5)`).run()
    expect(() => db.prepare(`INSERT INTO pf_physical_items (metal, form, description, weight, weight_unit, purity, fine_oz) VALUES ('gold', 'nugget', 'x', 1, 'oz', 1, 1)`).run()).toThrow(/CHECK/)
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})

describe('instruments from the universe', () => {
  it('seeds futures with pointValue and contractSize identical to the old oz/contract for gold and silver', () => {
    const byId = new Map(repo.universeInstruments().map((i) => [i.id, i]))
    expect(byId.get('GC')).toMatchObject({ kind: 'future', asset: 'gold', pointValue: 100, contractSize: 100, priceSymbol: 'GC=F' })
    expect(byId.get('SI')).toMatchObject({ kind: 'future', asset: 'silver', pointValue: 5000, contractSize: 5000 })
    expect(byId.get('MGC')?.pointValue).toBe(10)
    expect(byId.get('SIL')?.pointValue).toBe(1000)
    expect(byId.get('XAU-PHYS')).toMatchObject({ kind: 'physical', asset: 'gold', name: 'Physical gold (allocated)' })
    expect(byId.get('XAG-PHYS')).toMatchObject({ kind: 'physical', asset: 'silver' })
    expect(byId.get('GDX')).toMatchObject({ kind: 'equity', asset: 'gold', name: 'GDX (Gold miners)' })
  })

  it('adds a physical instrument only when the spec has one', () => {
    const ids = repo.universeInstruments({ btc: BTC_SPEC } as Partial<Record<AssetId, AssetSpec>>).map((i) => i.id)
    expect(ids).toEqual(['USD', 'IBIT', 'BTC', 'BTC-CUSTODY'])
    const noPhysical = repo.universeInstruments({ btc: { ...BTC_SPEC, physical: null } } as Partial<Record<AssetId, AssetSpec>>).map((i) => i.id)
    expect(noPhysical).toEqual(['USD', 'IBIT', 'BTC'])
  })

  it('derives CSV aliases for bullion and custody holdings', () => {
    const aliases = instrumentAliases([UNIVERSE.gold, BTC_SPEC])
    expect(aliases['physical gold']).toBe('XAU-PHYS')
    expect(aliases.xau).toBe('XAU-PHYS')
    expect(aliases['bitcoin wallet']).toBe('BTC-CUSTODY')
    const instruments = new Map(repo.universeInstruments().map((i) => [i.id, i]))
    expect(resolveInstrument('Silver bullion', instruments)).toBe('XAG-PHYS')
    expect(resolveInstrument('GCZ26.CMX', instruments)).toBe('GC')
  })
})

describe('custody holdings', () => {
  const inst: Instrument = { id: 'BTC-CUSTODY', name: 'Bitcoin (custody)', kind: 'physical', asset: BTC, priceSymbol: 'BTC-USD', pointValue: null, contractSize: null }
  const txn = (id: number, tradeDate: string, quantity: number, price: number): Transaction => ({
    id, tradeDate, settleDate: null, accountId: 1, counterAccountId: null, instrumentId: inst.id, type: 'buy', quantity, price, fees: 0,
    currency: 'USD', notes: null, importBatch: null, createdAt: '', updatedAt: '',
  })

  it('values a custody balance as quantity × spot, with exposure in BTC', () => {
    const lots = [{ qty: 1.5, unitCost: 60_000, openDate: '2024-01-05', txnId: 1, accountId: 1 }]
    expect(valuePosition(inst, lots, 64_000, 0)).toEqual({ value: 96_000, notional: 96_000, exposureUnits: 1.5 })
    expect(valuePosition(inst, lots, 64_000, 0.01).value).toBeCloseTo(95_040, 9)
  })

  it('marks 24x7 assets at the business-day close: weekend moves land on Monday', () => {
    const book = new MemoryPriceBook()
    // Fri 2024-01-05 → Mon 2024-01-08, with a weekend rally.
    book.set('BTC-USD', [
      { date: '2024-01-05', close: 60_000 },
      { date: '2024-01-06', close: 62_000 },
      { date: '2024-01-07', close: 65_000 },
      { date: '2024-01-08', close: 66_000 },
    ])
    const dates = valuationDates(['BTC-USD'], book, '2024-01-05')
    expect(dates.sort()).toEqual(['2024-01-05', '2024-01-08'])
    const cash: Instrument = { id: 'USD', name: 'Cash', kind: 'cash', asset: null, priceSymbol: null, pointValue: null, contractSize: null }
    const instruments = new Map([
      [inst.id, inst],
      [cash.id, cash],
    ])
    const sub: Transaction = { ...txn(1, '2024-01-05', 100_000, 1), instrumentId: 'USD', type: 'subscription' }
    const run = runLedger([sub, txn(2, '2024-01-05', 1.5, 60_000)], instruments, book, dates, { baseNavPerUnit: 100, physicalHaircut: 0 })
    expect(run.points.map((p) => p.date)).toEqual(['2024-01-05', '2024-01-08'])
    const monday = run.points[1]
    expect(monday.values['BTC-CUSTODY']).toBe(1.5 * 66_000)
    expect(monday.pnl['BTC-CUSTODY']).toBe(1.5 * 6_000)
    expect(monday.byAsset[BTC]).toBe(99_000)
  })

  it('records a custody balance in the register and its ledger buy in BTC', () => {
    const db = useTestDb()
    const wallet = repo.createAccount({ name: 'Cold wallet', custody: 'wallet' })
    const exchange = repo.createAccount({ name: 'Exchange', custody: 'exchange' })
    expect([wallet.custody, exchange.custody]).toEqual(['wallet', 'exchange'])
    repo.ensureInstruments()
    // The fake asset is not in the universe seed; register its instrument like ensureInstruments would.
    db.prepare(`INSERT INTO pf_instruments (id, name, kind, metal, price_symbol) VALUES ('BTC-CUSTODY', 'Bitcoin (custody)', 'physical', 'btc', 'BTC-USD')`).run()

    const item = repo.createPhysical(
      { asset: BTC, form: 'balance', description: 'Cold storage multisig', weight: 1.5, weightUnit: 'BTC', purity: 1, accountId: wallet.id, acquiredDate: '2024-01-05', status: 'held' },
      { totalCost: 90_000, fees: 10, accountId: wallet.id },
      specOf,
    )
    expect(item).toMatchObject({ asset: BTC, form: 'balance', weightUnit: 'BTC', fineQty: 1.5 })
    const buy = repo.getTransaction(item.acquisitionTxnId!)!
    expect(buy).toMatchObject({ instrumentId: 'BTC-CUSTODY', type: 'buy', quantity: 1.5, price: 60_000, fees: 10 })

    const vaultItem = { ...item, value: 1.5 * 64_000, storageAccrued: 0 }
    const ok = vaultTotals([vaultItem], () => 1.5, [BTC_SPEC])
    expect(ok.warnings).toEqual([])
    expect(ok.totals).toEqual([{ asset: BTC, unitLabel: 'BTC', items: 1, fineQty: 1.5, value: 96_000, premiumPaid: 0, storageAccrued: 0, ledgerQty: 1.5 }])
    const off = vaultTotals([vaultItem], () => 1, [BTC_SPEC])
    expect(off.warnings).toEqual(['Bitcoin: register holds 1.500 BTC but the ledger holds 1.000 BTC.'])
  })

  it('keeps the bullion reconciliation wording in fine troy ounces', () => {
    const item = { id: 1, asset: 'gold' as AssetId, form: 'bar' as const, description: 'bar', weight: 1, weightUnit: 'oz' as const, purity: 1, fineQty: 1, serial: null, refiner: null, accountId: null, acquisitionTxnId: null, acquiredDate: null, premiumPaid: null, storageFeeRateAnnual: null, status: 'held' as const, notes: null, value: 2000, storageAccrued: 0 }
    expect(vaultTotals([item], () => 2, [UNIVERSE.gold]).warnings).toEqual(['Gold: register holds 1.000 fine oz but the ledger holds 2.000 oz.'])
  })
})

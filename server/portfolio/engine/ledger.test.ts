import { describe, expect, it } from 'vitest'
import type { Instrument, Transaction, TxnType } from '../../../shared/portfolio.js'
import { CASH_KEY, MemoryPriceBook, runLedger } from './ledger.js'
import { chainLink, twrDailyReturns } from './perf.js'

const INSTRUMENTS = new Map<string, Instrument>(
  (
    [
      { id: 'USD', name: 'Cash', kind: 'cash', asset: null, priceSymbol: null, pointValue: null, contractSize: null },
      { id: 'GLD', name: 'GLD', kind: 'etf', asset: 'gold', priceSymbol: 'GLD', pointValue: null, contractSize: null },
      { id: 'GC', name: 'Gold futures', kind: 'future', asset: 'gold', priceSymbol: 'GC=F', pointValue: 100, contractSize: 100 },
      { id: 'XAU-PHYS', name: 'Physical gold', kind: 'physical', asset: 'gold', priceSymbol: 'GC=F', pointValue: null, contractSize: null },
    ] satisfies Instrument[]
  ).map((i) => [i.id, i]),
)

let nextId = 1
function txn(tradeDate: string, type: TxnType, instrumentId: string, quantity: number, price = 1, fees = 0, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId++,
    tradeDate,
    settleDate: null,
    accountId: 1,
    counterAccountId: null,
    instrumentId,
    type,
    quantity,
    price,
    fees,
    currency: 'USD',
    notes: null,
    importBatch: null,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

function book() {
  const b = new MemoryPriceBook()
  b.set('GLD', [
    { date: '2024-01-01', close: 100 },
    { date: '2024-01-02', close: 110 },
    { date: '2024-01-03', close: 99 },
    { date: '2024-01-04', close: 99 },
  ])
  b.set('GC=F', [
    { date: '2024-01-01', close: 2000 },
    { date: '2024-01-02', close: 2010 },
    { date: '2024-01-03', close: 1990 },
    { date: '2024-01-04', close: 2020 },
  ])
  return b
}

const DATES = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']
const SETTINGS = { baseNavPerUnit: 100, physicalHaircut: 0 }

describe('ledger engine', () => {
  it('returns an empty run for an empty ledger', () => {
    const run = runLedger([], INSTRUMENTS, book(), DATES, SETTINGS)
    expect(run.points).toEqual([])
    expect(run.units).toEqual([])
  })

  it('unitizes flows at the pre-flow NAV/unit and marks futures as variation P&L', () => {
    nextId = 1
    const txns = [
      txn('2024-01-01', 'subscription', 'USD', 10_000),
      txn('2024-01-01', 'buy', 'GLD', 50, 100),
      txn('2024-01-02', 'subscription', 'USD', 11_000),
      txn('2024-01-03', 'futures_open', 'GC', 1, 2000, 5),
      txn('2024-01-04', 'redemption', 'USD', 5_000),
    ]
    const run = runLedger(txns, INSTRUMENTS, book(), DATES, SETTINGS)
    const [d1, d2, d3, d4] = run.points

    expect(d1.nav).toBeCloseTo(10_000, 8)
    expect(d1.units).toBeCloseTo(100, 10)
    expect(d1.navPerUnit).toBeCloseTo(100, 10)

    // Pre-flow NAV on d2: 5,000 cash + 50 × 110 = 10,500 → 105/unit
    expect(run.units[1].navPerUnit).toBeCloseTo(105, 10)
    expect(run.units[1].units).toBeCloseTo(11_000 / 105, 10)
    expect(d2.nav).toBeCloseTo(21_500, 8)
    expect(d2.navPerUnit).toBeCloseTo(105, 10)
    expect(d2.dailyReturn).toBeCloseTo(0.05, 12)

    // d3: futures valued at P&L (1 × 100 × (1990 − 2000)), fee out of cash
    expect(d3.values.GC).toBeCloseTo(-1000, 8)
    expect(d3.cash).toBeCloseTo(15_995, 8)
    expect(d3.nav).toBeCloseTo(15_995 + 4_950 - 1_000, 8)
    expect(d3.grossExposure).toBeCloseTo(4_950 + 199_000, 6)
    expect(d3.navPerUnit).toBeCloseTo(19_945 / (100 + 11_000 / 105), 8)

    // Redemption cancels units at the pre-flow NAV/unit
    const npu4 = run.units[2].navPerUnit
    expect(run.units[2].units).toBeCloseTo(-5_000 / npu4, 10)
    expect(d4.navPerUnit).toBeCloseTo(npu4, 10)

    // Flow-adjusted TWR from NAV + flows equals the NAV/unit chain
    const navs = run.points.map((p) => p.nav)
    const flows = run.points.map((p) => p.netFlow)
    const twr = chainLink(twrDailyReturns(navs, flows))
    expect(twr).toBeCloseTo(d4.navPerUnit! / 100 - 1, 12)

    // Attribution reconciles: Σ cumulative P&L = NAV − net contributions
    const totalPnl = Object.values(d4.cumPnl).reduce((s, x) => s + x, 0)
    expect(totalPnl).toBeCloseTo(d4.nav - (10_000 + 11_000 - 5_000), 6)
    expect(d4.cumPnl.GLD).toBeCloseTo(50 * (99 - 100), 8)
    expect(d4.cumPnl.GC).toBeCloseTo(100 * (2020 - 2000) - 5, 8)

    // Growth-linked contributions sum exactly to TWR, from inception and from a later start
    const linked = Object.values(d4.cumContrib).reduce((s, x) => s + x, 0)
    expect(linked).toBeCloseTo(d4.navPerUnit! / 100 - 1, 12)
    const fromD2 = Object.keys(d4.cumContrib).reduce((s, k) => s + ((d4.cumContrib[k] ?? 0) - (d2.cumContrib[k] ?? 0)) * (100 / d2.navPerUnit!), 0)
    expect(fromD2).toBeCloseTo(d4.navPerUnit! / d2.navPerUnit! - 1, 12)
  })

  it('realizes futures P&L to cash on close and tracks income, fees and physical haircut', () => {
    nextId = 100
    const txns = [
      txn('2024-01-01', 'subscription', 'USD', 1_000_000),
      txn('2024-01-01', 'futures_open', 'GC', -2, 2000, 10),
      txn('2024-01-01', 'buy', 'XAU-PHYS', 100, 2050, 0),
      txn('2024-01-02', 'futures_close', 'GC', 2, 2010, 10),
      txn('2024-01-03', 'storage_fee', 'XAU-PHYS', 150),
      txn('2024-01-03', 'interest', 'USD', 400),
      txn('2024-01-04', 'fee', 'USD', 1_000),
    ]
    const run = runLedger(txns, INSTRUMENTS, book(), DATES, { baseNavPerUnit: 100, physicalHaircut: 0.01 })
    const last = run.points.at(-1)!
    // Short 2 GC from 2000 closed at 2010: −2,000 realized
    expect(run.positions.get('GC')!.realized).toBeCloseTo(-2_000, 8)
    expect(run.positions.get('GC')!.lots).toHaveLength(0)
    expect(last.values.GC).toBe(0)
    // Physical: 100 oz × 2020 × 0.99
    expect(last.values['XAU-PHYS']).toBeCloseTo(100 * 2020 * 0.99, 6)
    const cash = 1_000_000 - 10 - 205_000 - 2_000 - 10 - 150 + 400 - 1_000
    expect(last.cash).toBeCloseTo(cash, 6)
    expect(last.cumPnl[CASH_KEY]).toBeCloseTo(400 - 1_000, 8)
    expect(run.positions.get('XAU-PHYS')!.expenses).toBe(150)
    const totalPnl = Object.values(last.cumPnl).reduce((s, x) => s + x, 0)
    expect(totalPnl).toBeCloseTo(last.nav - 1_000_000, 6)
  })

  it('warns about unmatched futures closes and oversells', () => {
    nextId = 200
    const run = runLedger(
      [txn('2024-01-01', 'subscription', 'USD', 1000), txn('2024-01-02', 'futures_close', 'GC', 1, 2000), txn('2024-01-02', 'sell', 'GLD', 1, 110)],
      INSTRUMENTS,
      book(),
      DATES,
      SETTINGS,
    )
    expect(run.warnings.some((w) => w.includes('no open position'))).toBe(true)
    expect(run.warnings.some((w) => w.includes('short lot'))).toBe(true)
  })

  it('handles in-kind deposits as unitized flows at their stated value', () => {
    nextId = 300
    const run = runLedger(
      [txn('2024-01-01', 'deposit', 'GLD', 100, 100), txn('2024-01-02', 'subscription', 'USD', 1000)],
      INSTRUMENTS,
      book(),
      DATES,
      SETTINGS,
    )
    expect(run.points[0].units).toBeCloseTo(100, 10)
    expect(run.points[1].navPerUnit).toBeCloseTo(110, 10)
    expect(run.points[1].cumPnl.GLD).toBeCloseTo(1000, 8)
  })
})

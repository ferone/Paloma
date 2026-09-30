import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../shared/portfolio.js'
import { autoMap, buildPreview, exportCsv, normalizeType, parseCsv, parseDate, parseNumber, resolveInstrument } from './csv.js'
import { universeInstruments } from './repo.js'

const instruments = new Map(universeInstruments().map((i) => [i.id, i]))
const accounts: Account[] = [
  { id: 1, name: 'Interactive Brokers', custody: 'broker', institution: null, notes: null, createdAt: '' },
  { id: 2, name: 'Zurich Vault', custody: 'vault', institution: null, notes: null, createdAt: '' },
]

describe('CSV parsing primitives', () => {
  it('parses numbers with currency, thousands and accounting negatives', () => {
    expect(parseNumber('$1,234.50')).toBe(1234.5)
    expect(parseNumber('(12.00)')).toBe(-12)
    expect(parseNumber(' ')).toBeNull()
    expect(parseNumber('abc')).toBe('invalid')
  })

  it('parses ISO, US and European dates and rejects impossible ones', () => {
    expect(parseDate('2024-03-05')).toBe('2024-03-05')
    expect(parseDate('3/5/2024')).toBe('2024-03-05')
    expect(parseDate('05.03.2024')).toBe('2024-03-05')
    expect(parseDate('2024-02-30')).toBe('invalid')
  })

  it('normalizes types and resolves instruments including futures contracts', () => {
    expect(normalizeType('Bought')).toBe('buy')
    expect(normalizeType('futures_open')).toBe('futures_open')
    expect(normalizeType('Storage Fee')).toBe('storage_fee')
    expect(normalizeType('???')).toBeNull()
    expect(resolveInstrument('gld', instruments)).toBe('GLD')
    expect(resolveInstrument('GCZ26', instruments)).toBe('GC')
    expect(resolveInstrument('MGCG7', instruments)).toBe('MGC')
    expect(resolveInstrument('SI=F', instruments)).toBe('SI')
    expect(resolveInstrument('Physical Gold', instruments)).toBe('XAU-PHYS')
    expect(resolveInstrument('Cash', instruments)).toBe('USD')
    expect(resolveInstrument('TSLA', instruments)).toBeNull()
  })
})

describe('CSV preview', () => {
  const csv = [
    'Date,Action,Symbol,Account,Qty,Price,Commission,Amount,Memo',
    '2024-01-02,Subscription,,Interactive Brokers,,,,"1,000,000.00",seed capital',
    '2024-01-03,Bought,GLD,Interactive Brokers,100,190.5,1.00,,',
    '2024-01-03,Bought,GLD,Interactive Brokers,100,190.5,1.00,,',
    '2024-01-04,Sell,GLD,Nowhere,10,191,,,',
    '2024-13-01,Buy,IAU,Interactive Brokers,1,1,,,',
    '2024-01-05,Buy,GC,Interactive Brokers,1,2000,,,',
    '2024-01-05,Open,GCG24,Interactive Brokers,-2,2050,5,,short',
  ].join('\n')

  it('auto-maps common broker headers', () => {
    const { headers } = parseCsv(csv)
    expect(autoMap(headers)).toEqual({
      tradeDate: 'Date',
      type: 'Action',
      instrument: 'Symbol',
      account: 'Account',
      quantity: 'Qty',
      price: 'Price',
      fees: 'Commission',
      amount: 'Amount',
      notes: 'Memo',
    })
  })

  it('validates rows, flags in-file and ledger duplicates', () => {
    const { headers, records } = parseCsv(csv)
    const existing: Transaction[] = [
      {
        id: 42,
        tradeDate: '2024-01-03',
        settleDate: null,
        accountId: 1,
        counterAccountId: null,
        instrumentId: 'GLD',
        type: 'buy',
        quantity: 100,
        price: 190.5,
        fees: 1,
        currency: 'USD',
        notes: null,
        importBatch: null,
        createdAt: '',
        updatedAt: '',
      },
    ]
    const rows = buildPreview(records, autoMap(headers), { instruments, accounts, existing })
    expect(rows).toHaveLength(7)

    expect(rows[0].errors).toEqual([])
    expect(rows[0].parsed).toMatchObject({ type: 'subscription', instrumentId: 'USD', quantity: 1_000_000, price: 1, notes: 'seed capital' })

    expect(rows[1].parsed).toMatchObject({ type: 'buy', instrumentId: 'GLD', quantity: 100, price: 190.5, fees: 1 })
    expect(rows[1].duplicateOfTxnId).toBe(42)
    expect(rows[2].duplicateInFile).toBe(true)

    expect(rows[3].errors).toContain('Unknown account "Nowhere"')
    expect(rows[4].errors[0]).toMatch(/Unrecognized date/)
    expect(rows[5].errors.join()).toMatch(/buy is not valid for GC/)
    expect(rows[6].parsed).toMatchObject({ type: 'futures_open', instrumentId: 'GC', quantity: -2, price: 2050, fees: 5 })
    expect(rows[5].rowNumber).toBe(7)
  })

  it('uses a default account when no account column is mapped', () => {
    const { headers, records } = parseCsv('date,type,symbol,qty,price\n2024-01-02,buy,SLV,5,22')
    const rows = buildPreview(records, autoMap(headers), { instruments, accounts, existing: [], defaultAccountId: 2 })
    expect(rows[0].parsed).toMatchObject({ accountId: 2, instrumentId: 'SLV' })
  })

  it('round-trips the export format through the importer', () => {
    const txns: Transaction[] = [
      {
        id: 1,
        tradeDate: '2024-01-02',
        settleDate: '2024-01-04',
        accountId: 1,
        counterAccountId: null,
        instrumentId: 'IAU',
        type: 'buy',
        quantity: 250,
        price: 38.12,
        fees: 2.5,
        currency: 'USD',
        notes: 'note, with comma',
        importBatch: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 2,
        tradeDate: '2024-02-01',
        settleDate: null,
        accountId: 1,
        counterAccountId: 2,
        instrumentId: 'XAU-PHYS',
        type: 'transfer',
        quantity: 32.15,
        price: 1,
        fees: 0,
        currency: 'USD',
        notes: null,
        importBatch: null,
        createdAt: '',
        updatedAt: '',
      },
    ]
    const csv = exportCsv(txns, accounts)
    const { headers, records } = parseCsv(csv)
    const rows = buildPreview(records, autoMap(headers), { instruments, accounts, existing: [] })
    expect(rows.every((r) => r.errors.length === 0)).toBe(true)
    expect(rows.map((r) => r.parsed)).toEqual(txns.map(({ tradeDate, settleDate, accountId, counterAccountId, instrumentId, type, quantity, price, fees, notes }) => ({
      tradeDate,
      settleDate,
      accountId,
      counterAccountId,
      instrumentId,
      type,
      quantity,
      price,
      fees,
      notes,
    })))
  })
})

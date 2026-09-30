import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../shared/portfolio.js'
import { fallbackMarks, fallbackWarnings } from './fallback.js'

const inst = (id: string, priceSymbol: string): Instrument => ({ id, name: id, kind: 'physical', asset: 'btc', priceSymbol, pointValue: null, contractSize: null }) as unknown as Instrument
const lot = (qty: number) => ({ qty, unitCost: 100, date: '2025-06-02', accountId: 1 })

describe('fallback marks', () => {
  it('flags only HELD positions valued at a last-trade fallback', () => {
    const run = {
      marks: new Map([
        ['BTC-SPOT', { price: 105000, date: '2025-06-02', fallback: true }],
        ['GLD', { price: 381, date: '2026-09-30', fallback: false }],
        ['OLD', { price: 10, date: '2024-01-02', fallback: true }], // closed out
      ]),
      positions: new Map([
        ['BTC-SPOT', { lots: [lot(12.5)] }],
        ['GLD', { lots: [lot(100)] }],
        ['OLD', { lots: [] }],
      ]),
    }
    const c = { run, instruments: new Map([['BTC-SPOT', inst('BTC-SPOT', 'BTC=F')]]) } as unknown as Parameters<typeof fallbackMarks>[0]
    expect(fallbackMarks(c)).toEqual([{ instrumentId: 'BTC-SPOT', date: '2025-06-02', priceSymbol: 'BTC=F' }])
    expect(fallbackWarnings(c)[0]).toContain('BTC-SPOT is valued at its last trade price (2025-06-02)')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client'
import type { CurveResponse } from '../../shared/markets'
import { readCurveHistory, saveCurveSnapshot } from './repo'

const curve = (termCarry: number, price: number): CurveResponse => ({
  metal: 'gold',
  root: 'GC',
  exchange: 'COMEX',
  unitLabel: '$/oz',
  referenceSymbol: 'GCZ26.CMX',
  contracts: [
    {
      symbol: 'GCZ26.CMX', root: 'GC', month: 12, year: 2026, label: 'Dec 26', expiry: '2026-12-29', daysToExpiry: 90, price,
      change: 0, volume: 1, openInterest: 1, lastTrade: null, stale: false, isReference: true, spread: 0, carry: null,
    },
  ],
  rate: { symbol: '^IRX', value: 0.04 },
  shape: 'contango',
  termCarry,
  carryMinusRate: termCarry - 0.04,
  provenance: { source: 'test', asOf: null },
})

describe('curve snapshots', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('keeps one row per metal per day (latest wins) in date order', () => {
    saveCurveSnapshot(curve(0.05, 4100), '2026-09-29')
    saveCurveSnapshot(curve(0.055, 4150), '2026-09-30')
    saveCurveSnapshot(curve(0.057, 4190), '2026-09-30')
    expect(readCurveHistory('gold')).toEqual([
      { date: '2026-09-29', termCarry: 0.05, rate: 0.04, referencePrice: 4100 },
      { date: '2026-09-30', termCarry: 0.057, rate: 0.04, referencePrice: 4190 },
    ])
    expect(readCurveHistory('silver')).toEqual([])
  })
})

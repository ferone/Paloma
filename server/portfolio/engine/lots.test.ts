import { describe, expect, it } from 'vitest'
import { applyFill, costBasis, netQty, transferLots, type Lot } from './lots.js'

describe('FIFO lots', () => {
  it('folds buy fees into cost and closes FIFO across lots with partial closes', () => {
    const lots: Lot[] = []
    applyFill(lots, 100, 10, { fees: 10, date: '2024-01-02', txnId: 1, accountId: 1 })
    applyFill(lots, 50, 12, { fees: 0, date: '2024-01-03', txnId: 2, accountId: 1 })
    expect(lots[0].unitCost).toBeCloseTo(10.1, 10)
    expect(costBasis(lots)).toBeCloseTo(1010 + 600, 8)

    const r = applyFill(lots, -120, 15, { fees: 12, date: '2024-02-01', txnId: 3, accountId: 1 })
    // 100 × (15 − 10.1) + 20 × (15 − 12) − 12 fees
    expect(r.realized).toBeCloseTo(490 + 60 - 12, 8)
    expect(r.closedQty).toBe(120)
    expect(r.opened).toBeNull()
    expect(lots).toHaveLength(1)
    expect(lots[0]).toMatchObject({ txnId: 2, qty: 30, unitCost: 12 })
  })

  it('opens a short lot when selling more than held, and covers it later', () => {
    const lots: Lot[] = []
    applyFill(lots, 5, 10, { date: '2024-01-02' })
    const r = applyFill(lots, -15, 20, { fees: 10, date: '2024-01-03' })
    // Closes 5 long: 5 × (20 − 10) − 10 × (5/15) fees
    expect(r.realized).toBeCloseTo(50 - 10 / 3, 8)
    expect(netQty(lots)).toBe(-10)
    // Short lot proceeds net of its share of fees: 20 − (20/3)/10
    expect(lots[0].unitCost).toBeCloseTo(20 - 2 / 3, 8)
    const cover = applyFill(lots, 4, 15, { date: '2024-01-04' })
    expect(cover.realized).toBeCloseTo(-1 * 4 * (15 - (20 - 2 / 3)), 8)
    expect(netQty(lots)).toBe(-6)
  })

  it('applies the futures multiplier with fees left to the caller', () => {
    const lots: Lot[] = []
    applyFill(lots, 5, 1800, { multiplier: 100, fees: 25, feesInCost: false, date: '2023-03-01' })
    expect(lots[0].unitCost).toBe(1800)
    const r = applyFill(lots, -3, 1850, { multiplier: 100, fees: 15, feesInCost: false, date: '2023-05-01' })
    expect(r.realized).toBe(3 * 100 * 50)
    expect(netQty(lots)).toBe(2)
    const short = applyFill(lots, -4, 1900, { multiplier: 100, feesInCost: false, date: '2023-06-01' })
    expect(short.realized).toBe(2 * 100 * 100)
    expect(netQty(lots)).toBe(-2)
    expect(lots[0].unitCost).toBe(1900)
  })

  it('prefers lots in the fill account and flags cross-account consumption', () => {
    const lots: Lot[] = []
    applyFill(lots, 10, 1, { date: '2024-01-01', accountId: 1 })
    applyFill(lots, 10, 2, { date: '2024-01-02', accountId: 2 })
    const r = applyFill(lots, -12, 3, { date: '2024-01-03', accountId: 2 })
    // Account 2's lot (cost 2) first, then 2 units from account 1 (cost 1)
    expect(r.realized).toBeCloseTo(10 * 1 + 2 * 2, 10)
    expect(r.crossedAccounts).toBe(true)
    expect(lots).toEqual([expect.objectContaining({ accountId: 1, qty: 8 })])
  })

  it('transfers lots between accounts preserving cost and open date', () => {
    const lots: Lot[] = []
    applyFill(lots, 10, 5, { date: '2024-01-01', accountId: 1, txnId: 1 })
    applyFill(lots, 10, 6, { date: '2024-01-05', accountId: 1, txnId: 2 })
    const moved = transferLots(lots, 15, 1, 2)
    expect(moved).toBe(15)
    expect(costBasis(lots)).toBeCloseTo(110, 10)
    const inTwo = lots.filter((l) => l.accountId === 2)
    expect(inTwo.map((l) => [l.qty, l.unitCost, l.openDate])).toEqual([
      [10, 5, '2024-01-01'],
      [5, 6, '2024-01-05'],
    ])
    expect(transferLots(lots, 100, 1, 2)).toBe(5)
  })
})

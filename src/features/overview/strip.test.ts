import { describe, expect, it } from 'vitest'
import { pickColumns } from './strip'

describe('pickColumns', () => {
  it('avoids a lone tile on the last row', () => {
    // 15 tiles, 7 fit: 7+7+1 would leave an orphan; 5 columns gives 3 full rows.
    expect(pickColumns(15, 7)).toBe(5)
    // 15 tiles, 14 fit: 14+1 orphan → 15 does not fit, so the fullest last row wins.
    expect(15 % pickColumns(15, 14)).not.toBe(1)
  })

  it('puts everything on one row when it fits, and handles edge cases', () => {
    expect(pickColumns(15, 16)).toBe(15)
    expect(pickColumns(4, 2)).toBe(2)
    expect(pickColumns(0, 5)).toBe(1)
    expect(pickColumns(7, 0)).toBe(1)
  })

  it('never shrinks below half the columns that fit', () => {
    // 13 is prime: no divisor in 6..12, so it picks the fullest last row within that range.
    const c = pickColumns(13, 12)
    expect(c).toBeGreaterThanOrEqual(6)
    expect(13 % c === 0 || 13 % c >= c / 2).toBe(true)
  })
})

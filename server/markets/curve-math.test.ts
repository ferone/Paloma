import { describe, expect, it } from 'vitest'
import { annualizedCarry, classifyCurve, daysBetween, pickReference, upcomingContractMonths } from './curve-math'

describe('annualizedCarry', () => {
  it('annualizes the spread on an ACT/360 basis', () => {
    // 1% over 90 days → 4% annualized
    expect(annualizedCarry(100, 101, 90)).toBeCloseTo(0.04, 10)
    // Backwardation is negative
    expect(annualizedCarry(100, 99, 180)).toBeCloseTo(-0.02, 10)
  })

  it('handles a negative interval (near contract after the reference)', () => {
    // Contract 60 days BEFORE the reference priced 1% lower: still +6% carry
    expect(annualizedCarry(100, 99, -60)).toBeCloseTo(0.06, 10)
  })

  it('returns null for unusable inputs', () => {
    expect(annualizedCarry(0, 100, 30)).toBeNull()
    expect(annualizedCarry(100, 101, 0)).toBeNull()
    expect(annualizedCarry(100, Number.NaN, 30)).toBeNull()
  })

  it('matches a realistic gold Dec/Dec spread', () => {
    // GCZ26 4186.3 → GCZ27 4433.5, 365 days apart ≈ 5.82%
    expect(annualizedCarry(4186.3, 4433.5, 365)).toBeCloseTo((4433.5 / 4186.3 - 1) * (360 / 365), 10)
  })
})

describe('classifyCurve', () => {
  const curve = (prices: number[], step = 60) => prices.map((price, i) => ({ days: 30 + i * step, price }))

  it('labels an upward curve as contango', () => {
    const r = classifyCurve(curve([100, 100.7, 101.4, 102.1, 102.8, 103.5, 104.2]))
    expect(r.shape).toBe('contango')
    expect(r.termCarry).toBeGreaterThan(0.03)
    expect(r.upShare).toBe(1)
  })

  it('labels a downward curve as backwardation', () => {
    expect(classifyCurve(curve([104, 103, 102, 101.5, 101, 100.5, 100])).shape).toBe('backwardation')
  })

  it('labels a curve within the flat band as flat', () => {
    expect(classifyCurve(curve([100, 100.01, 100.02, 100.01, 100.03, 100.02, 100.04])).shape).toBe('flat')
  })

  it('labels a kinked curve with clear term carry as mixed', () => {
    expect(classifyCurve(curve([100, 101.5, 101, 102, 101.8, 103, 102.5])).shape).toBe('mixed')
  })

  it('needs at least two live points', () => {
    expect(classifyCurve([{ days: 30, price: 100 }]).shape).toBe('insufficient')
    expect(classifyCurve([{ days: 30, price: 100 }, { days: 90, price: 0 }]).shape).toBe('insufficient')
  })

  it('measures term carry to the point nearest one year out', () => {
    const r = classifyCurve([
      { days: 10, price: 100 },
      { days: 200, price: 101 },
      { days: 370, price: 104 },
      { days: 700, price: 110 },
    ])
    expect(r.termCarry).toBeCloseTo(0.04, 10) // 4% over 360 days
  })
})

describe('pickReference', () => {
  it('prefers open interest, then volume', () => {
    expect(pickReference([{ openInterest: 12_000, volume: 1_000 }, { openInterest: 325_000, volume: 120_000 }, { openInterest: 41_000, volume: 7_000 }])).toBe(1)
    expect(pickReference([{ openInterest: null, volume: 5 }, { openInterest: null, volume: 9 }])).toBe(1)
    expect(pickReference([])).toBe(-1)
  })
})

describe('contract month helpers', () => {
  it('lists active months across the year boundary', () => {
    const months = upcomingContractMonths([2, 4, 6, 8, 10, 12], new Date(Date.UTC(2026, 9, 1)), 12)
    expect(months.map((m) => `${m.month}/${m.year}`)).toEqual(['10/2026', '12/2026', '2/2027', '4/2027', '6/2027', '8/2027', '10/2027'])
  })

  it('counts calendar days', () => {
    expect(daysBetween('2026-10-01', '2026-12-29')).toBe(89)
  })
})

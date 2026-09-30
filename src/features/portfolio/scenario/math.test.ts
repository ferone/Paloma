import { describe, expect, it } from 'vitest'
import { annualizedVolatility, cagr, maxDrawdown, simulate } from './math'

describe('scenario math', () => {
  it('computes CAGR and drawdown', () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 12)
    expect(cagr(100, 121, 0)).toBeNull()
    expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-0.25, 12)
    expect(annualizedVolatility([0.01])).toBeNull()
  })

  it('simulates buy-and-hold on dates common to every leg', () => {
    const series = {
      A: [
        { date: '2024-01-01', close: 10 },
        { date: '2024-01-02', close: 11 },
        { date: '2024-01-03', close: 12 },
      ],
      B: [
        { date: '2024-01-01', close: 20 },
        { date: '2024-01-03', close: 10 },
      ],
    }
    const r = simulate(1000, [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }], series, '2024-01-01', '2024-12-31')!
    expect(r.observations).toBe(2)
    // 50 units of A → 600, 25 units of B → 250
    expect(r.finalValue).toBeCloseTo(850, 10)
    expect(r.totalReturn).toBeCloseTo(-0.15, 12)
  })

  it('rebalances to target weights at month ends', () => {
    const series = {
      A: [
        { date: '2024-01-30', close: 10 },
        { date: '2024-01-31', close: 20 },
        { date: '2024-02-01', close: 10 },
      ],
      B: [
        { date: '2024-01-30', close: 10 },
        { date: '2024-01-31', close: 10 },
        { date: '2024-02-01', close: 10 },
      ],
    }
    const legs = [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }]
    // Hold: 5 A + 5 B → 50 + 50
    expect(simulate(100, legs, series, '2024-01-01', '2024-12-31', 'none')!.finalValue).toBeCloseTo(100, 10)
    // Rebalance at Jan 31 (value 150 → 3.75 A + 7.5 B) → 37.5 + 75
    expect(simulate(100, legs, series, '2024-01-01', '2024-12-31', 'monthly')!.finalValue).toBeCloseTo(112.5, 10)
    expect(simulate(100, legs, series, '2025-01-01', '2025-12-31')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  align,
  beta,
  changeOver,
  correlation,
  monthsBefore,
  percentileLast,
  rollingCorrelation,
  valueAtOrBefore,
  zScoreLast,
} from './analytics.js'

describe('date helpers', () => {
  it('steps back calendar months, clamping to month end', () => {
    expect(monthsBefore('2026-09-28', 1)).toBe('2026-08-28')
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28')
    expect(monthsBefore('2026-01-15', 3)).toBe('2025-10-15')
    expect(monthsBefore('2026-09-30', 36)).toBe('2023-09-30')
  })

  it('finds the last value on or before a date', () => {
    const pts = [
      { date: '2026-01-02', value: 1 },
      { date: '2026-01-05', value: 2 },
    ]
    expect(valueAtOrBefore(pts, '2026-01-04')?.value).toBe(1)
    expect(valueAtOrBefore(pts, '2026-01-05')?.value).toBe(2)
    expect(valueAtOrBefore(pts, '2025-12-31')).toBeNull()
  })
})

describe('changes and standardization', () => {
  const pts = [
    { date: '2026-06-26', value: 2.18 },
    { date: '2026-08-28', value: 2.42 },
    { date: '2026-09-28', value: 2.9 },
  ]
  it('computes 1m and 3m changes as differences or percent', () => {
    expect(changeOver(pts, 1, 'diff')).toBeCloseTo(0.48, 9)
    expect(changeOver(pts, 3, 'diff')).toBeCloseTo(0.72, 9)
    expect(changeOver(pts, 3, 'pct')).toBeCloseTo(2.9 / 2.18 - 1, 9)
    expect(changeOver(pts.slice(-1), 1, 'diff')).toBeNull()
  })

  it('z-score and percentile of the latest value', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(zScoreLast(xs)).toBeCloseTo((10 - 5.5) / Math.sqrt(9.1666666667), 6)
    expect(percentileLast(xs)).toBe(1)
    expect(percentileLast([...xs, 1])).toBeCloseTo(2 / 11, 9)
    expect(zScoreLast([1, 2])).toBeNull()
    expect(zScoreLast(Array(12).fill(3))).toBeNull()
  })
})

describe('correlation math', () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  it('Pearson correlation and OLS beta', () => {
    expect(correlation(x, x.map((v) => 2 * v + 1))).toBeCloseTo(1, 12)
    expect(correlation(x, x.map((v) => -v))).toBeCloseTo(-1, 12)
    expect(correlation(x, Array(8).fill(1))).toBeNull()
    expect(beta(x.map((v) => 3 * v - 2), x)).toBeCloseTo(3, 12)
    // Known value: x vs squares.
    expect(correlation([1, 2, 3, 4, 5], [1, 4, 9, 16, 25])).toBeCloseTo(0.9811049, 6)
  })

  it('rolling correlation matches the batch computation per window', () => {
    const a = [0.1, -0.2, 0.3, 0.05, -0.1, 0.2, -0.3, 0.15, 0.0, 0.25]
    const b = [0.2, -0.1, 0.1, 0.1, -0.3, 0.1, -0.2, 0.3, -0.1, 0.2]
    const r = rollingCorrelation(a, b, 5)
    expect(r.slice(0, 4)).toEqual([null, null, null, null])
    for (let i = 4; i < a.length; i++) expect(r[i]!).toBeCloseTo(correlation(a.slice(i - 4, i + 1), b.slice(i - 4, i + 1))!, 9)
  })

  it('aligns series on common dates', () => {
    const { dates, cols } = align([
      [
        { date: 'a', value: 1 },
        { date: 'b', value: 2 },
        { date: 'c', value: 3 },
      ],
      [
        { date: 'b', value: 20 },
        { date: 'c', value: 30 },
      ],
    ])
    expect(dates).toEqual(['b', 'c'])
    expect(cols).toEqual([
      [2, 3],
      [20, 30],
    ])
  })
})

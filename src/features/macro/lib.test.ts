import { describe, expect, it } from 'vitest'
import { fmtChange, fmtLevel, joinForwardFill, thin } from './lib'

describe('macro client helpers', () => {
  it('formats levels and changes by unit', () => {
    expect(fmtLevel(2.9, 'percent')).toBe('2.90%')
    expect(fmtLevel(23342.8, 'usd_bn')).toBe('$23.34T')
    expect(fmtLevel(4211.7, 'usd')).toBe('$4,212')
    expect(fmtChange(0.72, 'diff', 'percent')).toBe('+0.72pp')
    expect(fmtChange(-0.006, 'pct', 'index')).toBe('−0.6%')
    expect(fmtChange(null, 'diff', 'percent')).toBe('—')
  })

  it('forward-fills a driver onto the metal dates', () => {
    const base = [
      { date: '2026-01-01', value: 1 },
      { date: '2026-01-02', value: 2 },
      { date: '2026-01-05', value: 3 },
    ]
    const other = [
      { date: '2026-01-02', value: 10 },
      { date: '2026-01-04', value: 11 },
    ]
    expect(joinForwardFill(base, other)).toEqual([
      { date: '2026-01-02', a: 2, b: 10 },
      { date: '2026-01-05', a: 3, b: 11 },
    ])
  })

  it('thins long series and keeps the last point', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i)
    const t = thin(xs, 100)
    expect(t.length).toBeLessThanOrEqual(101)
    expect(t.at(-1)).toBe(999)
  })
})

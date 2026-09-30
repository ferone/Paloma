import { describe, expect, it } from 'vitest'
import { fmtNum, fmtPct, fmtPctSigned, fmtUsd, fmtUsdCompact, fmtUsdSigned, fmtDate, fmtAge } from './format'

describe('format', () => {
  it('renders an em dash for missing or non-finite values', () => {
    for (const f of [fmtNum, fmtPct, fmtUsd, fmtUsdCompact]) {
      expect(f(null)).toBe('—')
      expect(f(Number.NaN)).toBe('—')
    }
  })

  it('uses a typographic minus and explicit plus', () => {
    expect(fmtUsd(-1234.5)).toBe('−$1,234.50')
    expect(fmtUsdSigned(12)).toBe('+$12.00')
    expect(fmtPctSigned(-0.0123)).toBe('−1.23%')
    expect(fmtPct(0.5, 0)).toBe('50%')
  })

  it('formats compact currency and dates', () => {
    expect(fmtUsdCompact(48_600_000_000)).toBe('$48.6B')
    expect(fmtDate('2026-09-30')).toBe('30 Sep 2026')
    expect(fmtAge(Date.now() - 5 * 60_000)).toBe('5 min ago')
  })
})

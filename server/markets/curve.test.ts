import { describe, expect, it, vi } from 'vitest'

// No network: every quote request resolves empty.
vi.mock('../services/yahoo-finance.service.js', () => ({ getDetailedQuotes: vi.fn(async () => []) }))

import { UNIVERSE } from '../../shared/universe'
import { getDetailedQuotes } from '../services/yahoo-finance.service.js'
import { buildCurve } from './curve'

describe('buildCurve', () => {
  it('requests the listed months with the exchange suffix and reports the unit', async () => {
    const c = await buildCurve('gold', new Date('2026-10-01T12:00:00Z'))
    const symbols = vi.mocked(getDetailedQuotes).mock.calls[0][0]
    expect(symbols[0]).toBe('GCV26.CMX')
    expect(symbols.at(-1)).toBe('^IRX')
    expect(c).toMatchObject({ root: 'GC', exchange: 'COMEX', unitLabel: '$/oz', contracts: [], shape: 'insufficient' })
    expect(c.provenance.source).toContain('COMEX GC listed months')
  })

  it('returns an empty curve for an asset without futures instead of dereferencing futures[0]', async () => {
    const saved = UNIVERSE.silver.futures
    UNIVERSE.silver.futures = []
    try {
      vi.mocked(getDetailedQuotes).mockClear()
      const c = await buildCurve('silver')
      expect(c).toMatchObject({ root: null, exchange: null, contracts: [], referenceSymbol: null })
      expect(getDetailedQuotes).not.toHaveBeenCalled()
    } finally {
      UNIVERSE.silver.futures = saved
    }
  })
})

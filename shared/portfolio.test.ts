import { describe, expect, it } from 'vitest'
import {
  BENCHMARKS,
  DEFAULT_BENCHMARK,
  DEFAULT_PORTFOLIO_SETTINGS,
  dominantAsset,
  exposureUnitOf,
  physicalItemInputSchema,
  physicalItemIssues,
  physicalQuantity,
  toTroyOz,
} from './portfolio.js'
import { ASSETS, UNIVERSE, type PhysicalSpec } from './universe.js'

const BULLION: PhysicalSpec = { unit: 'oz', kind: 'bullion', instrumentId: 'XAU-PHYS' }
// Not in the universe yet: a custody balance counted in BTC.
const CUSTODY: PhysicalSpec = { unit: 'BTC', kind: 'custody', instrumentId: 'BTC-CUSTODY' }

describe('physical units', () => {
  it('converts bullion weights to fine troy ounces', () => {
    expect(toTroyOz(1, 'kg')).toBeCloseTo(32.1507466, 6)
    expect(toTroyOz(31.1034768, 'g')).toBeCloseTo(1, 12)
    expect(physicalQuantity(BULLION, { weight: 1, weightUnit: 'kg', purity: 0.9999 })).toBeCloseTo(32.1507466 * 0.9999, 6)
    expect(physicalQuantity(BULLION, { weight: 1000, weightUnit: 'oz', purity: 0.999 })).toBeCloseTo(999, 9)
  })

  it('counts a custody balance as a plain quantity in the spec unit (no troy-oz conversion)', () => {
    expect(physicalQuantity(CUSTODY, { weight: 1.25, weightUnit: 'BTC', purity: 1 })).toBe(1.25)
  })

  it('rejects a non-bullion unit for bullion', () => {
    expect(() => physicalQuantity(BULLION, { weight: 1, weightUnit: 'BTC', purity: 1 })).toThrow(/bullion/)
  })

  it('validates register items against the physical spec', () => {
    expect(physicalItemIssues(BULLION, { form: 'bar', weightUnit: 'kg', purity: 0.9999 })).toEqual([])
    expect(physicalItemIssues(BULLION, { form: 'balance', weightUnit: 'BTC', purity: 1 }).map((i) => i.path)).toEqual(['form', 'weightUnit'])
    expect(physicalItemIssues(CUSTODY, { form: 'balance', weightUnit: 'BTC', purity: 1 })).toEqual([])
    expect(physicalItemIssues(CUSTODY, { form: 'bar', weightUnit: 'oz', purity: 0.999 }).map((i) => i.path)).toEqual(['form', 'weightUnit', 'purity'])
  })

  it('schema accepts universe bullion and refuses custody fields on it', () => {
    const base = { asset: 'gold', description: 'bar', weight: 1, purity: 0.9999 }
    expect(physicalItemInputSchema.safeParse({ ...base, form: 'bar', weightUnit: 'kg' }).success).toBe(true)
    expect(physicalItemInputSchema.safeParse({ ...base, form: 'balance', weightUnit: 'BTC' }).success).toBe(false)
    expect(physicalItemInputSchema.safeParse({ ...base, asset: 'platinum', form: 'bar', weightUnit: 'kg' }).success).toBe(true)
    expect(physicalItemInputSchema.safeParse({ ...base, asset: 'rhodium', form: 'bar', weightUnit: 'kg' }).success).toBe(false)
  })

  it('measures exposure in each asset price unit', () => {
    for (const a of ASSETS) expect(exposureUnitOf(a)).toBe(UNIVERSE[a].priceUnit)
    expect(exposureUnitOf(null)).toBeNull()
  })
})

describe('benchmarks from the universe', () => {
  it('lists each benchmark ETF and reference series, then the blend', () => {
    const ids = BENCHMARKS.map((b) => b.id)
    for (const a of ASSETS) {
      expect(ids).toContain(UNIVERSE[a].benchmarkEtf)
      expect(ids).toContain(UNIVERSE[a].spot)
    }
    expect(ids.at(-1)).toBe('blend')
    expect(DEFAULT_BENCHMARK).toBe(UNIVERSE[ASSETS[0]].benchmarkEtf)
  })

  it('keeps the default blend at the precious sleeve (70/30 gold/silver ETFs)', () => {
    expect(DEFAULT_PORTFOLIO_SETTINGS.blend).toEqual([
      { symbol: UNIVERSE.gold.benchmarkEtf, weight: 0.7 },
      { symbol: UNIVERSE.silver.benchmarkEtf, weight: 0.3 },
    ])
  })

  it('picks the dominant asset by absolute notional', () => {
    expect(dominantAsset([{ asset: 'gold', notional: 10 }, { asset: 'silver', notional: -50 }])).toBe('silver')
    expect(dominantAsset([])).toBe(ASSETS[0])
  })
})

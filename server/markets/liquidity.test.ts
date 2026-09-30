import { describe, expect, it } from 'vitest'
import { UNIVERSE } from '../../shared/universe'
import { LIQUIDITY_INSTRUMENTS, liquidityInstruments } from '../data/liquidity-instruments'
import { detectSpikes, dollarVolume, modeledSplit } from './liquidity'

const day = (i: number) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)

describe('detectSpikes', () => {
  it('keeps the strongest bar of a multi-day episode and returns spikes in date order', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({ date: day(i), total: 100 }))
    history[10].total = 400
    history[11].total = 500 // same episode as day 10
    history[40].total = 450
    const spikes = detectSpikes(history)
    expect(spikes.map((s) => s.date)).toEqual([day(11), day(40)])
    expect(spikes[0].z).toBeGreaterThan(1.2)
  })

  it('needs enough history and variance', () => {
    expect(detectSpikes([{ date: day(0), total: 1 }])).toEqual([])
    expect(detectSpikes(Array.from({ length: 20 }, (_, i) => ({ date: day(i), total: 5 })))).toEqual([])
  })
})

describe('modeledSplit', () => {
  it('is gold-only, flagged modeled, and shares sum to 1', () => {
    expect(modeledSplit('silver')).toBeNull()
    const s = modeledSplit('gold')!
    expect(s.provenance.modeled).toBe(true)
    expect(s.sources.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10)
    expect(s.regions.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10)
  })
})

describe('liquidity instruments from the universe', () => {
  it('reproduces the former hand-kept gold and silver sets', () => {
    expect(LIQUIDITY_INSTRUMENTS.gold).toEqual([
      { symbol: 'GC=F', name: 'COMEX Gold Futures (front)', kind: 'future', pointValue: 100 },
      { symbol: 'GLD', name: 'SPDR Gold Shares', kind: 'etf' },
      { symbol: 'IAU', name: 'iShares Gold Trust', kind: 'etf' },
      { symbol: 'GLDM', name: 'SPDR Gold MiniShares', kind: 'etf' },
      { symbol: 'SGOL', name: 'abrdn Physical Gold Shares', kind: 'etf' },
      { symbol: 'PHYS', name: 'Sprott Physical Gold Trust', kind: 'etf' },
    ])
    expect(LIQUIDITY_INSTRUMENTS.silver[0]).toEqual({ symbol: 'SI=F', name: 'COMEX Silver Futures (front)', kind: 'future', pointValue: 5000, historyReliable: false })
    expect(LIQUIDITY_INSTRUMENTS.silver.map((d) => d.symbol)).toEqual(['SI=F', 'SLV', 'SIVR', 'PSLV'])
  })

  it('handles an asset without futures (ETFs only) and unknown ETF names', () => {
    const defs = liquidityInstruments({ ...UNIVERSE.gold, futures: [], etfs: ['IBIT'] })
    expect(defs).toEqual([{ symbol: 'IBIT', name: 'IBIT', kind: 'etf' }])
  })

  it('values futures volume with the point value, never a hardcoded ounce count', () => {
    const [fut] = LIQUIDITY_INSTRUMENTS.silver
    expect(dollarVolume(fut, 2, 30)).toBe(2 * 5000 * 30)
    expect(dollarVolume({ symbol: 'X', name: 'X', kind: 'future', pointValue: 25_000 }, 1, 4.5)).toBe(112_500)
    expect(dollarVolume({ symbol: 'GLD', name: 'GLD', kind: 'etf' }, 10, 250)).toBe(2500)
  })
})

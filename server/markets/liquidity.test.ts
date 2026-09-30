import { describe, expect, it } from 'vitest'
import { detectSpikes, modeledSplit } from './liquidity'

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

import { describe, expect, it } from 'vitest'
import { ARTIFACTS, upgradeArtifact, type MlPredictionsLite, type PortfolioSummaryLite, type QuantSnapshotLite } from './artifacts'

describe('upgradeArtifact (one-release shim for pre-cleanup artifacts)', () => {
  it('renames portfolio byMetal[].metal to byAsset[].asset', () => {
    const old = { asOf: '2026-09-30', nav: 1, byMetal: [{ metal: 'gold', value: 1, weight: 1 }] }
    const up = upgradeArtifact(ARTIFACTS.portfolioSummary, old as unknown as PortfolioSummaryLite)
    expect(up.byAsset).toEqual([{ asset: 'gold', value: 1, weight: 1 }])
    expect('byMetal' in up).toBe(false)
  })

  it('renames metal on quant opportunities and basis rows, and on ML predictions', () => {
    const q = upgradeArtifact(ARTIFACTS.quantSnapshot, {
      asOf: 'x',
      dataThrough: null,
      opportunities: [{ id: 'GC.fly.0-1-2', metal: 'gold' }],
      basis: [{ id: 'BTC.basis', metal: 'btc' }],
    } as unknown as QuantSnapshotLite)
    expect(q.opportunities[0].asset).toBe('gold')
    expect(q.basis![0].asset).toBe('btc')
    const m = upgradeArtifact(ARTIFACTS.mlPredictions, { asOf: 'x', modelRunId: 1, predictions: [{ instrumentId: 'GC.out', metal: 'gold' }] } as unknown as MlPredictionsLite)
    expect(m.predictions[0].asset).toBe('gold')
    expect('metal' in m.predictions[0]).toBe(false)
  })

  it('renames the macro byMetal map and leaves current payloads untouched', () => {
    const mac = upgradeArtifact(ARTIFACTS.macroDashboard, { asOf: 'x', regime: 'r', drivers: [], byMetal: { gold: { regime: 'r' } } })
    expect(mac).toEqual({ asOf: 'x', regime: 'r', drivers: [], byAsset: { gold: { regime: 'r' } } })
    const cur = { asOf: 'x', dataThrough: null, opportunities: [{ id: 'a', asset: 'gold' }] }
    expect(upgradeArtifact(ARTIFACTS.quantSnapshot, cur)).toEqual(cur)
  })
})

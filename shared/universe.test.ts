import { describe, expect, it } from 'vitest'
import { ASSETS, UNIVERSE, assetOfSymbol, futuresRoots, isAssetId, parseAssetId, physicalAssets, yahooContractSymbol } from './universe'

describe('universe', () => {
  it('matches symbols exactly, never by prefix', () => {
    expect(assetOfSymbol('GC=F')).toBe('gold')
    expect(assetOfSymbol('GCZ26.CMX')).toBe('gold')
    expect(assetOfSymbol('GCZ26')).toBe('gold')
    expect(assetOfSymbol('MGCZ26.CMX')).toBe('gold')
    expect(assetOfSymbol('SILU26.CMX')).toBe('silver')
    expect(assetOfSymbol('SIVR')).toBe('silver')
    expect(assetOfSymbol('SILJ')).toBe('silver')
    // Tickers that merely share a prefix with a root are not assets.
    expect(assetOfSymbol('GCO')).toBeUndefined()
    expect(assetOfSymbol('SIG')).toBeUndefined()
    expect(assetOfSymbol('SPY')).toBeUndefined()
  })

  it('builds exchange-specific Yahoo contract symbols', () => {
    expect(yahooContractSymbol('GC', 12, 2026)).toBe('GCZ26.CMX')
    expect(yahooContractSymbol('SI', 3, 2027)).toBe('SIH27.CMX')
  })

  it('keeps every spec internally consistent', () => {
    for (const a of ASSETS) {
      const s = UNIVERSE[a]
      expect(s.id).toBe(a)
      expect(s.metal).toBe(a)
      expect(s.cotMarket).toBe(s.cot?.market)
      for (const f of s.futures) {
        expect(f.pointValue).toBeGreaterThan(0)
        expect(f.contractSize).toBeGreaterThan(0)
        // $/unit quotes: a 1.00 move is worth contractSize dollars.
        expect(f.pointValue).toBe(f.contractSize)
        expect(f.activeMonths.every((m) => m >= 1 && m <= 12)).toBe(true)
      }
    }
    expect(new Set(futuresRoots()).size).toBe(futuresRoots().length)
  })

  it('parses untrusted asset ids with a fallback', () => {
    expect(isAssetId('silver')).toBe(true)
    expect(isAssetId('bitcoin?')).toBe(false)
    expect(parseAssetId('nope')).toBe('gold')
    expect(parseAssetId('silver')).toBe('silver')
    expect(physicalAssets()).toEqual(ASSETS.filter((a) => UNIVERSE[a].physical != null))
    expect(physicalAssets()).toEqual(expect.arrayContaining(['gold', 'silver']))
  })
})

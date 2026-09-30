import { describe, expect, it } from 'vitest'
import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE } from '@shared/universe'
import { defaultTickerKeys, parseTickerConfig, serializeTickerConfig, tickerCatalog, tickerItems, tickerSymbols, toggleTickerKey } from './tickerConfig'

describe('ticker strip config', () => {
  it('defaults to every asset then every relative-value ratio', () => {
    expect(defaultTickerKeys()).toEqual([...ASSETS.map((a) => `asset:${a}`), ...RELATIVE_VALUE_PAIRS.map((p) => `pair:${p.id}`)])
    expect(defaultTickerKeys().slice(0, 2)).toEqual(['asset:gold', 'asset:silver'])
    expect(defaultTickerKeys()).toContain('pair:GS')
  })

  it('labels assets by their short label and ratios as num/den', () => {
    const byKey = new Map(tickerCatalog().map((i) => [i.key, i]))
    expect(byKey.get('asset:gold')?.label).toBe(UNIVERSE.gold.short)
    expect(byKey.get('pair:GS')?.label).toBe('Au/Ag')
  })

  it('falls back to the default for missing or malformed storage', () => {
    for (const raw of [null, undefined, '', 'not json', '{"a":1}', '42', '"asset:gold"']) {
      expect(parseTickerConfig(raw)).toEqual(defaultTickerKeys())
    }
  })

  it('drops unknown and duplicate keys, keeps a valid empty selection', () => {
    expect(parseTickerConfig('["asset:gold","asset:unobtainium","asset:gold",7,"pair:GS"]')).toEqual(['asset:gold', 'pair:GS'])
    expect(parseTickerConfig('[]')).toEqual([])
    // Only unknown keys (e.g. an asset removed from the universe): default rather than a silently empty strip.
    expect(parseTickerConfig('["asset:unobtainium"]')).toEqual(defaultTickerKeys())
  })

  it('round-trips through serialization and toggles in catalog order', () => {
    const keys = toggleTickerKey(toggleTickerKey(defaultTickerKeys(), 'asset:gold'), 'asset:gold')
    expect(keys).toEqual(defaultTickerKeys())
    const noGold = toggleTickerKey(defaultTickerKeys(), 'asset:gold')
    expect(noGold).not.toContain('asset:gold')
    expect(parseTickerConfig(serializeTickerConfig(noGold))).toEqual(noGold)
  })

  it('quotes displaySpot ?? spot per asset and both spots per ratio', () => {
    const symbols = tickerSymbols(tickerItems(defaultTickerKeys()))
    for (const a of ASSETS) expect(symbols).toContain(UNIVERSE[a].displaySpot ?? UNIVERSE[a].spot)
    expect(tickerSymbols(tickerItems(['pair:GS']))).toEqual([UNIVERSE.gold.spot, UNIVERSE.silver.spot])
  })
})

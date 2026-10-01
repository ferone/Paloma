import { describe, expect, it } from 'vitest'
import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE } from '@shared/universe'
import {
  allTickerKeys,
  defaultTickerKeys,
  naturalPair,
  parseTickerConfig,
  resolveTicker,
  serializeTickerConfig,
  tickerCatalog,
  tickerItems,
  tickerSymbols,
  toggleTickerKey,
} from './tickerConfig'

describe('ticker strip config', () => {
  it('catalog: every asset then every relative-value ratio', () => {
    expect(allTickerKeys()).toEqual([...ASSETS.map((a) => `asset:${a}`), ...RELATIVE_VALUE_PAIRS.map((p) => `pair:${p.id}`)])
  })

  it('labels assets by their short label and ratios as num/den', () => {
    const byKey = new Map(tickerCatalog().map((i) => [i.key, i]))
    expect(byKey.get('asset:gold')?.label).toBe(UNIVERSE.gold.short)
    expect(byKey.get('pair:GS')?.label).toBe('Au/Ag')
  })

  it('default: focus + gold + BTC (deduped) + the focus asset natural ratio', () => {
    expect(defaultTickerKeys('gold')).toEqual(['asset:gold', 'asset:btc', 'pair:GS'])
    expect(defaultTickerKeys('btc')).toEqual(['asset:btc', 'asset:gold', 'pair:BG'])
    expect(defaultTickerKeys('silver')).toEqual(['asset:silver', 'asset:gold', 'asset:btc', 'pair:GS'])
    expect(defaultTickerKeys('copper')).toEqual(['asset:copper', 'asset:gold', 'asset:btc', 'pair:CG'])
    expect(defaultTickerKeys('palladium')).toEqual(['asset:palladium', 'asset:gold', 'asset:btc', 'pair:DP'])
    expect(naturalPair('platinum').id).toBe('GP')
  })

  it('default mode puts everything else behind the overflow, once', () => {
    const { visible, overflow } = resolveTicker({ mode: 'default' }, 'silver')
    expect(visible.map((i) => i.key)).toEqual(['asset:silver', 'asset:gold', 'asset:btc', 'pair:GS'])
    expect(overflow).toHaveLength(allTickerKeys().length - 4)
    expect(new Set([...visible, ...overflow].map((i) => i.key)).size).toBe(allTickerKeys().length)
    expect(overflow.map((i) => i.key)).not.toContain('asset:silver')
  })

  it('custom mode shows the saved list in full, no overflow', () => {
    expect(resolveTicker({ mode: 'custom', keys: ['pair:GS', 'asset:silver'] }, 'gold')).toEqual({ visible: tickerItems(['asset:silver', 'pair:GS']), overflow: [] })
  })

  it('missing, malformed or the legacy full-catalog default parse to the default mode', () => {
    for (const raw of [null, undefined, '', 'not json', '{"a":1}', '42', '"asset:gold"']) {
      expect(parseTickerConfig(raw)).toEqual({ mode: 'default' })
    }
    // The old strip saved the full catalog after "Reset to default": migrate it to the new default.
    expect(parseTickerConfig(JSON.stringify(allTickerKeys()))).toEqual({ mode: 'default' })
  })

  it('keeps a saved custom selection; drops unknown and duplicate keys; empty is valid', () => {
    expect(parseTickerConfig('["asset:gold","asset:unobtainium","asset:gold",7,"pair:GS"]')).toEqual({ mode: 'custom', keys: ['asset:gold', 'pair:GS'] })
    // A legacy list missing one item is a real customization.
    const legacy = allTickerKeys().filter((k) => k !== 'pair:GS')
    expect(parseTickerConfig(JSON.stringify(legacy))).toEqual({ mode: 'custom', keys: legacy })
    expect(parseTickerConfig('[]')).toEqual({ mode: 'custom', keys: [] })
    expect(parseTickerConfig('["asset:unobtainium"]')).toEqual({ mode: 'default' })
  })

  it('round-trips; toggling starts from what is shown and yields a custom list in catalog order', () => {
    expect(serializeTickerConfig({ mode: 'default' })).toBeNull()
    const noBtc = toggleTickerKey({ mode: 'default' }, 'gold', 'asset:btc')
    expect(noBtc).toEqual({ mode: 'custom', keys: ['asset:gold', 'pair:GS'] })
    const plusSilver = toggleTickerKey(noBtc, 'gold', 'asset:silver')
    expect(plusSilver).toEqual({ mode: 'custom', keys: ['asset:gold', 'asset:silver', 'pair:GS'] })
    expect(parseTickerConfig(serializeTickerConfig(plusSilver))).toEqual(plusSilver)
  })

  it('quotes displaySpot ?? spot per asset and both spots per ratio', () => {
    const symbols = tickerSymbols(tickerItems(allTickerKeys()))
    for (const a of ASSETS) expect(symbols).toContain(UNIVERSE[a].displaySpot ?? UNIVERSE[a].spot)
    expect(tickerSymbols(tickerItems(['pair:GS']))).toEqual([UNIVERSE.gold.spot, UNIVERSE.silver.spot])
  })
})

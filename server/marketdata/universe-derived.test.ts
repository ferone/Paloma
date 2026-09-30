import { describe, expect, it } from 'vitest'
import { ASSETS, MONTH_CODES, UNIVERSE, futuresProduct, futuresRoots, yahooContractSymbol, type AssetSpec, type FuturesProduct } from '../../shared/universe.js'
import { COT_MARKETS, DATABENTO_ROOTS, isDatabentoRoot } from '../../shared/marketdata.js'
import { contractExpiry as quantContractExpiry } from '../quant/universe/contracts.js'
import { contractExpiry, contractRow } from './contracts.js'
import { listedContractMonths, yahooHistorySymbols } from './yahoo.js'

// Adding an asset is a data change: every list the market-data domain pulls
// (Databento roots, Yahoo history symbols, listed contract months, COT markets)
// must come from the universe, with the exchange-specific Yahoo suffix.

const SUFFIX = { COMEX: '.CMX', NYMEX: '.NYM', CME: '.CME' } as const

const btc: AssetSpec = {
  id: 'gold', // any id: only the instrument fields are read
  metal: 'gold',
  label: 'Bitcoin',
  short: 'BTC',
  assetClass: 'crypto',
  spot: 'BTC=F',
  displaySpot: 'BTC-USD',
  priceUnit: 'BTC',
  unitLabel: '$/BTC',
  displayDecimals: 0,
  session: '24x7',
  futures: [
    { root: 'BTC', name: 'CME Bitcoin', exchange: 'CME', yahoo: 'BTC=F', contractSize: 5, pointValue: 5, tickSize: 5, activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], cashSettled: true, ozPerContract: 0 },
  ],
  etfs: ['IBIT', 'FBTC'],
  benchmarkEtf: 'IBIT',
  physical: null,
  cot: { report: 'tff', code: '133741', market: 'BITCOIN' },
  colorVar: '--asset-btc',
  cotMarket: 'BITCOIN',
}

describe('Databento roots and COT markets come from the universe', () => {
  it('DATABENTO_ROOTS equals futuresRoots() in universe order', () => {
    expect([...DATABENTO_ROOTS]).toEqual(futuresRoots())
    for (const r of futuresRoots()) expect(isDatabentoRoot(r)).toBe(true)
    expect(isDatabentoRoot('PLTR')).toBe(false)
  })

  it('keeps the gold and silver roots unchanged', () => {
    expect(DATABENTO_ROOTS.slice(0, 4)).toEqual(['GC', 'MGC', 'SI', 'SIL'])
  })

  it('lists every asset COT market', () => {
    const expected = ASSETS.flatMap((a) => (UNIVERSE[a].cot ? [UNIVERSE[a].cot!.market] : []))
    expect([...COT_MARKETS]).toEqual(expected)
    expect(COT_MARKETS).toContain('GOLD')
    expect(COT_MARKETS).toContain('SILVER')
  })
})

describe('Yahoo history symbols', () => {
  it('include every asset spot, display quote, continuous future, ETF and miner', () => {
    const s = yahooHistorySymbols()
    for (const a of ASSETS) {
      const u = UNIVERSE[a]
      expect(s).toContain(u.spot)
      if (u.displaySpot) expect(s).toContain(u.displaySpot)
      for (const f of u.futures) expect(s).toContain(f.yahoo)
      for (const e of u.etfs) expect(s).toContain(e)
      if (u.miners) expect(s).toContain(u.miners)
    }
    expect(new Set(s).size).toBe(s.length)
  })

  it('keep the gold/silver symbol order stable', () => {
    expect(yahooHistorySymbols([UNIVERSE.gold, UNIVERSE.silver]).slice(0, 8)).toEqual(['GC=F', 'MGC=F', 'GLD', 'IAU', 'GLDM', 'SGOL', 'PHYS', 'GDX'])
  })

  it('pick up a new asset (24/7 display quote, no miners) from its spec alone', () => {
    const s = yahooHistorySymbols([btc])
    expect(s).toEqual(expect.arrayContaining(['BTC=F', 'BTC-USD', 'IBIT', 'FBTC', '^IRX']))
    expect(s.filter((x) => x === 'BTC=F')).toHaveLength(1)
  })
})

describe('listed contract months', () => {
  it('uses each product exchange suffix for the Yahoo symbol', () => {
    const listed = listedContractMonths('2026-10-01', 12)
    expect(listed.length).toBeGreaterThan(0)
    for (const c of listed) {
      const p = futuresProduct(c.root)!
      const expected = `${c.root}${MONTH_CODES[c.month - 1]}${String(c.year).slice(-2)}${SUFFIX[p.exchange]}`
      expect(yahooContractSymbol(c.root, c.month, c.year)).toBe(expected)
    }
    expect(yahooContractSymbol('GC', 12, 2026)).toBe('GCZ26.CMX')
  })

  it('lists every month of a monthly product (e.g. CME bitcoin)', () => {
    const products: FuturesProduct[] = btc.futures
    expect(listedContractMonths('2026-10-01', 2, products)).toEqual([
      { root: 'BTC', month: 10, year: 2026 },
      { root: 'BTC', month: 11, year: 2026 },
      { root: 'BTC', month: 12, year: 2026 },
    ])
  })
})

describe('contract expiry delegates to the quant engine rules', () => {
  it('matches the quant contractExpiry for every universe root', () => {
    for (const root of futuresRoots()) {
      for (const month of [1, 6, 12]) {
        const q = quantContractExpiry(root, month, 2027)
        const e = contractExpiry(root, month, 2027)
        if (!q) expect(e).toEqual({ lastTrade: null, firstNotice: null })
        else expect(e).toEqual({ lastTrade: q.lastTrade, firstNotice: q.cashSettled ? null : q.firstNotice })
      }
    }
  })

  it('keeps the COMEX metals rows identical', () => {
    expect(contractExpiry('GC', 12, 2026)).toEqual({ lastTrade: '2026-12-29', firstNotice: '2026-11-30' })
    expect(contractExpiry('MGC', 2, 2027)).toEqual({ lastTrade: '2027-02-24', firstNotice: '2027-01-29' })
    expect(contractExpiry('SIL', 1, 2027)).toEqual({ lastTrade: '2027-01-27', firstNotice: '2026-12-31' })
    expect(contractRow({ root: 'SI', month: 3, year: 2027, symbol: 'SIH27' })).toEqual({
      symbol: 'SIH27',
      root: 'SI',
      year: 2027,
      month: 3,
      lastTrade: '2027-03-29',
      firstNotice: '2027-02-26',
    })
  })

  it('has no first notice for cash-settled products and null for unknown roots', () => {
    expect(contractExpiry('BTC', 3, 2026)).toEqual({ lastTrade: '2026-03-27', firstNotice: null })
    expect(contractExpiry('ZZZ', 3, 2026)).toEqual({ lastTrade: null, firstNotice: null })
  })
})

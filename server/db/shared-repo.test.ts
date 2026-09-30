import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from './client.js'
import { upsertContracts, listContracts, upsertContractBars, readRootBars, upsertMacro, readMacro, upsertCot, readCot } from './shared-repo.js'

describe('shared market repositories', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('stores contracts and reads root bars in contract order', () => {
    upsertContracts([
      { symbol: 'GCG27', root: 'GC', year: 2027, month: 2, lastTrade: '2027-02-24', firstNotice: '2027-01-29' },
      { symbol: 'GCZ26', root: 'GC', year: 2026, month: 12, lastTrade: '2026-12-29', firstNotice: '2026-11-30' },
    ])
    expect(listContracts('GC').map((c) => c.symbol)).toEqual(['GCZ26', 'GCG27'])
    const bar = { open: null, high: null, low: null, volume: 10, openInterest: null, source: 'databento' }
    upsertContractBars([
      { ...bar, symbol: 'GCG27', date: '2026-09-29', close: 4210 },
      { ...bar, symbol: 'GCZ26', date: '2026-09-29', close: 4180 },
    ])
    // A later bar without volume must not erase the stored volume.
    upsertContractBars([{ ...bar, symbol: 'GCZ26', date: '2026-09-29', close: 4181, volume: null }])
    const rows = readRootBars('GC')
    expect(rows.map((r) => r.symbol)).toEqual(['GCZ26', 'GCG27'])
    expect(rows[0]).toMatchObject({ close: 4181, volume: 10 })
  })

  it('round-trips macro series and COT rows', () => {
    upsertMacro([{ seriesId: 'DFII10', date: '2026-09-29', value: 2.1, source: 'fred' }])
    expect(readMacro('DFII10')[0].value).toBe(2.1)
    const nulls = { publishedAt: null, prodLong: null, prodShort: null, swapLong: null, swapShort: null, otherLong: null, otherShort: null, nonrepLong: null, nonrepShort: null }
    upsertCot([{ ...nulls, market: 'GOLD', reportDate: '2026-09-22', openInterest: 500000, mmLong: 200000, mmShort: 50000 }])
    expect(readCot('GOLD')[0]).toMatchObject({ mmLong: 200000, mmShort: 50000 })
  })
})

import { describe, expect, it } from 'vitest'
import type { ContractBar, ContractRow } from '../db/shared-repo.js'
import { pickFronts } from './continuous.js'

const c = (symbol: string, year: number, month: number, firstNotice: string): ContractRow => ({ symbol, root: 'GC', year, month, lastTrade: null, firstNotice })
const contracts = [c('GCV26', 2026, 10, '2026-09-30'), c('GCZ26', 2026, 12, '2026-11-30'), c('GCG27', 2027, 2, '2027-01-29')]
const bar = (symbol: string, date: string, openInterest: number | null, volume: number): ContractBar => ({
  symbol,
  date,
  open: null,
  high: null,
  low: null,
  close: 1,
  volume,
  openInterest,
  source: 'databento',
})

describe('front-month selection', () => {
  it('follows open interest, not the nearest listed month', () => {
    const f = pickFronts([bar('GCV26', '2026-09-24', 28000, 4000), bar('GCZ26', '2026-09-24', 317000, 140000)], contracts)
    expect(f.map((b) => b.symbol)).toEqual(['GCZ26'])
  })
  it('falls back to volume when OI is not yet published', () => {
    const f = pickFronts([bar('GCV26', '2026-09-29', null, 2000), bar('GCZ26', '2026-09-29', null, 136000)], contracts)
    expect(f[0].symbol).toBe('GCZ26')
  })
  it('never rolls back to an earlier month and drops contracts at first notice', () => {
    const f = pickFronts(
      [
        bar('GCZ26', '2026-11-25', 200000, 1),
        bar('GCG27', '2026-11-25', 250000, 1),
        bar('GCZ26', '2026-11-26', 260000, 1), // Z regains OI but the series already rolled
        bar('GCG27', '2026-11-26', 240000, 1),
        bar('GCZ26', '2026-11-30', 999999, 1), // first-notice day: Z no longer eligible
        bar('GCG27', '2026-11-30', 1, 1),
      ],
      contracts,
    )
    expect(f.map((b) => `${b.date}:${b.symbol}`)).toEqual(['2026-11-25:GCG27', '2026-11-26:GCG27', '2026-11-30:GCG27'])
  })
})

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { DATABENTO_ROOTS } from '../../shared/marketdata.js'
import { useTestDb } from '../db/client.js'
import { upsertContractBars, upsertContracts } from '../db/shared-repo.js'
import { contractRow } from './contracts.js'
import { DatabentoClient } from './databento/client.js'
import { incrementalRequests } from './databento/ingest.js'
import { INCREMENTAL_CAP, runIncremental } from './jobs.js'
import { incrementalResumeDate, oiCoverage, openInterestCoverage } from './open-interest.js'
import { databentoSpend } from './repo.js'

const noCtx = { progress() {}, log() {} }

describe('open-interest coverage (pure)', () => {
  it('reports nothing for a root without open interest', () => {
    expect(oiCoverage('SI', [], '2026-09-30')).toEqual({ root: 'SI', since: null, last: null, days: 0, current: false, earlierSample: null })
  })

  it('a lone historical sample is "only, not current", never "since 2010"', () => {
    const c = oiCoverage('GC', ['2010-06-07', '2010-06-14', '2010-06-21', '2010-06-28', '2010-07-02'], '2026-09-30')
    expect(c).toMatchObject({ since: '2010-06-07', last: '2010-07-02', days: 5, current: false, earlierSample: null })
  })

  it('collection going forward starts a new run; the old sample is reported apart', () => {
    const c = oiCoverage('GC', ['2010-06-07', '2010-07-02', '2026-09-28', '2026-09-29', '2026-09-30'], '2026-09-30')
    expect(c).toMatchObject({ since: '2026-09-28', last: '2026-09-30', days: 3, current: true, earlierSample: { from: '2010-06-07', to: '2010-07-02' } })
  })

  it('a weekend or holiday is not a gap', () => {
    expect(oiCoverage('GC', ['2026-09-18', '2026-09-21', '2026-09-28'], '2026-09-29')).toMatchObject({ since: '2026-09-18', days: 3, current: true })
  })

  it('the incremental resume date closes a recent OI gap but never reaches back to an old sample', () => {
    expect(incrementalResumeDate('2026-09-30', null)).toBe('2026-09-30')
    expect(incrementalResumeDate('2026-09-30', '2026-09-30')).toBe('2026-09-30')
    expect(incrementalResumeDate('2026-09-30', '2026-09-22')).toBe('2026-09-22')
    expect(incrementalResumeDate('2026-09-30', '2010-07-02')).toBe('2026-09-30')
    expect(incrementalResumeDate(null, '2026-09-22')).toBeNull()
  })
})

function seed(root: string, month: number, dates: { date: string; oi: number | null }[]) {
  const c = contractRow({ root, month, year: 2026, symbol: `${root}${'FGHJKMNQUVXZ'[month - 1]}26` })
  upsertContracts([c])
  upsertContractBars(dates.map((d) => ({ symbol: c.symbol, date: d.date, open: 1, high: 1, low: 1, close: 1, volume: 1, openInterest: d.oi, source: 'databento' })))
}

describe('open-interest coverage (DB) and the incremental plan', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('reads coverage per root from contract_bars', () => {
    seed('GC', 12, [
      { date: '2010-06-07', oi: 100 },
      { date: '2026-09-29', oi: null },
      { date: '2026-09-30', oi: 200 },
    ])
    const cov = openInterestCoverage(['GC', 'SI'])
    expect(cov[0]).toMatchObject({ root: 'GC', since: '2026-09-30', current: true, earlierSample: { from: '2010-06-07', to: '2010-06-07' } })
    expect(cov[1]).toMatchObject({ root: 'SI', since: null })
  })

  it('resumes from a recent OI gap, else from the latest bar', () => {
    seed('GC', 12, [
      { date: '2026-09-21', oi: 5 },
      { date: '2026-09-30', oi: null },
    ])
    seed('SI', 12, [
      { date: '2010-06-07', oi: 5 },
      { date: '2026-09-30', oi: null },
    ])
    const plan = Object.fromEntries(incrementalRequests(['GC', 'SI'], '2026-10-01').map((r) => [r.root, r.start]))
    expect(plan.GC).toBe('2026-09-19') // Saturday on/before the last OI date
    expect(plan.SI).toBe('2026-09-26') // Saturday on/before the last bar; the 2010 sample is ignored
  })
})

/** Fake Databento: fixed cost per get_cost call, fixture bodies for get_range. */
function fakeClient(costPerCall: number) {
  const ranges: { root: string; schema: string }[] = []
  const fixture = (name: string) => readFileSync(new URL(`./databento/__fixtures__/${name}`, import.meta.url), 'utf8')
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/v0/', '')
    if (path === 'metadata.get_dataset_range') return new Response(JSON.stringify({ start: '2010-06-06T00:00:00Z', end: '2026-09-30T08:07:05Z' }))
    if (path === 'metadata.get_cost') return new Response(String(costPerCall))
    if (path === 'timeseries.get_range') {
      const schema = url.searchParams.get('schema')!
      ranges.push({ root: url.searchParams.get('symbols')!.replace('.FUT', ''), schema })
      return new Response(fixture(schema === 'statistics' ? 'sil-statistics.jsonl' : 'sil-ohlcv-1d.jsonl'))
    }
    if (path === 'symbology.resolve') return new Response(JSON.stringify({ result: {} }))
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { client: new DatabentoClient({ apiKey: 'test', fetchImpl, backoffMs: 1 }), ranges }
}

describe('daily Databento incremental job', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('is a no-op without a key', async () => {
    expect(await runIncremental(noCtx, {}, { client: null, budget: 5 })).toMatch(/^Skipped: Databento is not configured/)
  })

  it('pulls bars AND open interest (statistics) for every universe root', async () => {
    const { client, ranges } = fakeClient(0.0001)
    await runIncremental(noCtx, {}, { client, budget: 5, today: '2026-09-30' })
    for (const root of DATABENTO_ROOTS) {
      expect(ranges.filter((r) => r.root === root).map((r) => r.schema)).toContain('statistics')
      expect(ranges.filter((r) => r.root === root).map((r) => r.schema)).toContain('ohlcv-1d')
    }
  })

  it('shares one cap across roots: what does not fit is skipped, total spend never passes the cap', async () => {
    const { client } = fakeClient(0.3)
    const out = await runIncremental(noCtx, {}, { client, budget: 5, today: '2026-09-30' })
    expect(databentoSpend().totalUsd).toBeLessThanOrEqual(INCREMENTAL_CAP + 1e-9)
    expect(databentoSpend().totalUsd).toBeGreaterThan(0)
    expect(out).toMatch(/skipped, \$0\.6000 is over the \$0\.\d+ left/)
  })

  it('a budget below the cap is the cap', async () => {
    const { client, ranges } = fakeClient(0.3)
    const out = await runIncremental(noCtx, {}, { client, budget: 0.5, today: '2026-09-30' })
    expect(ranges).toHaveLength(0)
    expect(out.match(/skipped/g)).toHaveLength(DATABENTO_ROOTS.length)
  })
})

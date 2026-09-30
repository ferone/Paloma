import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../../db/client.js'
import { readDailyBars } from '../../db/repo.js'
import { listContracts, readContractBars } from '../../db/shared-repo.js'
import { DatabentoClient } from './client.js'
import { OverBudgetError, assertWithinBudget, clampRange, costLimit, estimate } from './cost.js'
import { ingestDatabento, monthlyWindows, resumeStart, saturdayOnOrBefore } from './ingest.js'
import { databentoSpend } from '../repo.js'
import type { CostEstimate } from '../../../shared/marketdata.js'

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

interface Call {
  path: string
  params: URLSearchParams
}

/** Fake Databento: fixed cost per get_cost call, fixture bodies for get_range. */
function fakeClient(opts: { costPerCall: number; status?: number[] }) {
  const calls: Call[] = []
  const statuses = [...(opts.status ?? [])]
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/v0/', '')
    calls.push({ path, params: url.searchParams })
    const status = statuses.shift() ?? 200
    if (status !== 200) return new Response('throttled', { status })
    if (path === 'metadata.get_dataset_range') return new Response(JSON.stringify({ start: '2010-06-06T00:00:00Z', end: '2026-09-30T08:07:05Z' }))
    if (path === 'metadata.get_cost') return new Response(String(opts.costPerCall))
    if (path === 'timeseries.get_range') {
      const schema = url.searchParams.get('schema')
      return new Response(fixture(schema === 'statistics' ? 'sil-statistics.jsonl' : 'sil-ohlcv-1d.jsonl'))
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { client: new DatabentoClient({ apiKey: 'test', fetchImpl, backoffMs: 1 }), calls }
}

const est = (total: number, budget: number): CostEstimate => ({ dataset: 'GLBX.MDP3', start: '2026-09-01', end: '2026-09-10', lines: [], total, budget, withinBudget: total <= budget })

describe('cost guard', () => {
  it('allows within budget and refuses above it without an override', () => {
    expect(() => assertWithinBudget(est(4.99, 5))).not.toThrow()
    expect(() => assertWithinBudget(est(5.01, 5))).toThrow(OverBudgetError)
  })
  it('an explicit maxCost can raise the cap, but never below the cost', () => {
    expect(() => assertWithinBudget(est(7, 5), 8)).not.toThrow()
    expect(() => assertWithinBudget(est(7, 5), 6.99)).toThrow(OverBudgetError)
    // maxCost also tightens: a request under budget but over its own cap is refused.
    expect(() => assertWithinBudget(est(1, 5), 0.5)).toThrow(/maxCost/)
    expect(costLimit(5, undefined)).toBe(5)
    expect(costLimit(5, null)).toBe(5)
  })
  it('NaN or negative costs never pass', () => {
    expect(() => assertWithinBudget(est(Number.NaN, 5))).toThrow(OverBudgetError)
  })
  it('clamps ranges to the licensed window', () => {
    expect(clampRange('2005-01-01', undefined, '2026-09-30T08:00:00Z')).toEqual({ start: '2010-06-06', end: '2026-09-30' })
    expect(clampRange('2026-09-01', '2030-01-01', '2026-09-30T08:00:00Z').end).toBe('2026-09-30')
    expect(() => clampRange('2026-10-05', undefined, '2026-09-30')).toThrow(/Empty range/)
    expect(() => clampRange('2026/01/01', undefined, '2026-09-30')).toThrow(/Invalid/)
  })
  it('estimates per root and schema via the free endpoint only', async () => {
    const { client, calls } = fakeClient({ costPerCall: 0.25 })
    const e = await estimate(client, { roots: ['GC', 'SI'], start: '2026-01-01', schemas: ['ohlcv-1d', 'statistics'] }, 10)
    expect(e.lines).toHaveLength(4)
    expect(e.total).toBe(1)
    expect(e.withinBudget).toBe(true)
    expect(calls.every((c) => c.path.startsWith('metadata.'))).toBe(true)
    const gc = calls.find((c) => c.path === 'metadata.get_cost')!
    expect(gc.params.get('symbols')).toBe('GC.FUT')
    expect(gc.params.get('stype_in')).toBe('parent')
  })
})

describe('windows', () => {
  it('splits into ~monthly windows ending on Saturdays', () => {
    const w = monthlyWindows('2026-01-01', '2026-04-15')
    expect(w[0]).toEqual({ start: '2026-01-01', end: '2026-02-07' })
    for (const x of w.slice(0, -1)) expect(new Date(`${x.end}T00:00:00Z`).getUTCDay()).toBe(6)
    expect(w.at(-1)!.end).toBe('2026-04-15')
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end)
  })
  it('resumes from the Saturday on/before the latest stored date', () => {
    expect(saturdayOnOrBefore('2026-09-08')).toBe('2026-09-05')
    expect(saturdayOnOrBefore('2026-09-05')).toBe('2026-09-05')
    expect(resumeStart('2026-09-11', '2026-09-30')).toBe('2026-09-05')
    expect(resumeStart(null, '2026-09-30')).toBe('2026-08-31')
  })
})

describe('ingestDatabento (fixture payloads, in-memory DB)', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('refuses before downloading anything when the estimate is over budget', async () => {
    const { client, calls } = fakeClient({ costPerCall: 3 })
    await expect(
      ingestDatabento({ roots: ['SIL'], start: '2026-09-04', end: '2026-09-09', schemas: ['ohlcv-1d', 'statistics'] }, { client, budget: 5 }),
    ).rejects.toThrow(OverBudgetError)
    expect(calls.some((c) => c.path === 'timeseries.get_range')).toBe(false)
  })

  it('writes contracts, outright bars with OI and the front-month series; records spend', async () => {
    const { client, calls } = fakeClient({ costPerCall: 0.0004 })
    const r = await ingestDatabento({ roots: ['SIL'], start: '2026-09-04', end: '2026-09-09', schemas: ['statistics', 'ohlcv-1d'] }, { client, budget: 5 })
    // ohlcv is pulled before statistics regardless of request order
    const ranges = calls.filter((c) => c.path === 'timeseries.get_range').map((c) => c.params.get('schema'))
    expect(ranges).toEqual(['ohlcv-1d', 'statistics'])
    expect(calls.find((c) => c.path === 'timeseries.get_range')!.params.get('map_symbols')).toBe('true')

    expect(listContracts('SIL').map((c) => c.symbol)).toEqual(['SILU26', 'SILZ26'])
    expect(listContracts('SIL')[1]).toMatchObject({ lastTrade: '2026-12-29', firstNotice: '2026-11-30' })
    const z = readContractBars('SILZ26')
    expect(z.map((b) => b.date)).toEqual(['2026-09-04', '2026-09-07', '2026-09-08'])
    expect(z[0]).toMatchObject({ close: 66.81, volume: 48147, openInterest: 11670, source: 'databento' })
    expect(z[1]).toMatchObject({ open: 66.8, volume: 32199, openInterest: 11670 })
    expect(r.skippedSpreads).toBeGreaterThan(0)

    // Front month: SILU26's first notice (2026-08-31) has passed → SILZ26 is front.
    const front = readDailyBars('SIL.c.0', { source: 'databento' })
    expect(front.map((b) => [b.date, b.close])).toEqual([
      ['2026-09-04', 66.81],
      ['2026-09-07', 67.195],
      ['2026-09-08', 66.2],
    ])
    expect(r.spent).toBeCloseTo(0.0008, 6)
    expect(databentoSpend()).toMatchObject({ pulls: 2, totalUsd: 0.0008 })
  })

  it('retries throttled requests with backoff', async () => {
    const { client, calls } = fakeClient({ costPerCall: 0.1, status: [429, 503] })
    const e = await estimate(client, { roots: ['GC'], start: '2026-09-01', schemas: ['ohlcv-1d'] }, 5)
    expect(e.total).toBe(0.1)
    expect(calls.length).toBe(4) // 2 failures + dataset range + cost
  })

  it('fails fast on client errors', async () => {
    const { client } = fakeClient({ costPerCall: 0.1, status: [401] })
    await expect(client.getCost({ symbols: ['GC.FUT'], stypeIn: 'parent', schema: 'ohlcv-1d', start: '2026-09-01', end: '2026-09-02' })).rejects.toThrow(/401/)
  })
})

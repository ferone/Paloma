import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, useTestDb } from '../db/client.js'
import { startJob, upsertDailyBars } from '../db/repo.js'
import { upsertContractBars, upsertContracts, upsertCot } from '../db/shared-repo.js'
import { freshness } from './freshness.js'
import { upsertYahooContractBars } from './repo.js'
import { cleanYahooBars, listedContractMonths, rangeFor, yahooHistorySymbols } from './yahoo.js'

describe('freshness', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('reports every known dataset even when empty, and missing generic tables', () => {
    const f = freshness('2026-10-01')
    const byDataset = new Map(f.rows.map((r) => [r.dataset, r]))
    expect(byDataset.get('prices_daily')).toMatchObject({ exists: true, rows: 0, stale: false })
    expect(byDataset.get('cot_reports')).toMatchObject({ exists: true, rows: 0 })
    // Generic tables belong to other domains; exists must mirror the actual schema.
    const tables = new Set((getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
    for (const name of ['pf_transactions', 'ml_runs']) {
      expect(byDataset.get(name)?.exists).toBe(tables.has(name))
    }
  })

  it('groups by source with counts, coverage, staleness and the last successful job', () => {
    upsertDailyBars([
      { symbol: 'GC=F', date: '2026-09-29', close: 1, source: 'yahoo' },
      { symbol: 'GLD', date: '2026-09-30', close: 1, source: 'yahoo' },
      { symbol: 'GC.c.0', date: '2026-09-18', close: 1, source: 'databento' },
    ])
    startJob('marketdata.yahoo').succeed('ok')
    startJob('marketdata.yahoo').fail('boom')
    const nulls = { publishedAt: null, openInterest: null, prodLong: null, prodShort: null, swapLong: null, swapShort: null, mmLong: null, mmShort: null, otherLong: null, otherShort: null, nonrepLong: null, nonrepShort: null }
    upsertCot([{ ...nulls, market: 'GOLD', reportDate: '2026-09-22' }])

    const rows = freshness('2026-10-01').rows
    const yahoo = rows.find((r) => r.dataset === 'prices_daily' && r.source === 'yahoo')!
    expect(yahoo).toMatchObject({ rows: 2, symbols: 2, from: '2026-09-29', to: '2026-09-30', ageDays: 1, stale: false })
    expect(yahoo.lastJob?.name).toBe('marketdata.yahoo')
    const db = rows.find((r) => r.dataset === 'prices_daily' && r.source === 'databento')!
    expect(db).toMatchObject({ ageDays: 13, stale: true, lastJob: null })
    expect(rows.find((r) => r.dataset === 'cot_reports')).toMatchObject({ rows: 1, ageDays: 9, stale: false })
  })

  it('reports generic tables once another domain creates them', () => {
    const d = useTestDb()
    d.exec('CREATE TABLE pf_nav_snapshots (date TEXT, nav REAL)')
    d.exec(`INSERT INTO pf_nav_snapshots VALUES ('2026-09-01', 1), ('2026-09-30', 2)`)
    expect(freshness('2026-10-01').rows.find((r) => r.dataset === 'pf_nav_snapshots')).toMatchObject({ exists: true, rows: 2, from: '2026-09-01', to: '2026-09-30' })
  })
})

describe('yahoo ingestion helpers', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('covers futures fronts, ETFs, miners and macro references', () => {
    const s = yahooHistorySymbols()
    for (const x of ['GC=F', 'SI=F', 'MGC=F', 'SIL=F', 'GLD', 'SLV', 'PSLV', 'GDX', 'SILJ', 'DX-Y.NYB', '^TNX', '^VIX', 'SPY', 'TIP', '^IRX']) {
      expect(s).toContain(x)
    }
  })

  it('picks the smallest covering range', () => {
    expect(rangeFor(null, '2026-10-01')).toBe('ALL')
    expect(rangeFor('2026-09-28', '2026-10-01')).toBe('1M')
    expect(rangeFor('2026-06-01', '2026-10-01')).toBe('6M')
    expect(rangeFor('2019-01-01', '2026-10-01')).toBe('ALL')
  })

  it('drops zero/null closes and dedupes dates', () => {
    const b = { open: 1, high: 1, low: 1, volume: 0 }
    expect(
      cleanYahooBars([
        { ...b, date: '2026-09-29T04:00:00.000Z', close: 0 },
        { ...b, date: '2026-09-30T04:00:00.000Z', close: 10 },
        { ...b, date: '2026-09-30T20:00:00.000Z', close: 11 },
      ]),
    ).toEqual([{ ...b, date: '2026-09-30', close: 11 }])
  })

  it('strips float32 noise from Yahoo prices', () => {
    const [b] = cleanYahooBars([{ date: '2026-08-25', open: 4710.10009765625, high: 65.7699966430664, low: 0.5, close: 64.8010025024414, volume: 1 }])
    expect(b).toMatchObject({ open: 4710.1, high: 65.77, close: 64.801 })
  })

  it('lists active contract months only', () => {
    const l = listedContractMonths('2026-10-01', 3)
    expect(l.filter((x) => x.root === 'GC')).toEqual([
      { root: 'GC', month: 10, year: 2026 },
      { root: 'GC', month: 12, year: 2026 },
    ])
    expect(l.filter((x) => x.root === 'SI')).toEqual([{ root: 'SI', month: 12, year: 2026 }])
  })

  it('never overwrites Databento contract rows with Yahoo rows', () => {
    upsertContracts([{ symbol: 'GCZ26', root: 'GC', year: 2026, month: 12, lastTrade: null, firstNotice: null }])
    const bar = { open: null, high: null, low: null, volume: 1, openInterest: null }
    upsertContractBars([{ ...bar, symbol: 'GCZ26', date: '2026-09-29', close: 4200, source: 'databento' }])
    const n = upsertYahooContractBars([
      { ...bar, symbol: 'GCZ26', date: '2026-09-29', close: 1, source: 'yahoo' },
      { ...bar, symbol: 'GCZ26', date: '2026-09-30', close: 4210, source: 'yahoo' },
    ])
    expect(n).toBe(1)
    upsertYahooContractBars([{ ...bar, symbol: 'GCZ26', date: '2026-09-30', close: 4211, source: 'yahoo' }])
    const rows = freshness('2026-10-01').rows.filter((r) => r.dataset === 'contract_bars')
    expect(rows.map((r) => [r.source, r.rows])).toEqual([
      ['databento', 1],
      ['yahoo', 1],
    ])
  })
})

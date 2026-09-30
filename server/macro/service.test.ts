import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client.js'
import { readArtifact, upsertDailyBars } from '../db/repo.js'
import { readFileSync } from 'node:fs'
import { readCot, upsertMacro } from '../db/shared-repo.js'
import { ARTIFACTS, type MacroDashboardLite } from '../../shared/artifacts.js'
import type { CorrelationFactor, SeriesPoint } from '../../shared/macro.js'
import { readCotReports, readSpeculator, upsertCotReports } from './cot-repo.js'
import { fromCotRow, parseCotReports, type SocrataCotRow } from './cot.js'
import {
  assetPeers,
  buildDashboard,
  computeCorrelations,
  correlationFactors,
  cotResponse,
  publishMacroArtifact,
  refreshCot,
  snapshot,
} from './service.js'
import { FRED_SERIES } from './catalog.js'

function businessDays(n: number, end = '2026-09-28'): string[] {
  const out: string[] = []
  const d = new Date(`${end}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as SocrataCotRow[]

describe('macro service', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('reports an empty dashboard honestly before any refresh', () => {
    const d = buildDashboard('gold')
    expect(d.empty).toBe(true)
    expect(d.asOf).toBeNull()
    expect(d.regime.label).toBe('Real yields n/a · Dollar n/a · Risk n/a')
    expect(d.scorecard.every((r) => r.stance === 'neutral')).toBe(true)
  })

  it('snapshots levels with changes and provenance', () => {
    const meta = FRED_SERIES.find((s) => s.id === 'DFII10')!
    const days = businessDays(300)
    const pts: SeriesPoint[] = days.map((date, i) => ({ date, value: 2 + i * 0.003 }))
    const s = snapshot(meta, pts)
    expect(s.latest).toBeCloseTo(2 + 299 * 0.003, 9)
    expect(s.change3m).toBeGreaterThan(0.15)
    expect(s.provenance).toEqual({ source: 'FRED DFII10', asOf: '2026-09-28' })
    expect(s.percentile).toBe(1)
  })

  it('builds the scorecard from stored series and COT, and publishes the artifact', () => {
    const days = businessDays(300)
    upsertMacro(days.map((date, i) => ({ seriesId: 'DFII10', date, value: 2.9 - i * 0.004, source: 'fred' })))
    upsertMacro(days.map((date, i) => ({ seriesId: 'DTWEXBGS', date, value: 125 - i * 0.05, source: 'fred' })))
    upsertMacro(days.map((date) => ({ seriesId: 'VIXCLS', date, value: 30, source: 'fred' })))
    upsertCotReports([
      fromCotRow({
        market: 'GOLD',
        reportDate: '2026-09-22',
        publishedAt: '2026-09-25T20:30:00Z',
        openInterest: 412800,
        prodLong: 17719,
        prodShort: 44496,
        swapLong: 14626,
        swapShort: 250752,
        mmLong: 135699,
        mmShort: 8310,
        otherLong: 118283,
        otherShort: 19819,
        nonrepLong: 52437,
        nonrepShort: 15387,
      }),
    ])
    const d = buildDashboard('gold')
    expect(d.empty).toBe(false)
    expect(d.regime.label).toBe('Real yields falling · Dollar weakening · Risk-off')
    expect(d.scorecard.find((r) => r.id === 'DFII10')!.stance).toBe('tailwind')
    expect(d.scorecard.find((r) => r.id === 'COT_MM')!.value).toBeCloseTo(((135699 - 8310) / 412800) * 100, 6)
    expect(d.tailwinds).toBeGreaterThanOrEqual(3)

    publishMacroArtifact()
    const art = readArtifact<MacroDashboardLite & { byMetal: Record<string, { regime: string }> }>(ARTIFACTS.macroDashboard)!
    expect(art.data.regime).toBe(d.regime.label)
    expect(art.data.drivers.find((x) => x.id === 'DFII10')!.stance).toBe('tailwind')
    expect(art.data.byMetal.silver.regime).toContain('Risk-off')
  })

  it('computes correlations on aligned levels', () => {
    const days = businessDays(200)
    // Deterministic pseudo-random walk.
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02
    const gold: SeriesPoint[] = []
    const dxy: SeriesPoint[] = []
    let g = 3000
    let x = 100
    for (const date of days) {
      const e = rnd()
      g *= Math.exp(e)
      x *= Math.exp(-e * 0.5 + rnd() * 0.1)
      gold.push({ date, value: g })
      dxy.push({ date, value: x })
    }
    const noise = (base: number) => days.map((date) => ({ date, value: base * Math.exp(rnd()) }))
    const levels: Record<CorrelationFactor, SeriesPoint[]> = {
      gold,
      silver: gold.map((p) => ({ date: p.date, value: p.value / 80 })),
      realYield: noise(2),
      dxy,
      vix: noise(16),
      spy: noise(500),
    }
    const r = computeCorrelations('gold', 63, levels)
    expect(r.asOf).toBe('2026-09-28')
    expect(r.betas.find((b) => b.factor === 'silver')!.correlation).toBeCloseTo(1, 9)
    expect(r.betas.find((b) => b.factor === 'dxy')!.correlation!).toBeLessThan(-0.5)
    expect(r.matrix.values[0][0]).toBe(1)
    expect(r.rolling.length).toBe(199 - 62)
    expect(r.rolling.at(-1)!.values.gold).toBeUndefined()
  })

  it('stores both COT families in cot_positions and keeps cot_reports for disaggregated markets', () => {
    const gold = parseCotReports(fixture('cot-gold-2026-09.json'), 'disagg', 'GOLD')
    const btc = parseCotReports(fixture('cot-btc-tff-2026-09.json'), 'tff', 'BTC')
    upsertCotReports([...gold, ...btc])
    expect(readCotReports('GOLD', 'disagg')).toEqual(gold)
    expect(readCotReports('BTC', 'tff')).toEqual(btc)
    expect(readCot('GOLD')).toHaveLength(3)
    expect(readCot('BTC')).toHaveLength(0) // TFF never lands in the disaggregated wide table
    expect(readSpeculator('BTC', 'tff').at(-1)).toMatchObject({ long: 4745, short: 12698 })
    expect(readSpeculator('GOLD', 'disagg').at(-1)).toMatchObject({ long: 135699, short: 8310 })
    const r = cotResponse('gold')!
    expect(r).toMatchObject({ market: 'GOLD', report: 'disagg', speculator: { category: 'mm' } })
    expect(r.latest!.categories.find((c) => c.speculator)!.id).toBe('mm')
    expect(cotResponse('NOPE')).toBeNull()
  })

  it('refreshes every universe COT market from its family dataset', async () => {
    const urls: string[] = []
    const f = async (u: string) => {
      urls.push(u)
      return Response.json(fixture('cot-gold-2026-09.json'))
    }
    const msg = await refreshCot(undefined, f as unknown as typeof fetch)
    expect(msg).toContain('GOLD 3 reports')
    expect(msg).toContain('SILVER 3 reports')
    expect(urls.every((u) => u.includes('72hh-3qpy'))).toBe(true)
    expect(readCot('SILVER')).toHaveLength(3)
  })

  it('correlates an asset with its relative-value partner', () => {
    expect(assetPeers('gold')).toEqual(['silver'])
    expect(assetPeers('silver')).toEqual(['gold'])
    expect(correlationFactors('silver').map((f) => f.id)).toEqual(['gold', 'silver', 'realYield', 'dxy', 'vix', 'spy'])
  })

  it('reads price series from the prices_daily yahoo cache', async () => {
    const { readSeriesPoints } = await import('./service.js')
    upsertDailyBars([{ symbol: 'GC=F', date: '2026-09-28', close: 3800, source: 'yahoo' }])
    expect(readSeriesPoints('GOLD')).toEqual([{ date: '2026-09-28', value: 3800 }])
  })
})

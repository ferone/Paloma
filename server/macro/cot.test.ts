import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { CotRow } from '../db/shared-repo.js'
import { categoryTable, deriveCot, fetchCotHistory, parseCotRows, publishedAtFor, type SocrataCotRow } from './cot.js'

// Recorded from the live CFTC Socrata dataset 72hh-3qpy (COMEX GOLD, code 088691), newest first.
const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/cot-gold-2026-09.json', import.meta.url), 'utf8'),
) as SocrataCotRow[]

describe('COT parsing', () => {
  it('parses real disaggregated rows into ascending cot_reports rows', () => {
    const rows = parseCotRows(fixture, 'GOLD')
    expect(rows.map((r) => r.reportDate)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22'])
    const last = rows.at(-1)!
    expect(last).toMatchObject({
      market: 'GOLD',
      openInterest: 412800,
      prodLong: 17719,
      prodShort: 44496,
      swapLong: 14626,
      swapShort: 250752, // the double-underscore column
      mmLong: 135699,
      mmShort: 8310,
      otherLong: 118283,
      nonrepShort: 15387,
    })
  })

  it('stamps published_at as Friday 20:30Z (report Tuesday + 3 days)', () => {
    expect(publishedAtFor('2026-09-22')).toBe('2026-09-25T20:30:00Z')
    expect(parseCotRows(fixture, 'GOLD').at(-1)!.publishedAt).toBe('2026-09-25T20:30:00Z')
    // Month rollover.
    expect(publishedAtFor('2026-09-29')).toBe('2026-10-02T20:30:00Z')
  })

  it('derives managed-money net, % OI and week-over-week change', () => {
    const d = deriveCot(parseCotRows(fixture, 'GOLD'), 156, 2)
    const last = d.at(-1)!
    expect(last.mmNet).toBe(135699 - 8310)
    expect(last.mmNetPctOi).toBeCloseTo((135699 - 8310) / 412800, 9)
    expect(last.mmNetChange).toBe(135699 - 8310 - (142394 - 9278))
    expect(last.prodNet).toBe(17719 - 44496)
    expect(last.swapNet).toBe(14626 - 250752)
    expect(d[0].mmNetChange).toBeNull()
  })

  it('computes trailing percentile and z-score using only past reports', () => {
    const rows: CotRow[] = Array.from({ length: 40 }, (_, i) => ({
      market: 'GOLD',
      reportDate: `2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`,
      publishedAt: null,
      openInterest: 1000,
      mmLong: 100 + i * 10,
      mmShort: 100,
      prodLong: null,
      prodShort: null,
      swapLong: null,
      swapShort: null,
      otherLong: null,
      otherShort: null,
      nonrepLong: null,
      nonrepShort: null,
    }))
    const d = deriveCot(rows, 156, 26)
    expect(d[24].mmPercentile3y).toBeNull() // fewer than minN reports
    expect(d[39].mmPercentile3y).toBe(1) // monotonic rise → latest is the max
    expect(d[39].mmZ3y!).toBeGreaterThan(1.5)
    // Changing a FUTURE row must not change a past statistic (look-ahead safety).
    const bumped = rows.map((r, i) => (i === 39 ? { ...r, mmLong: -5000 } : r))
    expect(deriveCot(bumped, 156, 26)[30]).toEqual(d[30])
  })

  it('builds the category table with weekly changes', () => {
    const rows = parseCotRows(fixture, 'GOLD')
    const t = categoryTable(rows[2], rows[1])
    expect(t.map((c) => c.name)).toEqual(['Producers / merchants', 'Swap dealers', 'Managed money', 'Other reportables', 'Nonreportable'])
    const mm = t.find((c) => c.name === 'Managed money')!
    expect(mm.changeLong).toBe(135699 - 142394)
    expect(mm.changeShort).toBe(8310 - 9278)
    expect(mm.netPctOi).toBeCloseTo((135699 - 8310) / 412800, 9)
    expect(categoryTable(rows[2], null)[0].changeNet).toBeNull()
  })

  it('queries Socrata by exact contract code and sends the app token', async () => {
    const f = vi.fn(async () => Response.json(fixture))
    const rows = await fetchCotHistory('GOLD', { fetchImpl: f as unknown as typeof fetch, appToken: 'tok' })
    expect(rows).toHaveLength(3)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(decodeURIComponent(url)).toContain("cftc_contract_market_code='088691'")
    expect((init.headers as Record<string, string>)['X-App-Token']).toBe('tok')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  COT_FAMILIES,
  categoryTable,
  deriveCot,
  fetchCotReports,
  fromCotRow,
  parseCotReports,
  parseCotRows,
  publishedAtFor,
  speculatorOf,
  speculatorPosition,
  type CotReport,
  type SocrataCotRow,
} from './cot.js'

// Recorded from the live CFTC Socrata datasets, newest first:
//   72hh-3qpy disaggregated futures-only, COMEX GOLD (088691)
//   gpe5-46if Traders in Financial Futures futures-only, CME BITCOIN (133741)
const load = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as SocrataCotRow[]
const fixture = load('cot-gold-2026-09.json')
const btcFixture = load('cot-btc-tff-2026-09.json')

const GOLD = { report: 'disagg', code: '088691', market: 'GOLD' } as const
const BTC = { report: 'tff', code: '133741', market: 'BTC' } as const

describe('COT parsing (disaggregated)', () => {
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

  it('round-trips the wide cot_reports row through the generic report', () => {
    const rows = parseCotRows(fixture, 'GOLD')
    const reports = parseCotReports(fixture, 'disagg', 'GOLD')
    expect(rows.map(fromCotRow)).toEqual(reports)
  })

  it('stamps published_at as Friday 20:30Z (report Tuesday + 3 days)', () => {
    expect(publishedAtFor('2026-09-22')).toBe('2026-09-25T20:30:00Z')
    expect(parseCotRows(fixture, 'GOLD').at(-1)!.publishedAt).toBe('2026-09-25T20:30:00Z')
    // Month rollover.
    expect(publishedAtFor('2026-09-29')).toBe('2026-10-02T20:30:00Z')
  })

  it('derives speculator (managed-money) net, % OI and week-over-week change', () => {
    const d = deriveCot(parseCotReports(fixture, 'disagg', 'GOLD'), 156, 2)
    const last = d.at(-1)!
    expect(last.specNet).toBe(135699 - 8310)
    expect(last.specNetPctOi).toBeCloseTo((135699 - 8310) / 412800, 9)
    expect(last.specNetChange).toBe(135699 - 8310 - (142394 - 9278))
    expect(last.nets.prod).toBe(17719 - 44496)
    expect(last.nets.swap).toBe(14626 - 250752)
    expect(last.nets.mm).toBe(last.specNet)
    expect(d[0].specNetChange).toBeNull()
  })

  it('computes trailing percentile and z-score using only past reports', () => {
    const reports: CotReport[] = Array.from({ length: 40 }, (_, i) => ({
      market: 'GOLD',
      report: 'disagg',
      reportDate: `2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`,
      publishedAt: null,
      openInterest: 1000,
      positions: { mm: { long: 100 + i * 10, short: 100 } },
    }))
    const d = deriveCot(reports, 156, 26)
    expect(d[24].specPercentile3y).toBeNull() // fewer than minN reports
    expect(d[39].specPercentile3y).toBe(1) // monotonic rise → latest is the max
    expect(d[39].specZ3y!).toBeGreaterThan(1.5)
    // Changing a FUTURE row must not change a past statistic (look-ahead safety).
    const bumped = reports.map((r, i) => (i === 39 ? { ...r, positions: { mm: { long: -5000, short: 100 } } } : r))
    expect(deriveCot(bumped, 156, 26)[30]).toEqual(d[30])
  })

  it('builds the category table with weekly changes', () => {
    const rows = parseCotReports(fixture, 'disagg', 'GOLD')
    const t = categoryTable(rows[2], rows[1])
    expect(t.map((c) => c.name)).toEqual(['Producers / merchants', 'Swap dealers', 'Managed money', 'Other reportables', 'Nonreportable'])
    const mm = t.find((c) => c.name === 'Managed money')!
    expect(mm.speculator).toBe(true)
    expect(t.filter((c) => c.speculator)).toHaveLength(1)
    expect(mm.changeLong).toBe(135699 - 142394)
    expect(mm.changeShort).toBe(8310 - 9278)
    expect(mm.netPctOi).toBeCloseTo((135699 - 8310) / 412800, 9)
    expect(categoryTable(rows[2], null)[0].changeNet).toBeNull()
  })

  it('queries the disaggregated dataset by exact contract code and sends the app token', async () => {
    const f = vi.fn(async () => Response.json(fixture))
    const rows = await fetchCotReports(GOLD, { fetchImpl: f as unknown as typeof fetch, appToken: 'tok' })
    expect(rows).toHaveLength(3)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/resource/72hh-3qpy.json')
    expect(decodeURIComponent(url)).toContain("cftc_contract_market_code='088691'")
    expect((init.headers as Record<string, string>)['X-App-Token']).toBe('tok')
  })
})

describe('COT parsing (Traders in Financial Futures)', () => {
  it('parses the real CME bitcoin TFF rows into every TFF category', () => {
    const r = parseCotReports(btcFixture, 'tff', 'BTC')
    expect(r.map((x) => x.reportDate)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22'])
    const last = r.at(-1)!
    expect(last).toMatchObject({ market: 'BTC', report: 'tff', openInterest: 22315, publishedAt: '2026-09-25T20:30:00Z' })
    expect(last.positions).toEqual({
      dealer: { long: 7135, short: 3488 },
      asset_mgr: { long: 4962, short: 1791 },
      lev_money: { long: 4745, short: 12698 },
      other: { long: 881, short: 99 },
      nonrep: { long: 1284, short: 931 },
    })
  })

  it('reads leveraged funds as the speculator', () => {
    const r = parseCotReports(btcFixture, 'tff', 'BTC')
    expect(speculatorPosition(r.at(-1)!)).toEqual({ long: 4745, short: 12698 })
    const d = deriveCot(r, 156, 2)
    expect(d.at(-1)!.specNet).toBe(4745 - 12698)
    expect(d.at(-1)!.specNetPctOi).toBeCloseTo((4745 - 12698) / 22315, 9)
    expect(d.at(-1)!.specNetChange).toBe(4745 - 12698 - (5545 - 11899))
    expect(d.at(-1)!.nets.asset_mgr).toBe(4962 - 1791)
    const t = categoryTable(r[2], r[1])
    expect(t.map((c) => c.id)).toEqual(['dealer', 'asset_mgr', 'lev_money', 'other', 'nonrep'])
    expect(t.find((c) => c.speculator)!.name).toBe('Leveraged funds')
  })

  it('queries the TFF dataset with TFF columns', async () => {
    const f = vi.fn(async () => Response.json(btcFixture))
    const rows = await fetchCotReports(BTC, { fetchImpl: f as unknown as typeof fetch })
    expect(rows).toHaveLength(3)
    const [url] = f.mock.calls[0] as unknown as [string]
    const u = decodeURIComponent(url)
    expect(url).toContain('/resource/gpe5-46if.json')
    expect(u).toContain("cftc_contract_market_code='133741'")
    expect(u).toContain('lev_money_positions_long')
    expect(u).not.toContain('m_money_positions_long_all')
  })

  it('refuses a malformed contract code (no Socrata query injection)', async () => {
    const f = vi.fn()
    await expect(fetchCotReports({ report: 'tff', code: "1' OR '1'='1", market: 'X' }, { fetchImpl: f as unknown as typeof fetch })).rejects.toThrow(/Invalid CFTC/)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('speculator mapping', () => {
  it('maps each report family to its speculator category and driver', () => {
    expect(speculatorOf('disagg')).toMatchObject({ category: 'mm', label: 'Managed money', driverId: 'COT_MM' })
    expect(speculatorOf('tff')).toMatchObject({ category: 'lev_money', label: 'Leveraged funds', driverId: 'COT_LF' })
    for (const fam of Object.values(COT_FAMILIES)) {
      expect(fam.categories.map((c) => c.id)).toContain(fam.speculator.category)
    }
  })
})

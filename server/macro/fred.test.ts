import { describe, expect, it, vi } from 'vitest'
import { diffSeries, fetchFredSeries, parseFredCsv, parseFredJson, ratioSeries, yoyPercent } from './fred.js'

// Recorded from https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10&cosd=2026-09-15,
// with a "." holiday row (as FRED emits) inserted to exercise missing values.
const CSV = `observation_date,DFII10
2026-09-15,2.62
2026-09-16,2.68
2026-09-17,2.61
2026-09-18,2.68
2026-09-21,2.62
2026-09-22,2.63
2026-09-23,2.76
2026-09-24,2.85
2026-09-25,2.83
2026-09-28,2.90
2026-09-29,.
`

describe('FRED parsing', () => {
  it('parses the keyless CSV and skips "." missing values', () => {
    const pts = parseFredCsv(CSV)
    expect(pts).toHaveLength(10)
    expect(pts[0]).toEqual({ date: '2026-09-15', value: 2.62 })
    expect(pts.at(-1)).toEqual({ date: '2026-09-28', value: 2.9 })
  })

  it('accepts the legacy DATE header, CRLF and blank values', () => {
    const pts = parseFredCsv('DATE,VIXCLS\r\n2020-01-01,\r\n2020-01-02,12.47\r\n')
    expect(pts).toEqual([{ date: '2020-01-02', value: 12.47 }])
  })

  it('parses the JSON API and skips "." values', () => {
    const pts = parseFredJson({
      observations: [
        { date: '2026-09-25', value: '2.83' },
        { date: '2026-09-26', value: '.' },
        { date: '2026-09-28', value: '2.90' },
      ],
    })
    expect(pts.map((p) => p.value)).toEqual([2.83, 2.9])
    expect(parseFredJson({ error_message: 'Bad Request' })).toEqual([])
  })

  it('computes CPI year-over-year from the monthly level', () => {
    const cpi = [
      { date: '2025-01-01', value: 318.961 },
      { date: '2025-02-01', value: 319.679 },
      { date: '2026-01-01', value: 328.5 },
      { date: '2026-02-01', value: 329.9 },
    ]
    const yoy = yoyPercent(cpi)
    expect(yoy.map((p) => p.date)).toEqual(['2026-01-01', '2026-02-01'])
    expect(yoy[0].value).toBeCloseTo((328.5 / 318.961 - 1) * 100, 3)
    expect(yoy[1].value).toBeCloseTo((329.9 / 319.679 - 1) * 100, 3)
  })

  it('derives spreads and ratios on matching dates only', () => {
    const a = [
      { date: '2026-01-02', value: 4.5 },
      { date: '2026-01-05', value: 4.6 },
    ]
    const b = [{ date: '2026-01-05', value: 4.0 }]
    expect(diffSeries(a, b)).toEqual([{ date: '2026-01-05', value: 0.6 }])
    expect(ratioSeries(a, b)[0].value).toBeCloseTo(1.15, 6)
  })
})

describe('fetchFredSeries', () => {
  it('uses the keyless CSV endpoint without a key', async () => {
    const f = vi.fn(async () => new Response(CSV, { status: 200 }))
    const r = await fetchFredSeries('DFII10', { fetchImpl: f as unknown as typeof fetch, from: '2026-09-15' })
    expect(r.via).toBe('csv')
    expect(r.points).toHaveLength(10)
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('fredgraph.csv?id=DFII10&cosd=2026-09-15')
  })

  it('uses the JSON API with a key', async () => {
    const f = vi.fn(async () => Response.json({ observations: [{ date: '2026-09-28', value: '2.90' }] }))
    const r = await fetchFredSeries('DFII10', { apiKey: 'k', fetchImpl: f as unknown as typeof fetch })
    expect(r.via).toBe('api')
    expect(r.points).toEqual([{ date: '2026-09-28', value: 2.9 }])
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('api.stlouisfed.org')
  })

  it('throws on HTTP errors and HTML error pages', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 500 }))
    await expect(fetchFredSeries('X', { fetchImpl: bad as unknown as typeof fetch })).rejects.toThrow(/HTTP 500/)
    const html = vi.fn(async () => new Response('<html>error</html>', { status: 200 }))
    await expect(fetchFredSeries('X', { fetchImpl: html as unknown as typeof fetch })).rejects.toThrow(/HTML/)
  })
})

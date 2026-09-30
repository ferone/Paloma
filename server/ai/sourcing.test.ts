import { describe, expect, it } from 'vitest'
import { SourcePolicy, cleanTitle, isValidUrl, normalizeReport, normalizeUrl } from './sourcing.js'

describe('URL validation', () => {
  it('accepts public http(s) URLs and rejects everything else', () => {
    expect(isValidUrl('https://www.reuters.com/markets/commodities/gold-2026-09-28/')).toBe(true)
    expect(isValidUrl('http://fred.stlouisfed.org/series/DFII10')).toBe(true)
    for (const bad of [
      'ftp://x.com/a',
      'javascript:alert(1)',
      'https://example.com/article',
      'https://localhost:3000/x',
      'https://192.168.1.1/x',
      'https://nodot/x',
      'https://user:pw@site.com/',
      'https://a.com/has space',
      'reuters.com/article',
      '',
      42,
      null,
    ])
      expect(isValidUrl(bad)).toBe(false)
  })

  it('cleans search-result titles', () => {
    expect(cleanTitle('Market Analysis &amp; Forecast - Investing.com')).toBe('Market Analysis & Forecast - Investing.com')
    expect(cleanTitle('  ')).toBeUndefined()
  })

  it('normalizes for comparison', () => {
    expect(normalizeUrl('https://WWW.Reuters.com/a/b/?utm_source=x&id=3#frag')).toBe('reuters.com/a/b?id=3')
  })
})

describe('source policy', () => {
  const policy = () =>
    new SourcePolicy([{ url: 'https://www.reuters.com/markets/gold-1', title: 'Gold climbs' }], ['https://fred.stlouisfed.org/series/DFII10'])

  it('keeps only citations the provider returned or context URLs, and counts drops', () => {
    const p = policy()
    const kept = p.filter([
      { url: 'https://reuters.com/markets/gold-1/?utm_medium=feed', publisher: 'Reuters', date: '2026-09-28' },
      { url: 'https://www.bloomberg.com/invented-article' }, // plausible but not cited → dropped
      { url: 'not a url' },
      'https://fred.stlouisfed.org/series/DFII10',
    ])
    expect(kept).toEqual([
      { url: 'https://www.reuters.com/markets/gold-1', title: 'Gold climbs', publisher: 'Reuters', date: '2026-09-28' },
      { url: 'https://fred.stlouisfed.org/series/DFII10', title: undefined, publisher: undefined, date: undefined },
    ])
    expect(p.dropped).toBe(2)
  })

  it('offline: no citations means only context URLs can survive', () => {
    const p = new SourcePolicy([], [])
    expect(p.filter([{ url: 'https://www.reuters.com/markets/gold-1' }])).toEqual([])
    expect(p.dropped).toBe(1)
  })
})

describe('normalizeReport', () => {
  it('marks drivers and claims without verified sources as unsourced', () => {
    const r = normalizeReport(
      'macro_brief',
      {
        summary: 'Real yields rose 72bp in three months.',
        outlook: 'BULLISH-ish',
        drivers: [
          { title: 'Real yields', detail: 'DFII10 at 2.90% on 2026-09-28', sentiment: 'bearish', sources: [{ url: 'https://fred.stlouisfed.org/series/DFII10' }] },
          { title: 'Central banks', detail: 'Buying continues', sentiment: 'bullish', sources: [{ url: 'https://www.gold.org/made-up' }] },
          { nothing: true },
        ],
        risks: ['Dollar rebound', { text: 'Reuters says X', sources: [{ url: 'https://www.reuters.com/markets/gold-1' }] }],
        what_would_change_my_mind: [{ text: 'Real yields below 2%' }],
      },
      policy2(),
    )!
    expect(r.body.kind).toBe('macro_brief')
    if (r.body.kind !== 'macro_brief') return
    expect(r.body.outlook).toBe('neutral')
    expect(r.body.drivers).toHaveLength(2)
    expect(r.body.drivers[0].sourced).toBe(true)
    expect(r.body.drivers[1]).toMatchObject({ sourced: false, sources: [] })
    expect(r.body.risks.map((c) => c.sourced)).toEqual([false, true])
    expect(r.body.whatWouldChangeMyMind[0].sourced).toBe(false)
    expect(r.unsourcedCount).toBe(3)
    expect(r.droppedSources).toBe(1)
    expect(r.sources.map((s) => s.url)).toEqual(['https://fred.stlouisfed.org/series/DFII10', 'https://www.reuters.com/markets/gold-1'])
  })

  it('returns null when the core text is missing', () => {
    expect(normalizeReport('ask', { points: [] }, policy2(), 'q')).toBeNull()
    expect(normalizeReport('trade_brief', null, policy2())).toBeNull()
  })

  it('normalizes trade briefs and legs', () => {
    const r = normalizeReport('trade_brief', { thesis: 'T', legs: [{ symbol: 'GCZ26', side: 'SHORT' }, {}], entry_plan: 'E', invalidation: 'I' }, policy2())!
    expect(r.body).toMatchObject({ kind: 'trade_brief', thesis: 'T', entryPlan: 'E', legs: [{ instrument: 'GCZ26', side: 'short' }], catalysts: [], risks: [] })
  })
})

function policy2() {
  return new SourcePolicy([{ url: 'https://www.reuters.com/markets/gold-1' }], ['https://fred.stlouisfed.org/series/DFII10'])
}

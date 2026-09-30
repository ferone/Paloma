import { describe, expect, it } from 'vitest'
import type { CotPoint, MacroSeriesSnapshot } from '../../shared/macro.js'
import { DRIVER_SETS, buildRegime, buildScorecard, cotRule, cotStance, driverSetFor, driversFor, ordinal, riskRole } from './scorecard.js'

function snap(id: string, p: Partial<MacroSeriesSnapshot>): MacroSeriesSnapshot {
  return {
    id,
    label: id,
    description: '',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: null,
    latest: 1,
    latestDate: '2026-09-28',
    change1m: 0,
    change3m: 0,
    z: 0,
    percentile: 0.5,
    observations: 100,
    provenance: { source: id, asOf: '2026-09-28' },
    ...p,
  }
}

const map = (...s: MacroSeriesSnapshot[]) => new Map(s.map((x) => [x.id, x]))
const stance = (rows: ReturnType<typeof buildScorecard>, id: string) => rows.find((r) => r.id === id)?.stance

describe('macro scorecard rules', () => {
  it('falling real yields and a weakening dollar are tailwinds; rising are headwinds', () => {
    const tail = buildScorecard('gold', map(snap('DFII10', { change3m: -0.3 }), snap('DTWEXBGS', { changeKind: 'pct', change3m: -0.02 })), null)
    expect(stance(tail, 'DFII10')).toBe('tailwind')
    expect(stance(tail, 'DTWEXBGS')).toBe('tailwind')
    const head = buildScorecard('gold', map(snap('DFII10', { change3m: 0.72 }), snap('DTWEXBGS', { change3m: 0.02 })), null)
    expect(stance(head, 'DFII10')).toBe('headwind')
    expect(head.find((r) => r.id === 'DFII10')!.reason).toContain('+0.72pp')
    expect(stance(head, 'DTWEXBGS')).toBe('headwind')
    const flat = buildScorecard('gold', map(snap('DFII10', { change3m: 0.1 })), null)
    expect(stance(flat, 'DFII10')).toBe('neutral')
  })

  it('treats equity stress oppositely for gold (haven) and silver (cyclical)', () => {
    const s = map(snap('VIXCLS', { latest: 30, z: 2 }))
    expect(stance(buildScorecard('gold', s, null), 'VIXCLS')).toBe('tailwind')
    expect(stance(buildScorecard('silver', s, null), 'VIXCLS')).toBe('headwind')
    const calm = map(snap('VIXCLS', { latest: 12, z: -1 }))
    expect(stance(buildScorecard('gold', calm, null), 'VIXCLS')).toBe('neutral')
    expect(stance(buildScorecard('silver', calm, null), 'VIXCLS')).toBe('tailwind')
  })

  it('applies inflation, money and policy rules', () => {
    const rows = buildScorecard(
      'gold',
      map(
        snap('CPI_YOY', { latest: 3.4, change3m: 0.2 }),
        snap('M2_YOY', { latest: 5.7 }),
        snap('DFF', { change3m: 0.25 }),
        snap('T10YIE', { change3m: 0.13 }),
      ),
      null,
    )
    expect(stance(rows, 'CPI_YOY')).toBe('tailwind')
    expect(stance(rows, 'M2_YOY')).toBe('tailwind')
    expect(stance(rows, 'DFF')).toBe('headwind')
    expect(stance(rows, 'T10YIE')).toBe('tailwind')
    // Hot but falling CPI is not a tailwind.
    expect(stance(buildScorecard('gold', map(snap('CPI_YOY', { latest: 3.4, change3m: -0.8 })), null), 'CPI_YOY')).toBe('neutral')
  })

  it('includes the gold/silver ratio only for silver', () => {
    const s = map(snap('GSR', { latest: 90, z: 1.4, unit: 'ratio' }))
    expect(stance(buildScorecard('silver', s, null), 'GSR')).toBe('tailwind')
    expect(buildScorecard('gold', s, null).some((r) => r.id === 'GSR')).toBe(false)
  })

  it('reads COT positioning as a contrarian signal', () => {
    const p = (pct: number): CotPoint => ({
      reportDate: '2026-09-22',
      publishedAt: '2026-09-25T20:30:00Z',
      openInterest: 1,
      specNet: 1,
      specNetPctOi: 0.3,
      specPercentile3y: pct,
      specZ3y: 0,
      specNetChange: 0,
      nets: {},
    })
    expect(cotStance(p(0.9)).stance).toBe('headwind')
    expect(cotStance(p(0.1)).stance).toBe('tailwind')
    expect(cotStance(p(0.61)).reason).toContain('61st pct')
    expect(cotStance(null).stance).toBe('neutral')
    const rows = buildScorecard('gold', map(), p(0.9))
    expect(rows.at(-1)).toMatchObject({ id: 'COT_MM', label: 'Managed-money positioning (COT)', stance: 'headwind', value: 30 })
    expect(cotStance(p(0.9), 'tff').reason).toMatch(/^LF net/)
    expect(cotRule('tff')).toMatch(/^Leveraged-fund net/)
  })

  it('missing drivers stay neutral with an explicit reason', () => {
    const rows = buildScorecard('gold', map(), null)
    expect(rows.every((r) => r.stance === 'neutral')).toBe(true)
    expect(rows[0].reason).toBe('Insufficient data')
  })

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 61, 100].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '61st', '100th'])
  })
})

describe('class driver sets', () => {
  const ids = (rules: { id: string }[]) => rules.map((r) => r.id)

  it('selects the driver set by asset class', () => {
    expect(driverSetFor('gold')).toBe(DRIVER_SETS.precious)
    expect(driverSetFor('silver')).toBe(DRIVER_SETS.precious)
  })

  it('keeps the precious drivers and order for gold and silver exactly', () => {
    const precious = ['DFII10', 'DTWEXBGS', 'T10YIE', 'DFF', 'CPI_YOY', 'M2_YOY', 'VIXCLS', 'BAMLH0A0HYM2']
    expect(ids(driversFor('gold'))).toEqual(precious)
    // Silver is the denominator of gold/silver, so it also gets the ratio rule.
    expect(ids(driversFor('silver'))).toEqual([...precious, 'GSR'])
    expect(ids(buildScorecard('silver', map(), null))).toEqual([...precious, 'GSR', 'COT_MM'])
    expect(buildScorecard('silver', map(), null).find((r) => r.id === 'VIXCLS')!.rule).toContain('(silver trades with industrial/risk beta)')
    expect(buildScorecard('silver', map(), null).find((r) => r.id === 'GSR')!.rule).toBe(
      '3y z ≥ +1 → tailwind (silver historically cheap vs gold); z ≤ −1 → headwind (silver rich)',
    )
  })

  it('declares the industrial and crypto sets as data', () => {
    expect(ids(DRIVER_SETS.industrial.drivers)).toEqual(['DTWEXBGS', 'DFII10', 'INDPRO_YOY', 'BAMLH0A0HYM2'])
    expect(DRIVER_SETS.industrial.positioning).toBe(true)
    expect(ids(DRIVER_SETS.crypto.drivers)).toEqual(['DFII10', 'DTWEXBGS', 'QQQ', 'M2_YOY', 'VIXCLS'])
    expect(DRIVER_SETS.crypto.positioning).toBe(true)
  })

  it('evaluates the industrial and crypto rules', () => {
    const indpro = DRIVER_SETS.industrial.drivers.find((d) => d.id === 'INDPRO_YOY')!
    expect(indpro.evaluate(snap('INDPRO_YOY', { latest: 3.1 }), 'silver').stance).toBe('tailwind')
    expect(indpro.evaluate(snap('INDPRO_YOY', { latest: -0.4 }), 'silver').stance).toBe('headwind')
    const qqq = DRIVER_SETS.crypto.drivers.find((d) => d.id === 'QQQ')!
    expect(qqq.evaluate(snap('QQQ', { changeKind: 'pct', change3m: 0.08 }), 'silver').stance).toBe('tailwind')
    expect(qqq.evaluate(snap('QQQ', { changeKind: 'pct', change3m: -0.09 }), 'silver').stance).toBe('headwind')
    // Crypto reads equity stress as a cyclical (non-haven) asset.
    const vix = DRIVER_SETS.crypto.drivers.find((d) => d.id === 'VIXCLS')!
    expect(vix.evaluate(snap('VIXCLS', { latest: 30 }), 'silver').reason).toContain('high-beta crypto')
  })

  it('assigns risk roles: gold is the haven, everything else cyclical', () => {
    expect(riskRole('gold')).toBe('haven')
    expect(riskRole('silver')).toBe('cyclical')
  })
})

describe('regime label', () => {
  it('composes real yields, dollar and risk reads', () => {
    const r = buildRegime(
      'gold',
      map(snap('DFII10', { change3m: -0.3 }), snap('DTWEXBGS', { change3m: -0.03 }), snap('VIXCLS', { latest: 28 }), snap('BAMLH0A0HYM2', { z: 0 })),
    )
    expect(r.label).toBe('Real yields falling · Dollar weakening · Risk-off')
    expect(r.parts.map((p) => p.stance)).toEqual(['tailwind', 'tailwind', 'tailwind'])
    const silver = buildRegime('silver', map(snap('VIXCLS', { latest: 28 })))
    expect(silver.parts.find((p) => p.key === 'risk')!.stance).toBe('headwind')
  })

  it('falls back to DXY and reports missing reads honestly', () => {
    const r = buildRegime('gold', map(snap('DXY', { change3m: 0.02 }), snap('VIXCLS', { latest: 13, z: -1 }), snap('BAMLH0A0HYM2', { z: -0.5 })))
    expect(r.label).toBe('Real yields n/a · Dollar strengthening · Risk-on')
  })
})

import { describe, expect, it } from 'vitest'
import type { SeasonalWindowView, SeasonalityDetail } from '@shared/quant'
import { seasonalitySummary } from './summaries'

const win = (over: Partial<SeasonalWindowView>): SeasonalWindowView => ({
  entryDoy: 245,
  exitDoy: 350,
  entryLabel: '2 Sep',
  exitLabel: '16 Dec',
  side: 'long',
  years: 12,
  winRate: 0.75,
  avgPnl: 4.2,
  medianPnl: 3.9,
  tStat: 2.1,
  profitFactor: 2.4,
  avgMae: -1.8,
  avgMfe: 6.3,
  active: true,
  perYear: [],
  ...over,
})

function detail(oosStatus: 'passed' | 'failed'): SeasonalityDetail {
  const long = win({})
  const short = win({ side: 'short', entryLabel: '3 Mar', exitLabel: '20 May', entryDoy: 62, exitDoy: 140, active: false })
  return {
    id: 'HG.out',
    label: 'Copper — front outright',
    kind: 'outright',
    metal: 'copper',
    unit: '$/lb',
    originDoy: 1,
    monthTicks: [],
    rebase: 'rebasePct',
    envelope: [{ doy: 270, p10: -8, p25: -3, p50: 1, p75: 4, p90: 9, mean: 0.8 }],
    current: { year: 2026, points: [{ doy: 270, value: 10.5 }] },
    perYear: [],
    monthly: { basis: 'pct', years: [], cells: [], summary: [] },
    windows: [long, short, win({ entryLabel: '1 May', exitLabel: '1 Jul', years: 9 })],
    oos: {
      status: oosStatus,
      method: 'seasonal-window',
      reason: oosStatus === 'passed' ? 'meets the bar' : 'win rate below 60%',
      trades: 11,
      winRate: 0.64,
      avgPnl: 3.1,
      totalPnl: 34,
      sharpe: 0.6,
      tStat: 1.7,
      maxDrawdown: -9,
      pnlUnit: '% per trade',
      yearly: [],
      regime: null,
    } as SeasonalityDetail['oos'],
    asOf: '2026-10-02',
    dataThrough: '2026-10-02',
    provenance: { source: 'test', asOf: '2026-10-02' },
  }
}

describe('seasonalitySummary', () => {
  it('names each shaded band with its colour, side, dates and in-sample record', () => {
    const s = detail('passed')
    const { summary, label } = seasonalitySummary(s, s.windows.slice(0, 2), true, false, 'conservative')
    expect(label).toContain('Copper')
    expect(summary).toContain('GREEN band = LONG window: enter 2 Sep → exit 16 Dec')
    expect(summary).toContain('RED band = SHORT window: enter 3 Mar → exit 20 May')
    expect(summary).toContain('won 75%')
    expect(summary).toContain('today inside it: yes')
    expect(summary).toContain('IN-SAMPLE CANDIDATES')
    expect(summary).toContain('PASSED')
    expect(summary).toContain('ABOVE the 90th percentile')
    expect(summary).toContain('Other candidate windows') // the third, unshaded window
  })

  it('says when shading is off, and that bands are hypotheses when OOS failed', () => {
    const s = detail('failed')
    const off = seasonalitySummary(s, s.windows.slice(0, 3), false, false, 'aggressive').summary
    expect(off).toContain('shading is switched OFF')
    expect(off).not.toContain('GREEN band')
    expect(off).toContain('treat the shaded bands as hypotheses')
  })

  it('marks a single user-selected window', () => {
    const s = detail('passed')
    expect(seasonalitySummary(s, [s.windows[1]], true, true, 'conservative').summary).toContain('the ONE window the user selected')
  })
})

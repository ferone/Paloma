// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SpreadChart, SeasonalPattern, PerYearOverlay, EquityCurve, OutcomeHistogram, ForwardCurveChart, RegimeGateChart, SeasonalReturnsHeatmap, WindowStatsTable } from './index'
import { bandPath, doyToLabel, extent, niceDateTicks, ticks } from './util'

const dates = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2023, 0, 2 + i)).toISOString().slice(0, 10))

describe('chart utils', () => {
  it('ticks, extent, bands and labels', () => {
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(extent([1, null, 3])[0]).toBeLessThan(1)
    expect(bandPath([0, 1], [1, 1], [0, 0])).toMatch(/^M0\.0,1\.0 L1\.0,1\.0/)
    expect(doyToLabel(72)).toBe('13 Mar')
    expect(doyToLabel(1, 244)).toBe('1 Sep')
    expect(niceDateTicks(dates, 4).length).toBeGreaterThan(1)
  })
})

describe('charts render with accessible labels and no hex colours', () => {
  it('SpreadChart shows a hover read-out with the z-score', () => {
    const points = dates.map((d, i) => ({ date: d, value: Math.sin(i / 10), mean: 0, sd: 0.5, z: Math.sin(i / 10) / 0.5 }))
    const { container } = render(<SpreadChart points={points} window={60} />)
    const svg = screen.getByRole('img', { name: /rolling 60-day mean/ })
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 50 })
    expect(screen.getByText('z-score')).toBeTruthy()
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i)
  })

  it('seasonal, per-year, equity, histogram, curve, gate, heatmap and window table', () => {
    const env = Array.from({ length: 200 }, (_, i) => ({ doy: i + 1, p10: -1, p25: -0.5, p50: 0, p75: 0.5, p90: 1, mean: 0 }))
    const ticksM = [{ doy: 1, label: 'Jan' }, { doy: 32, label: 'Feb' }]
    render(<SeasonalPattern envelope={env} current={{ year: 2026, points: [{ doy: 1, value: 0.2 }, { doy: 2, value: 0.3 }] }} monthTicks={ticksM} windows={[{ entryDoy: 10, exitDoy: 40, side: 'long' }]} />)
    render(<PerYearOverlay years={[{ year: 2024, points: [{ doy: 1, value: 1 }, { doy: 5, value: 2 }] }]} current={null} monthTicks={ticksM} />)
    render(<EquityCurve points={dates.slice(0, 50).map((d, i) => ({ date: d, model: i, passive: i / 2, drawdown: -i % 5 }))} />)
    render(<OutcomeHistogram bins={[{ from: -10, to: 0, count: 2 }, { from: 0, to: 10, count: 5 }]} />)
    render(<ForwardCurveChart curves={[{ key: 'now', label: 'latest', color: 'var(--brand)', nodes: [{ days: 30, label: 'Dec 26', price: 100 }, { days: 90, label: 'Feb 27', price: 101 }] }]} />)
    render(<RegimeGateChart k={2.5} points={dates.slice(0, 80).map((d) => ({ date: d, outZ: 0.5, slopeZ: -0.3 }))} />)
    render(<SeasonalReturnsHeatmap basis="pct" years={[2024]} cells={[{ year: 2024, month: 1, ret: 2.5 }]} summary={[{ month: 1, pctPositive: 100, median: 2.5, avg: 2.5 }]} />)
    render(<WindowStatsTable windows={[{ entryLabel: '1 Mar', exitLabel: '1 Apr', side: 'short', years: 9, winRate: 0.8, avgPnl: 120, medianPnl: 100, tStat: 2.1, profitFactor: 3, avgMae: -80, active: true }]} />)
    expect(screen.getByRole('img', { name: /Seasonal envelope/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /term structure/ })).toBeTruthy()
    expect(screen.getByText('now')).toBeTruthy()
    expect(screen.getAllByText('+2.5', { selector: 'td' }).length).toBe(2)
  })
})

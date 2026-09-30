import { useMemo } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtUsdCompact } from '../design/format'
import { TimeSeriesChart } from './TimeSeriesChart'
import { ChartLegend } from './frame'

export interface EquityPoint {
  date: string
  model: number
  passive: number
  drawdown: number
}

/** Cumulative P&L of the model vs the always-trade baseline, with the model's drawdown underneath. */
export function EquityCurve({ points, height = 240 }: { points: EquityPoint[]; height?: number }) {
  const d = useMemo(
    () => ({
      dates: points.map((p) => p.date),
      model: points.map((p) => p.model),
      passive: points.map((p) => p.passive),
      dd: points.map((p) => p.drawdown),
    }),
    [points],
  )
  const top = useMemo(
    () => [
      { key: 'passive', label: 'Always trade (baseline)', values: d.passive, color: PALETTE.muted, dash: '4 3', width: 1.2 },
      { key: 'model', label: 'Model (verdicts only)', values: d.model, color: PALETTE.brand, width: 1.8 },
    ],
    [d],
  )
  const bottom = useMemo(() => [{ key: 'dd', label: 'Model drawdown', values: d.dd, color: PALETTE.neg, width: 1, fillToZero: true }], [d])
  const zero = useMemo(() => [{ value: 0, color: PALETTE.faint, dash: '2 3' }], [])
  return (
    <figure className="space-y-1">
      <TimeSeriesChart dates={d.dates} series={top} refLines={zero} height={height} yFormat={fmtUsdCompact} ariaLabel="Cumulative P&L of the model versus the baseline" />
      <TimeSeriesChart dates={d.dates} series={bottom} height={110} yFormat={fmtUsdCompact} ariaLabel="Model drawdown from its running peak" />
      <ChartLegend
        items={[
          { label: 'model (verdicts only)', color: PALETTE.brand },
          { label: 'always trade (baseline)', color: PALETTE.muted, dash: true },
          { label: 'model drawdown', color: PALETTE.neg, area: true },
        ]}
      />
    </figure>
  )
}

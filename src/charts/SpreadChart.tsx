import { useMemo } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtNum, fmtSigned } from '../design/format'
import { TimeSeriesChart } from './TimeSeriesChart'
import { ChartLegend } from './frame'

export interface BandPoint {
  date: string
  value: number
  mean: number | null
  sd: number | null
  z?: number | null
}

/**
 * A structure's value with its rolling mean and ±1σ / ±2σ bands — the z-score
 * picture the engine fades. Hover for value, mean and z on any date.
 */
export function SpreadChart({
  points,
  color = PALETTE.brand,
  yFormat = (v: number) => fmtNum(v, 2),
  window,
  height = 280,
  label = 'value',
}: {
  points: BandPoint[]
  color?: string
  yFormat?: (v: number) => string
  window: number
  height?: number
  label?: string
}) {
  const d = useMemo(() => {
    const band = (k: number, sign: 1 | -1) => points.map((p) => (p.mean != null && p.sd != null ? p.mean + sign * k * p.sd : null))
    return {
      dates: points.map((p) => p.date),
      value: points.map((p) => p.value),
      mean: points.map((p) => p.mean),
      u1: band(1, 1),
      l1: band(1, -1),
      u2: band(2, 1),
      l2: band(2, -1),
    }
  }, [points])
  const series = useMemo(
    () => [
      { key: 'mean', label: `${window}-day mean`, values: d.mean, color: PALETTE.muted, dash: '3 3', width: 1 },
      { key: 'value', label, values: d.value, color, width: 1.5 },
    ],
    [d, window, color, label],
  )
  const bands = useMemo(
    () => [
      { key: 'b2', upper: d.u2, lower: d.l2, color: PALETTE.muted, opacity: 0.1 },
      { key: 'b1', upper: d.u1, lower: d.l1, color: PALETTE.muted, opacity: 0.14 },
    ],
    [d],
  )
  return (
    <figure>
      <TimeSeriesChart
        dates={d.dates}
        series={series}
        bands={bands}
        height={height}
        yFormat={yFormat}
        ariaLabel={`${label} with rolling ${window}-day mean and ±1σ/±2σ bands`}
        tooltipExtra={(i) => {
          const p = points[i]
          return p.z != null ? [{ label: 'z-score', value: fmtSigned(p.z, 2) }] : []
        }}
      />
      <ChartLegend
        items={[
          { label, color },
          { label: `${window}-day mean`, color: PALETTE.muted, dash: true },
          { label: '±1σ / ±2σ band', color: PALETTE.muted, area: true },
        ]}
      />
    </figure>
  )
}

import { useMemo } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtSigned } from '../design/format'
import { TimeSeriesChart } from './TimeSeriesChart'
import { ChartLegend } from './frame'

export interface GatePoint {
  date: string
  outZ: number | null
  slopeZ: number | null
}

/**
 * The structural-move gate: how many σ the front outright and the curve slope sit
 * from their own trailing noise bands. Outside ±k the curve is repricing for real,
 * so fading a spread or fly there is fading a regime change — the gate says stand aside.
 */
export function RegimeGateChart({ points, k, height = 200 }: { points: GatePoint[]; k: number; height?: number }) {
  const d = useMemo(
    () => ({
      dates: points.map((p) => p.date),
      out: points.map((p) => p.outZ),
      slope: points.map((p) => p.slopeZ),
      upper: points.map(() => k),
      lower: points.map(() => -k),
    }),
    [points, k],
  )
  const series = useMemo(
    () => [
      { key: 'out', label: 'Front outright σ', values: d.out, color: PALETTE.series[0], width: 1.3 },
      { key: 'slope', label: 'Curve slope σ', values: d.slope, color: PALETTE.series[1], width: 1.3 },
    ],
    [d],
  )
  const bands = useMemo(() => [{ key: 'ok', upper: d.upper, lower: d.lower, color: PALETTE.pos, opacity: 0.07 }], [d])
  const refs = useMemo(
    () => [
      { value: k, label: `+${k}σ gate`, color: PALETTE.neg },
      { value: -k, label: `−${k}σ gate`, color: PALETTE.neg },
    ],
    [k],
  )
  const lo = Math.min(-k - 0.5, ...points.map((p) => Math.min(p.outZ ?? 0, p.slopeZ ?? 0)))
  const hi = Math.max(k + 0.5, ...points.map((p) => Math.max(p.outZ ?? 0, p.slopeZ ?? 0)))
  const dom = useMemo<[number, number]>(() => [lo, hi], [lo, hi])
  return (
    <figure>
      <TimeSeriesChart
        dates={d.dates}
        series={series}
        bands={bands}
        refLines={refs}
        yDomain={dom}
        height={height}
        yFormat={(v) => fmtSigned(v, 1)}
        ariaLabel={`Front outright and curve slope distance from their noise bands, with the ±${k} sigma structural gate`}
      />
      <ChartLegend
        items={[
          { label: 'front outright', color: PALETTE.series[0] },
          { label: 'curve slope (c1 − c0)', color: PALETTE.series[1] },
          { label: `inside ±${k}σ = normal regime`, color: PALETTE.pos, area: true },
        ]}
      />
    </figure>
  )
}

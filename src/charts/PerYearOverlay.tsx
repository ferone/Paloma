import { useMemo, useState, type PointerEvent } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtNum } from '../design/format'
import { type Box, doyLinePath, doyToLabel, extent, plotH, plotW, scale, ticks } from './util'
import { AXIS_TEXT, ChartLegend, ChartTooltip, GRID, useChartWidth } from './frame'
import type { DoyPath } from './SeasonalPattern'

/**
 * Every year's path on the same day-of-year axis: past years faint, the current
 * season bold. Hovering picks out the year nearest the cursor.
 */
export function PerYearOverlay({
  years,
  current,
  monthTicks,
  originDoy = 1,
  yFormat = (v) => fmtNum(v, 2),
  color = PALETTE.brand,
  height = 260,
}: {
  years: DoyPath[]
  current: DoyPath | null
  monthTicks: { doy: number; label: string }[]
  originDoy?: number
  yFormat?: (v: number) => string
  color?: string
  height?: number
}) {
  const [ref, width] = useChartWidth()
  const [hover, setHover] = useState<{ year: number; doy: number; value: number; px: number } | null>(null)
  const box: Box = { w: width, h: height, ml: 56, mr: 12, mt: 10, mb: 24 }
  const all = useMemo(() => (current ? [...years, current] : years), [years, current])
  const [lo, hi] = useMemo(() => extent(all.flatMap((y) => y.points.map((p) => p.value))), [all])
  const x = scale(1, 366, box.ml, box.ml + plotW(box))
  const y = scale(lo, hi, box.mt + plotH(box), box.mt)
  const lookup = useMemo(() => all.map((yr) => ({ year: yr.year, by: new Map(yr.points.map((p) => [p.doy, p.value])) })), [all])

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const doy = Math.round(1 + ((px - box.ml) / plotW(box)) * 365)
    let best: { year: number; doy: number; value: number; px: number } | null = null
    let bestD = Infinity
    for (const l of lookup) {
      for (let dd = 0; dd <= 3; dd++) {
        const v = l.by.get(doy + dd) ?? l.by.get(doy - dd)
        if (v == null) continue
        const d = Math.abs(y(v) - py)
        if (d < bestD) {
          bestD = d
          best = { year: l.year, doy, value: v, px }
        }
        break
      }
    }
    setHover(best && bestD < 40 ? best : null)
  }

  return (
    <figure>
      <div ref={ref} className="relative w-full select-none">
        <svg width={width} height={height} role="img" aria-label={`Per-year paths for ${all.length} years on a day-of-year axis`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-none">
          {ticks(lo, hi, Math.max(3, Math.floor(height / 55))).map((t) => (
            <g key={t}>
              <line x1={box.ml} x2={box.ml + plotW(box)} y1={y(t)} y2={y(t)} style={GRID} opacity={0.6} />
              <text x={box.ml - 6} y={y(t) + 3} textAnchor="end" style={AXIS_TEXT}>
                {yFormat(t)}
              </text>
            </g>
          ))}
          {monthTicks.map((m) => (
            <text key={m.label} x={x(m.doy) + 2} y={height - 6} style={AXIS_TEXT}>
              {width > 420 || ['Jan', 'Apr', 'Jul', 'Oct'].includes(m.label) ? m.label : ''}
            </text>
          ))}
          {years.map((yr) => (
            <path
              key={yr.year}
              d={doyLinePath(yr.points, x, y)}
              fill="none"
              style={{ stroke: hover?.year === yr.year ? PALETTE.foreground : PALETTE.muted }}
              strokeWidth={hover?.year === yr.year ? 1.6 : 0.9}
              opacity={hover?.year === yr.year ? 0.95 : 0.3}
            />
          ))}
          {current && <path d={doyLinePath(current.points, x, y)} fill="none" style={{ stroke: color }} strokeWidth={2.2} />}
        </svg>
        {hover && (
          <ChartTooltip x={hover.px} y={box.mt} width={width} title={`${hover.year} · ${doyToLabel(hover.doy, originDoy)}`} rows={[{ label: 'value', value: yFormat(hover.value) }]} />
        )}
      </div>
      <ChartLegend items={[...(current ? [{ label: `${current.year} (current)`, color }] : []), { label: `prior years (${years.length})`, color: PALETTE.muted, faint: true }]} />
    </figure>
  )
}

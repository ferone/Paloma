import { useMemo, useState, type PointerEvent } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtNum } from '../design/format'
import { type Box, bandPath, doyLinePath, doyToLabel, extent, linePath, plotH, plotW, scale, ticks } from './util'
import { AXIS_TEXT, ChartLegend, ChartTooltip, GRID, useChartWidth, type TooltipRow } from './frame'

export interface EnvelopeRow {
  doy: number
  p10: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  mean: number | null
}

export interface DoyPath {
  year: number
  points: { doy: number; value: number }[]
}

export interface WindowSpan {
  entryDoy: number
  exitDoy: number
  side: 'long' | 'short'
  label?: string
}

interface Props {
  envelope: EnvelopeRow[]
  current: DoyPath | null
  monthTicks: { doy: number; label: string }[]
  originDoy?: number
  yFormat?: (v: number) => string
  color?: string
  /** Shade these seasonal windows (long = pos tint, short = neg tint). */
  windows?: WindowSpan[]
  height?: number
}

/**
 * The seasonal "hero": multi-year day-of-year envelope (10–90 / 25–75
 * percentiles), median and mean, with the current season overlaid, so you see at
 * a glance whether this year is rich or cheap versus its own history.
 */
export function SeasonalPattern({ envelope, current, monthTicks, originDoy = 1, yFormat = (v) => fmtNum(v, 2), color = PALETTE.brand, windows = [], height = 280 }: Props) {
  const [ref, width] = useChartWidth()
  const [hoverDoy, setHoverDoy] = useState<number | null>(null)
  const box: Box = { w: width, h: height, ml: 56, mr: 12, mt: 10, mb: 24 }
  const x = scale(1, 366, box.ml, box.ml + plotW(box))
  const [lo, hi] = useMemo(
    () => extent([...envelope.flatMap((e) => [e.p10, e.p90, e.mean]), ...(current?.points.map((p) => p.value) ?? [])]),
    [envelope, current],
  )
  const y = scale(lo, hi, box.mt + plotH(box), box.mt)
  const byDoy = useMemo(() => new Map(envelope.map((e) => [e.doy, e])), [envelope])
  const curByDoy = useMemo(() => new Map((current?.points ?? []).map((p) => [p.doy, p.value])), [current])

  // Full 1..366 grid so gaps break the bands instead of bridging them.
  const grid = useMemo(() => Array.from({ length: 366 }, (_, i) => i + 1), [])
  const col = (k: keyof EnvelopeRow) => grid.map((d) => {
    const v = byDoy.get(d)?.[k]
    return v == null ? NaN : y(v)
  })
  const px = grid.map((d) => x(d))
  const outer = bandPath(px, col('p90'), col('p10'))
  const inner = bandPath(px, col('p75'), col('p25'))
  const p50c = col('p50')
  const meanc = col('mean')
  const median = linePath(grid.map((_, i) => [px[i], p50c[i]]))
  const mean = linePath(grid.map((_, i) => [px[i], meanc[i]]))
  const cur = current ? doyLinePath(current.points, x, y) : ''
  const last = current?.points[current.points.length - 1]

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const doy = Math.round(1 + ((e.clientX - r.left - box.ml) / plotW(box)) * 365)
    setHoverDoy(doy >= 1 && doy <= 366 ? doy : null)
  }
  const hv = hoverDoy !== null ? byDoy.get(hoverDoy) : undefined
  const rows: TooltipRow[] = []
  if (hoverDoy !== null) {
    const cv = curByDoy.get(hoverDoy)
    if (current && cv != null) rows.push({ label: `${current.year}`, value: yFormat(cv), color })
    if (hv?.mean != null) rows.push({ label: 'mean', value: yFormat(hv.mean), color: PALETTE.muted })
    if (hv?.p50 != null) rows.push({ label: 'median', value: yFormat(hv.p50) })
    if (hv?.p10 != null && hv.p90 != null) rows.push({ label: '10–90%', value: `${yFormat(hv.p10)} … ${yFormat(hv.p90)}` })
  }

  return (
    <figure>
      <div ref={ref} className="relative w-full select-none">
        <svg width={width} height={height} role="img" aria-label="Seasonal envelope with the current season overlaid" onPointerMove={onMove} onPointerLeave={() => setHoverDoy(null)} className="block touch-none">
          {windows.map((w, i) => (
            <rect
              key={i}
              x={x(w.entryDoy)}
              width={Math.max(1, x(w.exitDoy) - x(w.entryDoy))}
              y={box.mt}
              height={plotH(box)}
              style={{ fill: w.side === 'long' ? PALETTE.pos : PALETTE.neg }}
              opacity={0.09}
            />
          ))}
          {ticks(lo, hi, Math.max(3, Math.floor(height / 55))).map((t) => (
            <g key={t}>
              <line x1={box.ml} x2={box.ml + plotW(box)} y1={y(t)} y2={y(t)} style={GRID} opacity={0.6} />
              <text x={box.ml - 6} y={y(t) + 3} textAnchor="end" style={AXIS_TEXT}>
                {yFormat(t)}
              </text>
            </g>
          ))}
          {monthTicks.map((m) => (
            <g key={m.label}>
              <line x1={x(m.doy)} x2={x(m.doy)} y1={box.mt} y2={box.mt + plotH(box)} style={GRID} opacity={0.35} />
              {width > 420 || ['Jan', 'Apr', 'Jul', 'Oct'].includes(m.label) ? (
                <text x={x(m.doy) + 2} y={height - 6} textAnchor="start" style={AXIS_TEXT}>
                  {m.label}
                </text>
              ) : null}
            </g>
          ))}
          <path d={outer} style={{ fill: PALETTE.muted }} opacity={0.1} />
          <path d={inner} style={{ fill: PALETTE.muted }} opacity={0.16} />
          <path d={median} fill="none" style={{ stroke: PALETTE.muted }} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
          <path d={mean} fill="none" style={{ stroke: PALETTE.muted }} strokeWidth={1.6} />
          {cur && <path d={cur} fill="none" style={{ stroke: color }} strokeWidth={2} />}
          {last && <circle cx={x(last.doy)} cy={y(last.value)} r={3} style={{ fill: color }} />}
          {hoverDoy !== null && <line x1={x(hoverDoy)} x2={x(hoverDoy)} y1={box.mt} y2={box.mt + plotH(box)} style={{ stroke: PALETTE.muted }} opacity={0.6} />}
        </svg>
        {hoverDoy !== null && rows.length > 0 && <ChartTooltip x={x(hoverDoy)} y={box.mt} width={width} title={doyToLabel(hoverDoy, originDoy)} rows={rows} />}
      </div>
      <ChartLegend
        items={[
          ...(current ? [{ label: `${current.year} (current)`, color }] : []),
          { label: 'mean', color: PALETTE.muted },
          { label: 'median', color: PALETTE.muted, dash: true },
          { label: '25–75% / 10–90%', color: PALETTE.muted, area: true },
          ...(windows.length ? [{ label: 'long / short window', color: PALETTE.pos, area: true }] : []),
        ]}
      />
    </figure>
  )
}

/**
 * The same envelope with the (band-crossing / validated) seasonal windows shaded —
 * the spans where the pattern recurs with a real excursion.
 */
export function BandCrossingChart(props: Props & { windows: WindowSpan[] }) {
  return <SeasonalPattern {...props} />
}

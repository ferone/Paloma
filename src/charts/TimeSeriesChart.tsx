import { useMemo, useState, type PointerEvent } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtDate } from '../design/format'
import { type Box, bandPath, downsampleIdx, extent, linePath, nearestIndex, niceDateTicks, plotH, plotW, scale, ticks } from './util'
import { AXIS_TEXT, ChartTooltip, GRID, useChartWidth, type TooltipRow } from './frame'

export interface TSeries {
  key: string
  label: string
  values: (number | null)[]
  color: string
  width?: number
  dash?: string
  opacity?: number
  /** Exclude from the tooltip. */
  quiet?: boolean
  /** Fill the area between the line and zero (e.g. drawdown). */
  fillToZero?: boolean
}

export interface TBand {
  key: string
  upper: (number | null)[]
  lower: (number | null)[]
  color: string
  opacity: number
}

export interface TRefLine {
  value: number
  label?: string
  color: string
  dash?: string
}

export interface TimeSeriesChartProps {
  dates: string[]
  series: TSeries[]
  bands?: TBand[]
  refLines?: TRefLine[]
  height?: number
  yFormat: (v: number) => string
  /** Extra tooltip rows for the hovered index (bands, z, etc.). */
  tooltipExtra?: (i: number) => TooltipRow[]
  ariaLabel: string
  maxPoints?: number
  yDomain?: [number, number]
}

const n = (v: number | null | undefined): number => (v == null ? NaN : v)

/** Responsive date-axis line chart with bands, reference lines and a crosshair tooltip. */
export function TimeSeriesChart({ dates, series, bands = [], refLines = [], height = 260, yFormat, tooltipExtra, ariaLabel, maxPoints = 700, yDomain }: TimeSeriesChartProps) {
  const [ref, width] = useChartWidth()
  const [hover, setHover] = useState<number | null>(null)
  const box: Box = { w: width, h: height, ml: 58, mr: 12, mt: 10, mb: 24 }

  const geo = useMemo(() => {
    const idx = downsampleIdx(dates.length, Math.min(maxPoints, Math.max(60, Math.floor(width / 1.2))))
    const x = scale(0, Math.max(1, idx.length - 1), box.ml, box.ml + plotW(box))
    const all: (number | null)[] = []
    for (const s of series) for (const i of idx) all.push(s.values[i])
    for (const b of bands) for (const i of idx) all.push(b.upper[i], b.lower[i])
    for (const r of refLines) all.push(r.value)
    const [lo, hi] = yDomain ?? extent(all)
    const y = scale(lo, hi, box.mt + plotH(box), box.mt)
    const px = idx.map((_, k) => x(k))
    return { idx, x, y, lo, hi, px }
    // box is derived from width/height
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, series, bands, refLines, width, height, maxPoints, yDomain])

  const { idx, x, y, lo, hi, px } = geo
  const xTicks = niceDateTicks(
    idx.map((i) => dates[i]),
    Math.max(3, Math.floor(width / 110)),
  )
  const yt = ticks(lo, hi, Math.max(3, Math.floor(height / 55)))

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const k = nearestIndex(px, e.clientX - rect.left)
    setHover(k >= 0 ? k : null)
  }

  const hi_ = hover !== null ? idx[hover] : null
  const rows: TooltipRow[] =
    hi_ === null
      ? []
      : [
          ...series
            .filter((s) => !s.quiet && s.values[hi_] != null)
            .map((s) => ({ label: s.label, value: yFormat(s.values[hi_] as number), color: s.color })),
          ...(tooltipExtra ? tooltipExtra(hi_) : []),
        ]
  const zeroY = y(Math.min(Math.max(0, lo), hi))

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-none">
        {yt.map((t) => (
          <g key={t}>
            <line x1={box.ml} x2={box.ml + plotW(box)} y1={y(t)} y2={y(t)} style={GRID} opacity={0.6} />
            <text x={box.ml - 6} y={y(t) + 3} textAnchor="end" style={AXIS_TEXT}>
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`${t.i}-${t.label}`} x={x(t.i)} y={height - 6} textAnchor="middle" style={AXIS_TEXT}>
            {t.label}
          </text>
        ))}
        {bands.map((b) => (
          <path
            key={b.key}
            d={bandPath(
              px,
              idx.map((i) => y(n(b.upper[i]))),
              idx.map((i) => y(n(b.lower[i]))),
            )}
            style={{ fill: b.color }}
            opacity={b.opacity}
          />
        ))}
        {refLines.map((r) => (
          <g key={`${r.value}-${r.label ?? ''}`}>
            <line x1={box.ml} x2={box.ml + plotW(box)} y1={y(r.value)} y2={y(r.value)} style={{ stroke: r.color }} strokeWidth={1} strokeDasharray={r.dash ?? '4 3'} opacity={0.8} />
            {r.label && (
              <text x={box.ml + plotW(box) - 4} y={y(r.value) - 3} textAnchor="end" style={{ ...AXIS_TEXT, fill: r.color }}>
                {r.label}
              </text>
            )}
          </g>
        ))}
        {series
          .filter((s) => s.fillToZero)
          .map((s) => (
            <path
              key={`${s.key}-fill`}
              d={bandPath(
                px,
                idx.map((i) => y(n(s.values[i]))),
                idx.map(() => zeroY),
              )}
              style={{ fill: s.color }}
              opacity={0.18}
            />
          ))}
        {series.map((s) => (
          <path
            key={s.key}
            d={linePath(idx.map((i, k) => [x(k), y(n(s.values[i]))]))}
            fill="none"
            style={{ stroke: s.color }}
            strokeWidth={s.width ?? 1.4}
            strokeDasharray={s.dash}
            opacity={s.opacity ?? 1}
          />
        ))}
        {hover !== null && (
          <g>
            <line x1={px[hover]} x2={px[hover]} y1={box.mt} y2={box.mt + plotH(box)} style={{ stroke: PALETTE.muted }} strokeWidth={1} opacity={0.6} />
            {series
              .filter((s) => !s.quiet && s.values[idx[hover]] != null)
              .map((s) => (
                <circle key={s.key} cx={px[hover]} cy={y(s.values[idx[hover]] as number)} r={3} style={{ fill: s.color }} />
              ))}
          </g>
        )}
      </svg>
      {hover !== null && hi_ !== null && <ChartTooltip x={px[hover]} y={box.mt} width={width} title={fmtDate(dates[hi_])} rows={rows} />}
    </div>
  )
}


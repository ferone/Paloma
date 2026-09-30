import { useState } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtUsdCompact } from '../design/format'
import { type Box, plotH, plotW, scale, ticks } from './util'
import { AXIS_TEXT, ChartTooltip, GRID, useChartWidth } from './frame'

export interface HistBin {
  from: number
  to: number
  count: number
}

/** Distribution of per-trade outcomes; bins left of zero are losses. */
export function OutcomeHistogram({ bins, height = 200, format = fmtUsdCompact, unit = 'trades' }: { bins: HistBin[]; height?: number; format?: (v: number) => string; unit?: string }) {
  const [ref, width] = useChartWidth()
  const [hover, setHover] = useState<number | null>(null)
  if (bins.length === 0) return null
  const box: Box = { w: width, h: height, ml: 40, mr: 10, mt: 10, mb: 24 }
  const maxC = Math.max(...bins.map((b) => b.count), 1)
  const bw = plotW(box) / bins.length
  const y = scale(0, maxC, box.mt + plotH(box), box.mt)
  const lo = bins[0].from
  const hi = bins[bins.length - 1].to
  const xv = scale(lo, hi, box.ml, box.ml + plotW(box))
  const total = bins.reduce((s, b) => s + b.count, 0)
  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={`Histogram of ${total} ${unit} outcomes`} onPointerLeave={() => setHover(null)} className="block">
        {ticks(0, maxC, 3).map((t) => (
          <g key={t}>
            <line x1={box.ml} x2={box.ml + plotW(box)} y1={y(t)} y2={y(t)} style={GRID} opacity={0.6} />
            <text x={box.ml - 6} y={y(t) + 3} textAnchor="end" style={AXIS_TEXT}>
              {t}
            </text>
          </g>
        ))}
        {bins.map((b, i) => {
          const mid = (b.from + b.to) / 2
          return (
            <rect
              key={i}
              x={box.ml + i * bw + 1}
              width={Math.max(1, bw - 2)}
              y={y(b.count)}
              height={Math.max(0, box.mt + plotH(box) - y(b.count))}
              style={{ fill: mid >= 0 ? PALETTE.pos : PALETTE.neg }}
              opacity={hover === i ? 0.95 : 0.7}
              onPointerEnter={() => setHover(i)}
            />
          )
        })}
        {lo < 0 && hi > 0 && <line x1={xv(0)} x2={xv(0)} y1={box.mt} y2={box.mt + plotH(box)} style={{ stroke: PALETTE.foreground }} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />}
        {[lo, 0, hi]
          .filter((v, i, a) => (v !== 0 || (lo < 0 && hi > 0)) && a.indexOf(v) === i)
          .map((v) => (
            <text key={v} x={xv(v)} y={height - 6} textAnchor="middle" style={AXIS_TEXT}>
              {format(v)}
            </text>
          ))}
      </svg>
      {hover !== null && (
        <ChartTooltip
          x={box.ml + hover * bw + bw / 2}
          y={box.mt}
          width={width}
          title={`${format(bins[hover].from)} to ${format(bins[hover].to)}`}
          rows={[
            { label: unit, value: String(bins[hover].count) },
            { label: 'share', value: `${Math.round((bins[hover].count / total) * 100)}%` },
          ]}
        />
      )}
    </div>
  )
}

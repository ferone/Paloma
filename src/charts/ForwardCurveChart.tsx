import { useState } from 'react'
import { PALETTE } from '../design/tokens'
import { fmtNum } from '../design/format'
import { type Box, extent, linePath, plotH, plotW, scale, ticks } from './util'
import { AXIS_TEXT, ChartLegend, ChartTooltip, GRID, useChartWidth, type TooltipRow } from './frame'

export interface CurveNode {
  /** Days from the curve date to the contract's last trade. */
  days: number
  label: string
  price: number
  /** Serial (inactive) months are drawn hollow. */
  active?: boolean
}

export interface CurveSeries {
  key: string
  label: string
  color: string
  dash?: boolean
  nodes: CurveNode[]
}

/**
 * Term structure: settlement price against time to expiry, one line per curve
 * (latest, a month ago, live). An upward slope is contango (futures above spot —
 * the cost of carry); a downward slope is backwardation (scarcity now).
 */
export function ForwardCurveChart({ curves, yFormat = (v) => fmtNum(v, 2), height = 260 }: { curves: CurveSeries[]; yFormat?: (v: number) => string; height?: number }) {
  const [ref, width] = useChartWidth()
  const [hover, setHover] = useState<{ c: number; i: number } | null>(null)
  const nodes = curves.flatMap((c) => c.nodes)
  if (nodes.length === 0) return null
  const box: Box = { w: width, h: height, ml: 60, mr: 16, mt: 16, mb: 30 }
  const [x0, x1] = extent(
    nodes.map((n) => n.days),
    0.04,
  )
  const [lo, hi] = extent(nodes.map((n) => n.price))
  const x = scale(Math.max(0, x0), x1, box.ml, box.ml + plotW(box))
  const y = scale(lo, hi, box.mt + plotH(box), box.mt)
  const main = curves[0]
  const rows: TooltipRow[] = []
  let title = ''
  if (hover) {
    const n = curves[hover.c].nodes[hover.i]
    title = `${n.label} · ${n.days} d`
    rows.push({ label: curves[hover.c].label, value: yFormat(n.price), color: curves[hover.c].color })
    if (hover.c === 0 && hover.i > 0) {
      const f = main.nodes.find((m) => m.active !== false) ?? main.nodes[0]
      rows.push({ label: 'vs front', value: `${fmtNum(((n.price - f.price) / f.price) * 100, 2)}%` })
    }
  }
  return (
    <figure>
      <div ref={ref} className="relative w-full">
        <svg width={width} height={height} role="img" aria-label={`Futures term structure: ${main.nodes.map((n) => `${n.label} ${yFormat(n.price)}`).join(', ')}`} onPointerLeave={() => setHover(null)} className="block">
          {ticks(lo, hi, 4).map((t) => (
            <g key={t}>
              <line x1={box.ml} x2={box.ml + plotW(box)} y1={y(t)} y2={y(t)} style={GRID} opacity={0.6} />
              <text x={box.ml - 6} y={y(t) + 3} textAnchor="end" style={AXIS_TEXT}>
                {yFormat(t)}
              </text>
            </g>
          ))}
          {curves.map((c, ci) => (
            <g key={c.key}>
              <path d={linePath(c.nodes.map((n) => [x(n.days), y(n.price)]))} fill="none" style={{ stroke: c.color }} strokeWidth={ci === 0 ? 2 : 1.3} strokeDasharray={c.dash ? '4 3' : undefined} opacity={ci === 0 ? 1 : 0.75} />
              {c.nodes.map((n, i) => (
                <circle
                  key={i}
                  cx={x(n.days)}
                  cy={y(n.price)}
                  r={hover?.c === ci && hover.i === i ? 5 : ci === 0 ? 3.5 : 2.5}
                  style={{ fill: n.active === false ? PALETTE.surface : c.color, stroke: c.color }}
                  strokeWidth={1.3}
                  onPointerEnter={() => setHover({ c: ci, i })}
                />
              ))}
            </g>
          ))}
          {main.nodes
            .filter((n) => n.active !== false)
            .map((n) => (
              <text key={n.label} x={x(n.days)} y={height - 8} textAnchor="middle" style={AXIS_TEXT}>
                {n.label}
              </text>
            ))}
        </svg>
        {hover && <ChartTooltip x={x(curves[hover.c].nodes[hover.i].days)} y={box.mt} width={width} title={title} rows={rows} />}
      </div>
      <ChartLegend items={[...curves.map((c) => ({ label: c.label, color: c.color, dash: c.dash })), { label: 'hollow = serial month', color: PALETTE.muted, faint: true }]} />
    </figure>
  )
}

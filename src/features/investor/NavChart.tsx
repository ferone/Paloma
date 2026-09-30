import { useMemo, useRef, useState, useLayoutEffect } from 'react'
import { PALETTE } from '../../design/tokens'
import { fmtDate, fmtNum } from '../../design/format'

interface Point {
  date: string
  fund: number
  benchmark: number | null
}

/**
 * Print-safe rebased NAV line chart (fund vs benchmark), hand-built SVG so it
 * renders crisply on paper and in both themes. Both series start at 100.
 */
export function NavChart({ series, benchmarkLabel, height = 220 }: { series: Point[]; benchmarkLabel: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const pad = { l: 40, r: 12, t: 10, b: 22 }
    const vals = series.flatMap((p) => (p.benchmark != null ? [p.fund, p.benchmark] : [p.fund]))
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
    if (hi - lo < 1e-9) {
      lo -= 1
      hi += 1
    }
    const span = hi - lo
    lo -= span * 0.06
    hi += span * 0.06
    const n = series.length
    const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (width - pad.l - pad.r))
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b)
    const path = (get: (p: Point) => number | null) => {
      let d = ''
      let pen = false
      series.forEach((p, i) => {
        const v = get(p)
        if (v == null || !Number.isFinite(v)) {
          pen = false
          return
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
        pen = true
      })
      return d
    }
    const ticks = Array.from({ length: 4 }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / 4)
    const xTicks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0]
    return { pad, x, y, ticks, xTicks, fund: path((p) => p.fund), bench: path((p) => p.benchmark), base: y(100) }
  }, [series, width, height])

  if (!geo || series.length < 2) return <p className="py-8 text-center text-xs text-muted">Not enough NAV history to chart yet.</p>

  return (
    <figure ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label={`NAV per unit versus ${benchmarkLabel}, both rebased to 100`} className="block">
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={geo.pad.l} x2={width - geo.pad.r} y1={geo.y(t)} y2={geo.y(t)} style={{ stroke: PALETTE.border }} strokeWidth={1} />
            <text x={geo.pad.l - 6} y={geo.y(t) + 3} textAnchor="end" className="num" style={{ fill: PALETTE.muted, fontSize: 10 }}>
              {fmtNum(t, 0)}
            </text>
          </g>
        ))}
        <line x1={geo.pad.l} x2={width - geo.pad.r} y1={geo.base} y2={geo.base} style={{ stroke: PALETTE.faint }} strokeDasharray="2 3" strokeWidth={1} />
        {geo.xTicks.map((i) => (
          <text key={i} x={geo.x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} style={{ fill: PALETTE.muted, fontSize: 10 }}>
            {fmtDate(series[i].date)}
          </text>
        ))}
        <path d={geo.bench} fill="none" style={{ stroke: PALETTE.muted }} strokeWidth={1.25} />
        <path d={geo.fund} fill="none" style={{ stroke: PALETTE.brand }} strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-2 flex gap-5 text-2xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: PALETTE.brand }} /> Fund NAV per unit
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: PALETTE.muted }} /> {benchmarkLabel}
        </span>
        <span>Both rebased to 100</span>
      </figcaption>
    </figure>
  )
}

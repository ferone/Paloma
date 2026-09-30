import { useEffect, useState, type ReactNode } from 'react'
import { PALETTE } from '../design/tokens'

/**
 * Measure an element's width with a ResizeObserver. Returns a callback ref and
 * the current width (a sane default until the first measurement, and in
 * environments without ResizeObserver, e.g. jsdom).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useChartWidth(fallback = 640): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}

export interface TooltipRow {
  label: string
  value: string
  color?: string
}

/** Hover card for a chart; positioned in the chart's pixel space. */
export function ChartTooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: TooltipRow[] }) {
  const left = x > width * 0.62 ? undefined : x + 12
  const right = x > width * 0.62 ? width - x + 12 : undefined
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-2xs shadow-lg"
      style={{ left, right, top: Math.max(0, y) }}
    >
      <div className="num mb-1 text-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted">
            {r.color && <span aria-hidden className="inline-block h-1.5 w-2.5 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface LegendItem {
  label: string
  color: string
  dash?: boolean
  area?: boolean
  faint?: boolean
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.area ? (
            <span aria-hidden className="h-2.5 w-4 rounded-sm" style={{ background: it.color, opacity: 0.25 }} />
          ) : (
            <svg width={16} height={6} aria-hidden>
              <line x1={0} y1={3} x2={16} y2={3} style={{ stroke: it.color }} strokeWidth={2} strokeDasharray={it.dash ? '3 2' : undefined} opacity={it.faint ? 0.5 : 1} />
            </svg>
          )}
          {it.label}
        </span>
      ))}
    </div>
  )
}

/** Axis text style shared by every chart. */
export const AXIS_TEXT = { fill: PALETTE.muted, fontSize: 10, fontFamily: 'var(--font-mono)' } as const
export const GRID = { stroke: PALETTE.border, strokeWidth: 0.5 } as const

/** Empty-plot placeholder with the same footprint as a chart. */
export function ChartEmpty({ height = 200, children }: { height?: number; children: ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted" style={{ height }}>
      {children}
    </div>
  )
}

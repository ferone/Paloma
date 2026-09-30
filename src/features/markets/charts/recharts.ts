import type { CSSProperties } from 'react'
import type { ChartTheme } from './chartTheme'

/** Shared recharts styling from the resolved theme (axes, grid, tooltip). */
export function rechartsStyle(t: ChartTheme) {
  const tick = { fill: t.muted, fontSize: 10, fontFamily: t.font }
  const tooltip: { contentStyle: CSSProperties; labelStyle: CSSProperties; itemStyle: CSSProperties; cursor: { stroke: string } } = {
    contentStyle: {
      background: t.surface3,
      border: `1px solid ${t.border}`,
      borderRadius: 6,
      fontSize: 11,
      fontFamily: t.font,
      padding: '6px 8px',
    },
    labelStyle: { color: t.muted, marginBottom: 2 },
    itemStyle: { color: t.foreground, padding: 0 },
    cursor: { stroke: t.faint },
  }
  return {
    tick,
    grid: { stroke: t.border, strokeDasharray: '2 4', vertical: false },
    axisLine: { stroke: t.border },
    tooltip,
  }
}

/** Short date tick: "Sep 30" for daily data, "Sep 26" (month year) for long spans. */
export function dateTick(long: boolean) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return (iso: string) => {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return String(iso)
    return long ? `${M[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}` : `${M[d.getUTCMonth()]} ${d.getUTCDate()}`
  }
}

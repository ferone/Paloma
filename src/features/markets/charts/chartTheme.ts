import { useMemo, useSyncExternalStore } from 'react'
import { cssVar } from '../../../design/tokens'

// Canvas (lightweight-charts) and recharts need concrete colours, and
// lightweight-charts can't parse the oklch() values our tokens resolve to.
// Resolve each token through a 1×1 canvas into rgba(), and re-resolve when
// the <html> theme class flips (observed directly, so we never read the old
// theme's values in the render that follows the toggle).

let ctx: CanvasRenderingContext2D | null | undefined

/** Any CSS colour → "rgba(r, g, b, a)"; returns the input if canvas is unavailable (tests). */
export function toRgba(color: string, alpha = 1): string {
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true }) ?? null
    } catch {
      ctx = null
    }
  }
  if (!ctx || !color) return color
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * alpha * 1000) / 1000})`
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}
const mode = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

export interface ChartTheme {
  mode: 'dark' | 'light'
  foreground: string
  muted: string
  faint: string
  border: string
  surface: string
  surface3: string
  brand: string
  pos: string
  neg: string
  gold: string
  silver: string
  modeled: string
  series: string[]
  font: string
  /** Same colour with a different alpha. */
  alpha: (color: string, a: number) => string
}

export const CHART_FONT = "'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace"

/** Resolved chart colours for the current theme. */
export function useChartTheme(): ChartTheme {
  const m = useSyncExternalStore(subscribe, mode, () => 'dark' as const)
  return useMemo(() => {
    const c = (name: string) => toRgba(cssVar(name))
    return {
      mode: m,
      foreground: c('--foreground'),
      muted: c('--muted'),
      faint: c('--faint'),
      border: c('--border'),
      surface: c('--surface'),
      surface3: c('--surface-3'),
      brand: c('--brand'),
      pos: c('--pos'),
      neg: c('--neg'),
      gold: c('--metal-gold'),
      silver: c('--metal-silver'),
      modeled: c('--modeled'),
      series: [1, 2, 3, 4, 5, 6].map((i) => c(`--series-${i}`)),
      font: CHART_FONT,
      alpha: (color: string, a: number) => toRgba(color, a),
    }
  }, [m])
}

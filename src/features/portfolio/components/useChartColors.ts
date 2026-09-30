import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '../../../app/theme'
import { cssVar } from '../../../design/tokens'

/**
 * Concrete colours for recharts (SVG presentation attributes can't read var()).
 * Re-resolved whenever the theme class on <html> actually changes — a
 * MutationObserver fires after ThemeProvider's effect has toggled the class.
 */
export function useChartColors() {
  const { theme } = useTheme()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const mo = new MutationObserver(() => setTick((t) => t + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return useMemo(() => {
    void tick
    void theme
    return {
      brand: cssVar('--brand'),
      foreground: cssVar('--foreground'),
      muted: cssVar('--muted'),
      faint: cssVar('--faint'),
      border: cssVar('--border'),
      surface: cssVar('--surface'),
      surface3: cssVar('--surface-3'),
      pos: cssVar('--pos'),
      neg: cssVar('--neg'),
      gold: cssVar('--metal-gold'),
      silver: cssVar('--metal-silver'),
      series2: cssVar('--series-2'),
      series3: cssVar('--series-3'),
    }
  }, [tick, theme])
}

export type ChartColors = ReturnType<typeof useChartColors>

import { useMemo } from 'react'
import type { ChangeKind, SeriesUnit, SeriesPoint, Stance } from '@shared/macro'
import { fmtNum, fmtPctSigned, fmtSigned, fmtUsd } from '../../design/format'
import { cssVar } from '../../design/tokens'
import { useTheme } from '../../app/theme'

/** Level formatting per unit. */
export function fmtLevel(v: number | null | undefined, unit: SeriesUnit): string {
  if (v == null) return fmtNum(v)
  switch (unit) {
    case 'percent':
      return `${fmtNum(v, 2)}%`
    case 'usd':
      return fmtUsd(v, v >= 1000 ? 0 : 2)
    case 'usd_bn':
      return `$${fmtNum(v / 1000, 2)}T`
    case 'ratio':
      return fmtNum(v, 1)
    default:
      return fmtNum(v, 2)
  }
}

/** Change formatting: pp for rates (bp below 1pp would be noisier to read), % for levels. */
export function fmtChange(v: number | null | undefined, kind: ChangeKind, unit: SeriesUnit): string {
  if (v == null) return fmtNum(v)
  if (kind === 'pct') return fmtPctSigned(v, 1)
  return unit === 'percent' ? `${fmtSigned(v, 2)}pp` : fmtSigned(v, 2)
}

export const STANCE_TONE: Record<Stance, 'strong' | 'avoid' | 'neutral'> = {
  tailwind: 'strong',
  headwind: 'avoid',
  neutral: 'neutral',
}

export const STANCE_LABEL: Record<Stance, string> = {
  tailwind: 'Tailwind',
  headwind: 'Headwind',
  neutral: 'Neutral',
}

/**
 * Chart colours resolved from CSS variables (recharts writes SVG attributes,
 * which cannot read var()). Re-resolves whenever the theme flips.
 */
export function useChartColors() {
  const { theme } = useTheme()
  return useMemo(() => {
    void theme
    const v = (n: string) => cssVar(n) || 'currentColor'
    return {
      theme,
      grid: v('--border'),
      axis: v('--faint'),
      text: v('--muted'),
      fg: v('--foreground'),
      surface: v('--surface'),
      gold: v('--metal-gold'),
      silver: v('--metal-silver'),
      brand: v('--brand'),
      pos: v('--pos'),
      neg: v('--neg'),
      series: [1, 2, 3, 4, 5, 6].map((i) => v(`--series-${i}`)),
      bandCrowded: v('--tier-avoid'),
      bandWashed: v('--tier-strong'),
    }
  }, [theme])
}

/** Evenly thin a series to at most `max` points (keeps the last point). */
export function thin<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs
  const step = Math.ceil(xs.length / max)
  const out = xs.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== xs[xs.length - 1]) out.push(xs[xs.length - 1])
  return out
}

/**
 * Join a driver series onto the metal's dates, forward-filling the driver
 * (monthly/holiday gaps). Only dates where both are known are returned.
 */
export function joinForwardFill(base: SeriesPoint[], other: SeriesPoint[]): { date: string; a: number; b: number }[] {
  const out: { date: string; a: number; b: number }[] = []
  let j = 0
  let last: number | null = null
  for (const p of base) {
    while (j < other.length && other[j].date <= p.date) last = other[j++].value
    if (last != null) out.push({ date: p.date, a: p.value, b: last })
  }
  return out
}

export function isoYearsAgo(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

/** Axis tick: "Sep 26". */
export function tickMonth(iso: string): string {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]
  return `${m} ${iso.slice(2, 4)}`
}

/**
 * Pearson correlation of daily changes (metal log-return vs driver first
 * difference) over the overlapping window. Levels would be spuriously
 * correlated by shared trends; changes are what the stance rules reason about.
 */
export function changeCorrelation(metal: SeriesPoint[], driver: SeriesPoint[]): { rho: number; n: number } | null {
  const joined = joinForwardFill(metal, driver)
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 1; i < joined.length; i++) {
    const prev = joined[i - 1]
    const cur = joined[i]
    if (!(prev.a > 0 && cur.a > 0) || !Number.isFinite(prev.b) || !Number.isFinite(cur.b)) continue
    const dy = cur.b - prev.b
    if (dy === 0) continue // forward-filled (e.g. monthly or holiday) — no new information that day
    xs.push(Math.log(cur.a / prev.a))
    ys.push(dy)
  }
  const n = xs.length
  if (n < 30) return null
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  if (sxx === 0 || syy === 0) return null
  return { rho: sxy / Math.sqrt(sxx * syy), n }
}

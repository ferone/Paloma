import type { ChangeKind, SeriesPoint } from '../../shared/macro.js'

// Pure statistics for the macro domain. All series are ascending by date.

/** ISO date `months` calendar months before `iso` (day clamped to month end). */
export function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) - months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Last point with date ≤ `iso`, or null. Binary search. */
export function valueAtOrBefore(points: SeriesPoint[], iso: string): SeriesPoint | null {
  let lo = 0
  let hi = points.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].date <= iso) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans >= 0 ? points[ans] : null
}

/**
 * Change of the latest observation vs the observation on/before (latest date − N months).
 * 'diff' → absolute difference; 'pct' → fractional change (0.012 = +1.2%).
 */
export function changeOver(points: SeriesPoint[], months: number, kind: ChangeKind): number | null {
  if (points.length < 2) return null
  const last = points[points.length - 1]
  const prior = valueAtOrBefore(points, monthsBefore(last.date, months))
  if (!prior || prior.date === last.date) return null
  if (kind === 'diff') return last.value - prior.value
  return prior.value === 0 ? null : last.value / prior.value - 1
}

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Sample standard deviation (n − 1). 0 for fewer than two values. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/** z-score of the last value vs the whole window (inclusive). null if < minN or zero variance. */
export function zScoreLast(values: number[], minN = 10): number | null {
  if (values.length < minN) return null
  const sd = stdev(values)
  if (sd === 0) return null
  return (values[values.length - 1] - mean(values)) / sd
}

/** Percentile rank (0..1) of the last value within the window: share of values ≤ it. */
export function percentileLast(values: number[], minN = 10): number | null {
  if (values.length < minN) return null
  const last = values[values.length - 1]
  return values.filter((v) => v <= last).length / values.length
}

/** Points in the trailing `years` window ending at the last observation (inclusive). */
export function trailingYears(points: SeriesPoint[], years: number): SeriesPoint[] {
  if (points.length === 0) return []
  const from = monthsBefore(points[points.length - 1].date, years * 12)
  return points.filter((p) => p.date > from)
}

/** Daily log returns keyed by date (the return INTO that date). Skips non-positive prices. */
export function logReturns(points: SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].value
    const b = points[i].value
    if (a > 0 && b > 0) out.push({ date: points[i].date, value: Math.log(b / a) })
  }
  return out
}

/** Day-over-day absolute differences keyed by date. */
export function diffs(points: SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let i = 1; i < points.length; i++) out.push({ date: points[i].date, value: points[i].value - points[i - 1].value })
  return out
}

/**
 * Inner-join several date-keyed series. Returns the common dates (ascending)
 * and one aligned value column per input.
 */
export function align(series: SeriesPoint[][]): { dates: string[]; cols: number[][] } {
  if (series.length === 0) return { dates: [], cols: [] }
  const maps = series.map((s) => new Map(s.map((p) => [p.date, p.value])))
  const dates = series[0].map((p) => p.date).filter((d) => maps.every((m) => m.has(d)))
  return { dates, cols: maps.map((m) => dates.map((d) => m.get(d)!)) }
}

/** Pearson correlation. null when n < 3 or either side has zero variance. */
export function correlation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    sx += x[i]
    sy += y[i]
  }
  const mx = sx / n
  const my = sy / n
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    cov += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  if (vx === 0 || vy === 0) return null
  return cov / Math.sqrt(vx * vy)
}

/** OLS slope of y on x (beta of y to x). null when n < 3 or var(x) = 0. */
export function beta(y: number[], x: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let cov = 0
  let vx = 0
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my)
    vx += (x[i] - mx) ** 2
  }
  return vx === 0 ? null : cov / vx
}

/**
 * Rolling Pearson correlation over `window` aligned observations. Output[i]
 * covers observations (i − window, i]; entries before a full window are null.
 * O(n) with running sums.
 */
export function rollingCorrelation(x: number[], y: number[], window: number): (number | null)[] {
  const n = Math.min(x.length, y.length)
  const out: (number | null)[] = new Array(n).fill(null)
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += x[i]
    sy += y[i]
    sxx += x[i] * x[i]
    syy += y[i] * y[i]
    sxy += x[i] * y[i]
    if (i >= window) {
      const j = i - window
      sx -= x[j]
      sy -= y[j]
      sxx -= x[j] * x[j]
      syy -= y[j] * y[j]
      sxy -= x[j] * y[j]
    }
    if (i >= window - 1) {
      const cov = sxy - (sx * sy) / window
      const vx = sxx - (sx * sx) / window
      const vy = syy - (sy * sy) / window
      out[i] = vx > 1e-18 && vy > 1e-18 ? Math.max(-1, Math.min(1, cov / Math.sqrt(vx * vy))) : null
    }
  }
  return out
}

import { PALETTE } from '../design/tokens'

// Pure geometry helpers for the SVG chart library (ported from CommodityFutures
// components/charts/util.ts). No React, no DOM.

export interface Box {
  w: number
  h: number
  ml: number
  mr: number
  mt: number
  mb: number
}

export const plotW = (b: Box): number => Math.max(1, b.w - b.ml - b.mr)
export const plotH = (b: Box): number => Math.max(1, b.h - b.mt - b.mb)

/** Linear scale: maps [d0,d1] → [r0,r1]. */
export function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1
  return (v) => r0 + ((v - d0) / span) * (r1 - r0)
}

/** Padded [min,max] over finite values. */
export function extent(values: (number | null | undefined)[], pad = 0.06): [number, number] {
  const fin = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (fin.length === 0) return [0, 1]
  let lo = fin[0]
  let hi = fin[0]
  for (const v of fin) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (lo === hi) {
    const d = Math.abs(lo) || 1
    return [lo - d * 0.1, hi + d * 0.1]
  }
  const p = (hi - lo) * pad
  return [lo - p, hi + p]
}

/** SVG polyline path from [x,y] points, breaking on non-finite y (gaps). */
export function linePath(points: [number, number][]): string {
  let d = ''
  let pen = false
  for (const [x, y] of points) {
    if (!Number.isFinite(y) || !Number.isFinite(x)) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `
    pen = true
  }
  return d.trim()
}

/** Line path over day-of-year points that breaks across gaps > `maxGap` days. */
export function doyLinePath(
  points: { doy: number; value: number }[],
  x: (d: number) => number,
  y: (v: number) => number,
  maxGap = 21,
): string {
  const sorted = [...points].sort((a, b) => a.doy - b.doy)
  const pts: [number, number][] = []
  let prev = -Infinity
  for (const p of sorted) {
    if (pts.length && p.doy - prev > maxGap) pts.push([x(p.doy), NaN])
    pts.push([x(p.doy), y(p.value)])
    prev = p.doy
  }
  return linePath(pts)
}

/** Filled band between upper and lower (aligned by x); skips non-finite columns. */
export function bandPath(xs: number[], upper: number[], lower: number[]): string {
  const segs: { x: number; u: number; l: number }[][] = []
  let cur: { x: number; u: number; l: number }[] = []
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(upper[i]) && Number.isFinite(lower[i])) cur.push({ x: xs[i], u: upper[i], l: lower[i] })
    else if (cur.length) {
      segs.push(cur)
      cur = []
    }
  }
  if (cur.length) segs.push(cur)
  let d = ''
  for (const seg of segs) {
    if (seg.length < 2) continue
    d += `M${seg[0].x.toFixed(1)},${seg[0].u.toFixed(1)} `
    for (let i = 1; i < seg.length; i++) d += `L${seg[i].x.toFixed(1)},${seg[i].u.toFixed(1)} `
    for (let i = seg.length - 1; i >= 0; i--) d += `L${seg[i].x.toFixed(1)},${seg[i].l.toFixed(1)} `
    d += 'Z '
  }
  return d.trim()
}

/** Indices striding a long array down to ≤ max points (always keeps the last). */
export function downsampleIdx(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const step = (n - 1) / (max - 1)
  const out: number[] = []
  for (let i = 0; i < max - 1; i++) out.push(Math.round(i * step))
  out.push(n - 1)
  return out
}

/** "Nice" round ticks across [lo,hi]. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag
  const start = Math.ceil(lo / step) * step
  const out: number[] = []
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(8)))
  return out
}

/** Diverging fill for a signed value, saturating at ±scaleMax (pos/neg tokens). */
export function divergingColor(v: number | null | undefined, scaleMax: number): string {
  if (v == null || !Number.isFinite(v)) return 'transparent'
  const t = Math.round(Math.min(1, Math.abs(v) / (scaleMax || 1)) * 85)
  return `color-mix(in oklch, ${PALETTE.surface2}, ${v >= 0 ? PALETTE.pos : PALETTE.neg} ${t}%)`
}

/** Diverging fill for a win-rate 0..1 (0.5 neutral). */
export function winColor(w: number | null | undefined): string {
  if (w == null || !Number.isFinite(w)) return PALETTE.surface2
  return divergingColor(w - 0.5, 0.5)
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Date ticks at month starts, thinned to ≈target; year boundaries get the year. */
export function niceDateTicks(dates: string[], target = 6): { i: number; label: string }[] {
  if (dates.length === 0) return []
  const firsts: { i: number; year: string; month: number }[] = []
  let prev = ''
  for (let i = 0; i < dates.length; i++) {
    const ym = dates[i].slice(0, 7)
    if (ym !== prev) {
      firsts.push({ i, year: dates[i].slice(0, 4), month: Number(dates[i].slice(5, 7)) })
      prev = ym
    }
  }
  const years = new Set(firsts.map((f) => f.year)).size
  // Long spans: one tick per year (or every k years).
  if (years > target) {
    const jan = firsts.filter((f, k) => k === 0 || f.year !== firsts[k - 1].year)
    const stride = Math.max(1, Math.ceil(jan.length / target))
    return jan.filter((_, k) => k % stride === 0).map((f) => ({ i: f.i, label: f.year }))
  }
  const stride = Math.max(1, Math.ceil(firsts.length / target))
  const out: { i: number; label: string }[] = []
  let lastYear = ''
  for (let k = 0; k < firsts.length; k += stride) {
    const f = firsts[k]
    out.push({ i: f.i, label: f.year !== lastYear ? `${MON[f.month - 1]} ’${f.year.slice(-2)}` : MON[f.month - 1] })
    lastYear = f.year
  }
  return out
}

/** Index of the nearest value in an ascending array. */
export function nearestIndex(xs: number[], px: number): number {
  if (xs.length === 0) return -1
  let lo = 0
  let hi = xs.length - 1
  if (px <= xs[0]) return 0
  if (px >= xs[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < px) lo = mid
    else hi = mid
  }
  return px - xs[lo] <= xs[hi] - px ? lo : hi
}

/** Calendar label for a day-of-year on an axis starting at originDoy, e.g. "12 Mar". */
export function doyToLabel(doy: number, originDoy = 1): string {
  const cal = originDoy <= 1 ? doy : ((doy - 1 + originDoy - 1) % 366) + 1
  const d = new Date(Date.UTC(2021, 0, Math.max(1, Math.min(365, Math.round(cal)))))
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`
}

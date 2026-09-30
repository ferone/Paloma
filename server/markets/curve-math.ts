// Pure term-structure math. No I/O: unit-tested in curve-math.test.ts.
import type { CurveShape } from '../../shared/markets.js'

const DAY_MS = 86_400_000

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD or ISO). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from.length === 10 ? `${from}T00:00:00Z` : from)
  const b = Date.parse(to.length === 10 ? `${to}T00:00:00Z` : to)
  return Math.round((b - a) / DAY_MS)
}

/**
 * Simple annualized carry between two futures (ACT/360, the money-market
 * convention used by T-bill and financing rates):
 *   (far / near − 1) × 360 / days
 * Positive = contango (far > near). This is the implied financing rate the
 * curve pays for holding metal over that interval.
 */
export function annualizedCarry(nearPrice: number, farPrice: number, days: number): number | null {
  if (!(nearPrice > 0) || !(farPrice > 0) || !Number.isFinite(days) || days === 0) return null
  return (farPrice / nearPrice - 1) * (360 / days)
}

export interface CurvePointInput {
  /** Days from today to expiry. */
  days: number
  price: number
}

export interface CurveClassification {
  shape: CurveShape
  /** Carry from the first point to the point nearest `horizonDays` after it. */
  termCarry: number | null
  /** Share of consecutive segments that slope upward (0–1). */
  upShare: number | null
}

/**
 * Classify a curve from its live points (sorted or not). `flatBand` is the
 * annualized carry below which the curve counts as flat (default 25 bp).
 * - contango: term carry above the band and ≥ 75% of segments upward
 * - backwardation: term carry below −band and ≥ 75% of segments downward
 * - mixed: a clear term carry but kinks in between
 */
export function classifyCurve(points: CurvePointInput[], flatBand = 0.0025, horizonDays = 365): CurveClassification {
  const pts = points.filter((p) => p.price > 0 && Number.isFinite(p.days)).sort((a, b) => a.days - b.days)
  if (pts.length < 2) return { shape: 'insufficient', termCarry: null, upShare: null }

  const first = pts[0]
  const target = first.days + horizonDays
  let far = pts[1]
  for (const p of pts.slice(1)) if (Math.abs(p.days - target) < Math.abs(far.days - target)) far = p
  const termCarry = annualizedCarry(first.price, far.price, far.days - first.days)

  let up = 0
  let down = 0
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].price - pts[i - 1].price
    if (d > 0) up++
    else if (d < 0) down++
  }
  const segments = pts.length - 1
  const upShare = up / segments

  if (termCarry == null || Math.abs(termCarry) < flatBand) return { shape: 'flat', termCarry, upShare }
  if (termCarry > 0 && up / segments >= 0.75) return { shape: 'contango', termCarry, upShare }
  if (termCarry < 0 && down / segments >= 0.75) return { shape: 'backwardation', termCarry, upShare }
  return { shape: 'mixed', termCarry, upShare }
}

/** Index of the benchmark contract: highest open interest, then highest volume, then nearest. */
export function pickReference(rows: { openInterest: number | null; volume: number | null }[]): number {
  if (rows.length === 0) return -1
  let best = 0
  const score = (r: { openInterest: number | null; volume: number | null }) => [r.openInterest ?? -1, r.volume ?? -1]
  for (let i = 1; i < rows.length; i++) {
    const [oi, vol] = score(rows[i])
    const [boi, bvol] = score(rows[best])
    if (oi > boi || (oi === boi && vol > bvol)) best = i
  }
  return best
}

/** Contract months to request: every active month from this month for `horizonMonths`. */
export function upcomingContractMonths(
  activeMonths: number[],
  today: Date,
  horizonMonths = 24,
): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = []
  let y = today.getUTCFullYear()
  let m = today.getUTCMonth() + 1
  for (let i = 0; i <= horizonMonths; i++) {
    if (activeMonths.includes(m)) out.push({ month: m, year: y })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

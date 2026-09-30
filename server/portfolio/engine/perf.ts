// Pure performance and risk statistics. Returns are simple daily fractions.
// Conventions: 252 trading days/yr for volatility; calendar days (365.25) for
// annualizing total returns; sample standard deviation (n − 1).

export const TRADING_DAYS = 252
const DAY_MS = 86_400_000

export interface DatedValue {
  date: string
  value: number
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export function simpleReturns(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i++) out.push(values[i - 1] !== 0 ? values[i] / values[i - 1] - 1 : 0)
  return out
}

/** Chain-link daily returns: Π(1 + r) − 1. */
export function chainLink(returns: number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1
}

/**
 * Flow-adjusted daily TWR with end-of-day flows:
 * r_t = (NAV_t − F_t) / NAV_{t−1} − 1. Days with NAV_{t−1} = 0 are skipped.
 */
export function twrDailyReturns(navs: number[], flows: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < navs.length; i++) {
    if (navs[i - 1] <= 0) continue
    out.push((navs[i] - flows[i]) / navs[i - 1] - 1)
  }
  return out
}

export function annualize(totalReturn: number, calendarDays: number): number {
  if (calendarDays <= 0 || totalReturn <= -1) return NaN
  return (1 + totalReturn) ** (365.25 / calendarDays) - 1
}

export function annualizedVol(returns: number[]): number {
  return stdev(returns) * Math.sqrt(TRADING_DAYS)
}

export function sharpe(returns: number[], rfAnnual = 0): number {
  const rf = rfAnnual / TRADING_DAYS
  const ex = returns.map((r) => r - rf)
  const sd = stdev(ex)
  return sd > 0 ? (mean(ex) / sd) * Math.sqrt(TRADING_DAYS) : NaN
}

/** Sortino: mean excess return over downside deviation (target = rf), annualized. */
export function sortino(returns: number[], rfAnnual = 0): number {
  if (returns.length < 2) return NaN
  const rf = rfAnnual / TRADING_DAYS
  const ex = returns.map((r) => r - rf)
  const dd = Math.sqrt(ex.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / ex.length)
  return dd > 0 ? (mean(ex) / dd) * Math.sqrt(TRADING_DAYS) : NaN
}

export interface DrawdownResult {
  series: DatedValue[]
  maxDrawdown: number
  peakDate: string | null
  troughDate: string | null
  recoveryDate: string | null
  durationDays: number | null
  current: number
}

/** Drawdown from the running peak (values ≤ 0), plus the worst episode. */
export function drawdowns(points: DatedValue[]): DrawdownResult {
  const series: DatedValue[] = []
  let peak = -Infinity
  let peakDate: string | null = null
  let max = 0
  let mdPeak: string | null = null
  let mdTrough: string | null = null
  for (const p of points) {
    if (p.value > peak) {
      peak = p.value
      peakDate = p.date
    }
    const dd = peak > 0 ? p.value / peak - 1 : 0
    series.push({ date: p.date, value: dd })
    if (dd < max) {
      max = dd
      mdPeak = peakDate
      mdTrough = p.date
    }
  }
  let recovery: string | null = null
  if (mdTrough) {
    const peakValue = points.find((p) => p.date === mdPeak)!.value
    recovery = points.find((p) => p.date > mdTrough! && p.value >= peakValue)?.date ?? null
  }
  const last = points.at(-1)?.date ?? null
  return {
    series,
    maxDrawdown: max,
    peakDate: mdPeak,
    troughDate: mdTrough,
    recoveryDate: recovery,
    durationDays: mdPeak ? daysBetween(mdPeak, recovery ?? last!) : null,
    current: series.at(-1)?.value ?? 0,
  }
}

/** Quantile with linear interpolation between order statistics (R type 7). */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const h = (s.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  return s[lo] + (h - lo) * (s[hi] - s[lo])
}

/** Historical VaR/CVaR as positive loss fractions at `confidence` (e.g. 0.95). */
export function historicalVar(returns: number[], confidence: number): { var: number; cvar: number } {
  if (returns.length === 0) return { var: NaN, cvar: NaN }
  const q = quantile(returns, 1 - confidence)
  const tail = returns.filter((r) => r <= q)
  return { var: -q, cvar: -mean(tail.length ? tail : [q]) }
}

/** Standard normal pdf. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) return -normInv(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** Gaussian VaR/CVaR (positive loss fractions) from sample mean and stdev. */
export function parametricVar(returns: number[], confidence: number): { var: number; cvar: number } {
  const mu = mean(returns)
  const sd = stdev(returns)
  if (!Number.isFinite(sd)) return { var: NaN, cvar: NaN }
  const z = normInv(confidence)
  return { var: -(mu - z * sd), cvar: -(mu - (sd * normPdf(z)) / (1 - confidence)) }
}

export function betaCorrelation(asset: number[], bench: number[]): { beta: number; correlation: number; n: number } {
  const n = Math.min(asset.length, bench.length)
  if (n < 3) return { beta: NaN, correlation: NaN, n }
  const x = asset.slice(0, n)
  const y = bench.slice(0, n)
  const mx = mean(x)
  const my = mean(y)
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my)
    vx += (x[i] - mx) ** 2
    vy += (y[i] - my) ** 2
  }
  return { beta: vy > 0 ? cov / vy : NaN, correlation: vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN, n }
}

/** Rolling annualized volatility over `window` daily returns. */
export function rollingVol(returns: DatedValue[], window = 63): DatedValue[] {
  const out: DatedValue[] = []
  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1).map((r) => r.value)
    out.push({ date: returns[i].date, value: annualizedVol(slice) })
  }
  return out
}

/**
 * XIRR: the annual rate r with Σ amount_i / (1 + r)^(days_i/365) = 0. Investor
 * perspective: contributions negative, distributions and terminal value positive.
 * Newton's method with a bisection fallback. NaN when no sign change.
 */
export function xirr(flows: { date: string; amount: number }[]): number {
  const fs = flows.filter((f) => f.amount !== 0)
  if (fs.length < 2 || !fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return NaN
  const t0 = fs.reduce((m, f) => (f.date < m ? f.date : m), fs[0].date)
  const ts = fs.map((f) => daysBetween(t0, f.date) / 365)
  const npv = (r: number) => fs.reduce((s, f, i) => s + f.amount / (1 + r) ** ts[i], 0)
  const dnpv = (r: number) => fs.reduce((s, f, i) => s - (ts[i] * f.amount) / (1 + r) ** (ts[i] + 1), 0)

  let r = 0.1
  for (let i = 0; i < 100; i++) {
    const v = npv(r)
    const d = dnpv(r)
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break
    const next = r - v / d
    if (!Number.isFinite(next) || next <= -0.9999) break
    if (Math.abs(next - r) < 1e-10) return next
    r = next
  }
  let lo = -0.9999
  let hi = 10
  let flo = npv(lo)
  const fhi = npv(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return NaN
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    const fm = npv(mid)
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-12) return mid
    if (flo * fm < 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return (lo + hi) / 2
}

export interface MonthlyRow {
  year: number
  months: (number | null)[]
  ytd: number | null
}

/**
 * Year × month return matrix from a daily value series. Each month compares
 * its last value to the previous month's last value (the first month compares
 * to `startValue`, e.g. the base NAV/unit, or else to its first value).
 */
export function monthlyReturns(points: DatedValue[], startValue?: number): MonthlyRow[] {
  if (points.length === 0) return []
  const monthEnds = new Map<string, number>()
  for (const p of points) monthEnds.set(p.date.slice(0, 7), p.value)
  const keys = [...monthEnds.keys()].sort()
  const rows = new Map<number, MonthlyRow>()
  let prev = startValue ?? points[0].value
  const yearStart = new Map<number, number>()
  for (const k of keys) {
    const year = Number(k.slice(0, 4))
    const month = Number(k.slice(5, 7))
    const v = monthEnds.get(k)!
    if (!rows.has(year)) {
      rows.set(year, { year, months: Array(12).fill(null), ytd: null })
      yearStart.set(year, prev)
    }
    const row = rows.get(year)!
    row.months[month - 1] = prev ? v / prev - 1 : null
    row.ytd = yearStart.get(year) ? v / yearStart.get(year)! - 1 : null
    prev = v
  }
  return [...rows.values()].sort((a, b) => b.year - a.year)
}

/**
 * Return from the last value on or before `startExclusive` (or `fallbackBase`
 * when the series starts after it) to the last value.
 */
export function returnSince(points: DatedValue[], startExclusive: string, fallbackBase?: number): number | null {
  if (points.length === 0) return null
  const last = points[points.length - 1].value
  let base: number | undefined
  for (const p of points) {
    if (p.date <= startExclusive) base = p.value
    else break
  }
  base ??= fallbackBase
  return base ? last / base - 1 : null
}

/** Align a (carry-forward) benchmark series onto `dates`. */
export function alignSeries(dates: string[], series: DatedValue[]): (number | null)[] {
  const out: (number | null)[] = []
  let j = 0
  let last: number | null = null
  for (const d of dates) {
    while (j < series.length && series[j].date <= d) last = series[j++].value
    out.push(last)
  }
  return out
}

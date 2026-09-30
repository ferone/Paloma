// Pure ETF analytics (premium/discount, period returns, tracking). Unit-tested in etf-math.test.ts.

export interface Bar {
  /** YYYY-MM-DD */
  date: string
  close: number
}

/** Premium (+) or discount (−) of the market price to NAV, as a fraction. */
export function premiumToNav(price: number | null | undefined, nav: number | null | undefined): number | null {
  if (price == null || nav == null || !(price > 0) || !(nav > 0)) return null
  return price / nav - 1
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Pairs of closes on dates present in both series, sorted by date. */
export function alignCloses(a: Bar[], b: Bar[]): { date: string; a: number; b: number }[] {
  const mb = new Map(b.map((x) => [x.date, x.close]))
  return a
    .filter((x) => mb.has(x.date) && x.close > 0 && (mb.get(x.date) as number) > 0)
    .map((x) => ({ date: x.date, a: x.close, b: mb.get(x.date) as number }))
    .sort((x, y) => x.date.localeCompare(y.date))
}

/**
 * Modeled NAV when no NAV is published (closed-end trusts such as PHYS/PSLV):
 * assume the trust's metal per share equals the median of (ETF close ÷ spot
 * close) over the supplied window, then value it at the current spot price.
 * The resulting "premium" is relative to the trust's own typical ratio, not
 * to its published NAV — it is labelled Modeled in the UI.
 */
export function modeledNav(etf: Bar[], spot: Bar[], spotNow: number | null | undefined): number | null {
  if (spotNow == null || !(spotNow > 0)) return null
  const pairs = alignCloses(etf, spot)
  if (pairs.length < 20) return null
  const ratio = median(pairs.map((p) => p.a / p.b))
  return ratio == null ? null : ratio * spotNow
}

/**
 * Return from the last close on or before `from` to the latest close.
 * If the series starts after `from` by more than `toleranceDays`, returns null
 * (the instrument didn't exist / data is too short for that window).
 */
export function returnSince(bars: Bar[], from: string, toleranceDays = 6): number | null {
  if (bars.length < 2) return null
  const last = bars[bars.length - 1]
  let base: Bar | null = null
  for (const b of bars) {
    if (b.date <= from) base = b
    else break
  }
  if (!base) {
    const first = bars[0]
    const gap = (Date.parse(`${first.date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    if (gap > toleranceDays) return null
    base = first
  }
  if (!(base.close > 0) || base === last) return null
  return last.close / base.close - 1
}

/** Calendar anchors for the standard return windows, relative to `asOf` (YYYY-MM-DD). */
export function periodAnchors(asOf: string): { m1: string; m3: string; ytd: string; y1: string } {
  const d = new Date(`${asOf}T00:00:00Z`)
  const shift = (months: number) => {
    const x = new Date(d)
    x.setUTCMonth(x.getUTCMonth() - months)
    return x.toISOString().slice(0, 10)
  }
  return {
    m1: shift(1),
    m3: shift(3),
    // YTD is measured from the last close of the prior year.
    ytd: `${d.getUTCFullYear() - 1}-12-31`,
    y1: shift(12),
  }
}

export interface TrackingStats {
  /** ETF return − spot return over the aligned window. */
  diff: number | null
  /** Annualized stdev of daily return differences. */
  error: number | null
  correlation: number | null
  observations: number
}

/**
 * Tracking vs spot on non-overlapping `step`-session returns (default 5 =
 * weekly). Weekly sampling avoids reading the ETF-close (16:00 ET) vs
 * futures-settle (13:30 ET) timing gap as tracking error.
 */
export function trackingStats(etf: Bar[], spot: Bar[], step = 5): TrackingStats {
  const pairs = alignCloses(etf, spot)
  if (pairs.length < 4 * step) return { diff: null, error: null, correlation: null, observations: pairs.length }
  const ra: number[] = []
  const rb: number[] = []
  for (let i = step; i < pairs.length; i += step) {
    ra.push(pairs[i].a / pairs[i - step].a - 1)
    rb.push(pairs[i].b / pairs[i - step].b - 1)
  }
  const n = ra.length
  const diffs = ra.map((r, i) => r - rb[i])
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const md = mean(diffs)
  const te = Math.sqrt(diffs.reduce((s, x) => s + (x - md) ** 2, 0) / (n - 1)) * Math.sqrt(252 / step)
  const first = pairs[0]
  const last = pairs[pairs.length - 1]
  const diff = last.a / first.a - 1 - (last.b / first.b - 1)
  return { diff, error: te, correlation: pearson(ra, rb), observations: pairs.length }
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 3) return null
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    sa += a[i]
    sb += b[i]
  }
  const ma = sa / n
  const mb = sb / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  const denom = Math.sqrt(va * vb)
  return denom === 0 ? null : cov / denom
}

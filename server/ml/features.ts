import type { Metal } from '../../shared/universe.js'
import { FEATURE_IDS, ML_HORIZON } from '../../shared/ml.js'

// Pure, look-ahead-safe feature construction. Every value at row t (a trading
// day of the metal's front-month series) uses only observations dated ≤ t;
// FRED macro series are lagged one day (< t) and COT reports are used only
// strictly after their publication date. Targets look H rows ahead and are
// null for the last H rows (those rows are scored, never trained on).

export interface PricePoint {
  date: string
  close: number
  volume?: number | null
}

export interface ValuePoint {
  date: string
  value: number
}

export interface CotPoint {
  reportDate: string
  publishedAt: string | null
  openInterest: number | null
  mmLong: number | null
  mmShort: number | null
}

export interface CurvePoint {
  date: string
  c1: number
  c2: number
  c3: number | null
  /** Calendar months between the 1st and 2nd contract. */
  monthsApart: number
}

export type MacroId = 'DFII10' | 'T10YIE' | 'DTWEXBGS' | 'VIXCLS' | 'GVZCLS'

export interface FeatureInputs {
  metal: Metal
  /** Front-month closes of the metal being modelled: defines the row calendar. */
  spot: PricePoint[]
  gold: PricePoint[]
  silver: PricePoint[]
  dxy: PricePoint[]
  tnx: PricePoint[]
  vix: PricePoint[]
  spy: PricePoint[]
  /** GLD for gold, SLV for silver (volume used as a flows proxy). */
  etf: PricePoint[]
  macro: Partial<Record<MacroId, ValuePoint[]>>
  cot: CotPoint[]
  curve: CurvePoint[]
  horizon?: number
}

export interface FeatureRow {
  date: string
  values: Record<string, number | null>
  /** ln(P_{t+H} / P_t); null for the last H rows. */
  yRet: number | null
  /** 1 if yRet > 0, 0 otherwise; null when yRet is null. */
  yUp: 0 | 1 | null
}

export interface FeatureMatrix {
  metal: Metal
  horizon: number
  rows: FeatureRow[]
  /** Features with no data at all, with the reason (e.g. "COT not loaded yet"). */
  missing: Record<string, string>
}

type Num = number | null

// ── small numeric helpers (null-propagating) ─────────────────────────────────

const isNum = (x: Num | undefined): x is number => x != null && Number.isFinite(x)

function rolling(xs: Num[], n: number, f: (w: number[]) => number): Num[] {
  const out: Num[] = new Array(xs.length).fill(null)
  for (let i = n - 1; i < xs.length; i++) {
    const w: number[] = []
    for (let j = i - n + 1; j <= i; j++) {
      const v = xs[j]
      if (!isNum(v)) break
      w.push(v)
    }
    if (w.length === n) out[i] = f(w)
  }
  return out
}

const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length
function std(w: number[]): number {
  const m = mean(w)
  return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1))
}

/** Trailing z-score: (x_t − mean) / sd over the last n values including t. */
export function rollingZ(xs: Num[], n: number): Num[] {
  const out: Num[] = new Array(xs.length).fill(null)
  const m = rolling(xs, n, mean)
  const s = rolling(xs, n, std)
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const mi = m[i]
    const si = s[i]
    if (isNum(x) && isNum(mi) && isNum(si) && si > 0) out[i] = (x - mi) / si
  }
  return out
}

function diffN(xs: Num[], n: number): Num[] {
  return xs.map((x, i) => {
    const p = i >= n ? xs[i - n] : null
    return isNum(x) && isNum(p) ? x - p : null
  })
}

const logOf = (xs: Num[]): Num[] => xs.map((x) => (isNum(x) && x > 0 ? Math.log(x) : null))

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dayOfYear(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`)
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1
}

/**
 * Align an irregular series to `dates` by as-of lookup: the latest point dated
 * ≤ t (or < t when `strict`). Points older than `maxStaleDays` are treated as
 * missing so a dead feed is never forward-filled indefinitely.
 */
export function asOf(points: ValuePoint[], dates: string[], opts: { strict?: boolean; maxStaleDays?: number } = {}): Num[] {
  const { strict = false, maxStaleDays = 10 } = opts
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const out: Num[] = new Array(dates.length).fill(null)
  let j = -1
  for (let i = 0; i < dates.length; i++) {
    const t = dates[i]
    while (j + 1 < sorted.length && (strict ? sorted[j + 1].date < t : sorted[j + 1].date <= t)) j++
    if (j < 0) continue
    const p = sorted[j]
    if (addDays(p.date, maxStaleDays) < t) continue
    out[i] = Number.isFinite(p.value) ? p.value : null
  }
  return out
}

const closes = (ps: PricePoint[]): ValuePoint[] => ps.filter((p) => p.close > 0).map((p) => ({ date: p.date, value: p.close }))

/** Wilder RSI. */
export function rsi(xs: Num[], n = 14): Num[] {
  const out: Num[] = new Array(xs.length).fill(null)
  let avgG = 0
  let avgL = 0
  let count = 0
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]
    const b = xs[i]
    if (!isNum(a) || !isNum(b)) {
      count = 0
      avgG = 0
      avgL = 0
      continue
    }
    const ch = b - a
    const g = Math.max(ch, 0)
    const l = Math.max(-ch, 0)
    count++
    if (count <= n) {
      avgG += g / n
      avgL += l / n
      if (count < n) continue
    } else {
      avgG = (avgG * (n - 1) + g) / n
      avgL = (avgL * (n - 1) + l) / n
    }
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL)
  }
  return out
}

/**
 * Mean H-day forward log return starting within ±window calendar days of the
 * same day-of-year in PRIOR years, using only windows that completed by row i
 * (s + H ≤ i). Per-year means are averaged; needs ≥ minYears years.
 */
export function seasonalDrift(dates: string[], logP: Num[], H: number, window = 10, minYears = 3): Num[] {
  const n = dates.length
  const fwd: Num[] = logP.map((x, s) => {
    const y = s + H < n ? logP[s + H] : null
    return isNum(x) && isNum(y) ? y - x : null
  })
  const doy = dates.map(dayOfYear)
  const year = dates.map((d) => Number(d.slice(0, 4)))
  const byYear = new Map<number, number[]>()
  dates.forEach((_, i) => {
    const arr = byYear.get(year[i]) ?? []
    arr.push(i)
    byYear.set(year[i], arr)
  })
  const out: Num[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const yearMeans: number[] = []
    for (const [y, idxs] of byYear) {
      if (y >= year[i]) continue
      let sum = 0
      let cnt = 0
      for (const s of idxs) {
        if (Math.abs(doy[s] - doy[i]) > window || s + H > i) continue
        const f = fwd[s]
        if (isNum(f)) {
          sum += f
          cnt++
        }
      }
      if (cnt > 0) yearMeans.push(sum / cnt)
    }
    if (yearMeans.length >= minYears) out[i] = mean(yearMeans)
  }
  return out
}

/** COT managed-money net % OI z-score, keyed by the date the report became public. */
export function cotSeries(rows: CotPoint[], zWindow = 156, minReports = 52): ValuePoint[] {
  const sorted = [...rows].sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
  const pct = sorted.map((r) =>
    isNum(r.mmLong) && isNum(r.mmShort) && isNum(r.openInterest) && r.openInterest > 0
      ? (r.mmLong - r.mmShort) / r.openInterest
      : null,
  )
  const out: ValuePoint[] = []
  for (let i = 0; i < sorted.length; i++) {
    const w: number[] = []
    for (let j = Math.max(0, i - zWindow + 1); j <= i; j++) {
      const v = pct[j]
      if (isNum(v)) w.push(v)
    }
    const v = pct[i]
    if (!isNum(v) || w.length < minReports) continue
    const s = std(w)
    if (!(s > 0)) continue
    // Released Friday for the Tuesday report; if the release time is unknown assume +3 days.
    const published = sorted[i].publishedAt ? sorted[i].publishedAt!.slice(0, 10) : addDays(sorted[i].reportDate, 3)
    out.push({ date: published, value: (v - mean(w)) / s })
  }
  return out
}

// ── the matrix ───────────────────────────────────────────────────────────────

export function buildFeatureMatrix(inp: FeatureInputs): FeatureMatrix {
  const H = inp.horizon ?? ML_HORIZON
  const spot = [...inp.spot].filter((p) => p.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1))
  const dates = spot.map((p) => p.date)
  const n = dates.length
  const P: Num[] = spot.map((p) => p.close)
  const lp = logOf(P)
  const ret1 = diffN(lp, 1)
  const missing: Record<string, string> = {}

  const f: Record<string, Num[]> = {}
  for (const k of [5, 20, 60, 120]) f[`mom${k}`] = diffN(lp, k)
  const ann = Math.sqrt(252)
  f.rv20 = rolling(ret1, 20, (w) => std(w) * ann)
  f.rv60 = rolling(ret1, 60, (w) => std(w) * ann)
  f.volvol60 = rolling(f.rv20, 60, std)
  const ma50 = rolling(P, 50, mean)
  const ma200 = rolling(P, 200, mean)
  f.ma50_dist = P.map((p, i) => (isNum(p) && isNum(ma50[i]) ? p / ma50[i]! - 1 : null))
  f.ma200_dist = P.map((p, i) => (isNum(p) && isNum(ma200[i]) ? p / ma200[i]! - 1 : null))
  f.rsi14 = rsi(P, 14)

  const gold = asOf(closes(inp.gold), dates)
  const silver = asOf(closes(inp.silver), dates)
  const gsr = gold.map((g, i) => (isNum(g) && isNum(silver[i]) && silver[i]! > 0 ? g / silver[i]! : null))
  f.gsr_z252 = rollingZ(gsr, 252)

  const dxy = asOf(closes(inp.dxy), dates)
  f.dxy_mom20 = diffN(logOf(dxy), 20)
  const tnx = asOf(closes(inp.tnx), dates)
  f.tnx_chg20 = diffN(tnx, 20)
  let vix = asOf(closes(inp.vix), dates)
  if (!vix.some(isNum) && inp.macro.VIXCLS?.length) vix = asOf(inp.macro.VIXCLS, dates, { strict: true })
  f.vix_level = vix
  f.vix_chg20 = diffN(vix, 20)
  f.spy_mom20 = diffN(logOf(asOf(closes(inp.spy), dates)), 20)

  // ETF volume z on its own calendar, then as-of aligned.
  const etf = [...inp.etf].filter((p) => p.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1))
  const lv: Num[] = etf.map((p) => (isNum(p.volume) && p.volume! > 0 ? Math.log(p.volume!) : null))
  const lvz = rollingZ(rolling(lv, 5, mean), 120)
  f.etf_volume_z = asOf(
    etf.map((p, i) => ({ date: p.date, value: lvz[i] ?? NaN })).filter((p) => Number.isFinite(p.value)),
    dates,
  )

  const doy = dates.map(dayOfYear)
  f.doy_sin = doy.map((d) => Math.sin((2 * Math.PI * d) / 365.25))
  f.doy_cos = doy.map((d) => Math.cos((2 * Math.PI * d) / 365.25))
  f.seasonal_drift = seasonalDrift(dates, lp, H)

  // Macro (FRED): derived on the native series, then lagged one day (< t).
  const macroFeature = (
    id: string,
    series: MacroId,
    derive: (vals: Num[]) => Num[],
    missingReason: string,
  ) => {
    const pts = [...(inp.macro[series] ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))
    if (pts.length === 0) {
      missing[id] = missingReason
      f[id] = new Array(n).fill(null)
      return
    }
    const d = derive(pts.map((p) => p.value))
    f[id] = asOf(
      pts.map((p, i) => ({ date: p.date, value: d[i] ?? NaN })).filter((p) => Number.isFinite(p.value)),
      dates,
      { strict: true },
    )
  }
  macroFeature('real_yield_chg20', 'DFII10', (v) => diffN(v, 20), 'FRED DFII10 not loaded yet')
  macroFeature('breakeven_chg20', 'T10YIE', (v) => diffN(v, 20), 'FRED T10YIE not loaded yet')
  macroFeature('usd_broad_mom20', 'DTWEXBGS', (v) => diffN(logOf(v), 20), 'FRED DTWEXBGS not loaded yet')
  macroFeature('gvz_level', 'GVZCLS', (v) => v, 'FRED GVZCLS not loaded yet')

  // COT: usable only strictly after publication.
  if (inp.cot.length === 0) {
    missing.cot_mm_z = 'COT not loaded yet'
    f.cot_mm_z = new Array(n).fill(null)
  } else {
    f.cot_mm_z = asOf(cotSeries(inp.cot), dates, { strict: true, maxStaleDays: 21 })
  }

  // Curve (per-contract settles).
  if (inp.curve.length === 0) {
    for (const id of ['curve_spread_z', 'curve_fly_z', 'carry_slope']) {
      missing[id] = 'Contract curve not loaded yet'
      f[id] = new Array(n).fill(null)
    }
  } else {
    const cv = [...inp.curve].sort((a, b) => (a.date < b.date ? -1 : 1))
    const spread = cv.map((c) => (c.c2 - c.c1) / c.c1)
    const fly = cv.map((c) => (isNum(c.c3) ? (c.c1 - 2 * c.c2 + c.c3) / c.c1 : null))
    const sz = rollingZ(spread, 252)
    const fz = rollingZ(fly, 252)
    const slope = cv.map((c) => (c.monthsApart > 0 ? (Math.log(c.c2 / c.c1) * 12) / c.monthsApart : null))
    const align = (vals: Num[]) =>
      asOf(
        cv.map((c, i) => ({ date: c.date, value: vals[i] ?? NaN })).filter((p) => Number.isFinite(p.value)),
        dates,
      )
    f.curve_spread_z = align(sz)
    f.curve_fly_z = align(fz)
    f.carry_slope = align(slope)
  }

  const rows: FeatureRow[] = dates.map((date, i) => {
    const values: Record<string, Num> = {}
    for (const id of FEATURE_IDS) {
      const v = f[id]?.[i]
      values[id] = isNum(v) ? v : null
    }
    const future = i + H < n ? lp[i + H] : null
    const now = lp[i]
    const yRet = isNum(future) && isNum(now) ? future - now : null
    return { date, values, yRet, yUp: yRet == null ? null : yRet > 0 ? 1 : 0 }
  })

  for (const id of FEATURE_IDS) {
    if (!missing[id] && !rows.some((r) => r.values[id] != null)) missing[id] = 'No data for this input'
  }
  return { metal: inp.metal, horizon: H, rows, missing }
}

/** CSV consumed by ml/pipeline.py: date, <features…>, y_ret, y_up (blank = missing). */
export function matrixToCsv(m: FeatureMatrix): string {
  const header = ['date', ...FEATURE_IDS, 'y_ret', 'y_up'].join(',')
  const fmt = (v: number | null) => (v == null ? '' : String(Number(v.toPrecision(10))))
  const lines = m.rows.map((r) => [r.date, ...FEATURE_IDS.map((id) => fmt(r.values[id])), fmt(r.yRet), r.yUp == null ? '' : String(r.yUp)].join(','))
  return [header, ...lines].join('\n') + '\n'
}

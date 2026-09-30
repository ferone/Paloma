import type { SeriesPoint } from '../../shared/macro.js'

// FRED adapter. With FRED_API_KEY: the JSON observations API. Without it: the
// keyless fredgraph.csv download (same data, used by the FRED website's own
// "Download CSV" button). Missing observations are "." (or blank) in both.

const FRED_JSON = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv'

function parseValue(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = raw.trim()
  if (s === '' || s === '.') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parse fredgraph.csv (`observation_date,ID` or legacy `DATE,ID` header). Skips missing values. PURE. */
export function parseFredCsv(text: string): SeriesPoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const header = lines[0].toLowerCase()
  const start = header.includes('date') ? 1 : 0
  const out: SeriesPoint[] = []
  for (let i = start; i < lines.length; i++) {
    const [date, raw] = lines[i].split(',')
    const d = date?.trim()
    if (!d || !ISO_DATE.test(d)) continue
    const value = parseValue(raw)
    if (value !== null) out.push({ date: d, value })
  }
  return out
}

/** Parse the FRED JSON observations payload. Skips missing values. PURE. */
export function parseFredJson(payload: unknown): SeriesPoint[] {
  const obs = (payload as { observations?: { date?: string; value?: string }[] } | null)?.observations
  if (!Array.isArray(obs)) return []
  const out: SeriesPoint[] = []
  for (const o of obs) {
    if (typeof o?.date !== 'string' || !ISO_DATE.test(o.date)) continue
    const value = parseValue(o.value)
    if (value !== null) out.push({ date: o.date, value })
  }
  return out
}

/**
 * Year-over-year percent change (in percent units, 3.1 = 3.1%) for a monthly
 * level series: each point vs the observation for the same month one year
 * earlier. Points without a year-ago observation are dropped. PURE.
 */
export function yoyPercent(points: SeriesPoint[]): SeriesPoint[] {
  const byMonth = new Map<string, number>()
  for (const p of points) byMonth.set(p.date.slice(0, 7), p.value)
  const out: SeriesPoint[] = []
  for (const p of points) {
    const y = Number(p.date.slice(0, 4))
    const prior = byMonth.get(`${y - 1}${p.date.slice(4, 7)}`)
    if (prior == null || prior === 0) continue
    out.push({ date: p.date, value: Number(((p.value / prior - 1) * 100).toFixed(4)) })
  }
  return out
}

/** Element-wise a − b on matching dates. PURE. */
export function diffSeries(a: SeriesPoint[], b: SeriesPoint[]): SeriesPoint[] {
  const bm = new Map(b.map((p) => [p.date, p.value]))
  const out: SeriesPoint[] = []
  for (const p of a) {
    const v = bm.get(p.date)
    if (v != null) out.push({ date: p.date, value: Number((p.value - v).toFixed(6)) })
  }
  return out
}

/** Element-wise a / b on matching dates (b ≠ 0). PURE. */
export function ratioSeries(a: SeriesPoint[], b: SeriesPoint[]): SeriesPoint[] {
  const bm = new Map(b.map((p) => [p.date, p.value]))
  const out: SeriesPoint[] = []
  for (const p of a) {
    const v = bm.get(p.date)
    if (v != null && v !== 0) out.push({ date: p.date, value: Number((p.value / v).toFixed(6)) })
  }
  return out
}

export interface FredFetchOpts {
  apiKey?: string
  /** Only fetch observations on/after this date (YYYY-MM-DD). */
  from?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Fetch one FRED series. Throws on HTTP/network errors (the job reports per-series failures). */
export async function fetchFredSeries(id: string, opts: FredFetchOpts = {}): Promise<{ points: SeriesPoint[]; via: 'api' | 'csv' }> {
  const f = opts.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000)
  if (opts.apiKey) {
    const params = new URLSearchParams({ series_id: id, api_key: opts.apiKey, file_type: 'json' })
    if (opts.from) params.set('observation_start', opts.from)
    const res = await f(`${FRED_JSON}?${params.toString()}`, { signal })
    if (!res.ok) throw new Error(`FRED ${id}: HTTP ${res.status}`)
    return { points: parseFredJson(await res.json()), via: 'api' }
  }
  const params = new URLSearchParams({ id })
  if (opts.from) params.set('cosd', opts.from)
  const res = await f(`${FRED_CSV}?${params.toString()}`, { signal, headers: { Accept: 'text/csv' } })
  if (!res.ok) throw new Error(`FRED ${id} (csv): HTTP ${res.status}`)
  const text = await res.text()
  if (text.trimStart().startsWith('<')) throw new Error(`FRED ${id} (csv): unexpected HTML response`)
  return { points: parseFredCsv(text), via: 'csv' }
}

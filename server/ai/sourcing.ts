import type { Claim, Driver, ReportBody, Sentiment, SourceRef, TradeLeg } from '../../shared/ai.js'

// Sourcing rules (from the CommodityFutures ai-analyst skill):
//  1. Every factual claim carries a real URL, or it is flagged as unsourced.
//  2. Never invent URLs: a source survives only if it is syntactically valid AND
//     it is on the allow-list = citations the provider's web search actually
//     returned (`:online` models) ∪ data-source URLs the app itself put in the
//     prompt (FRED series pages, CFTC). Anything else is dropped and counted.
//  3. Claims whose sources were all dropped are kept but marked sourced: false,
//     so the reader sees the gap instead of a fabricated link.

const BLOCKED_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|test|invalid|local|internal)$/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

/** Syntactic URL check: absolute http(s), a public-looking hostname, no whitespace. PURE. */
export function isValidUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 2048 || /\s/.test(raw)) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  const host = u.hostname
  if (!host.includes('.') || IPV4.test(host) || host.startsWith('[') || BLOCKED_HOSTS.test(host)) return false
  const tld = host.split('.').pop()!
  return /^[a-z]{2,24}$/i.test(tld)
}

/** Canonical form for allow-list comparison: lowercase host, no www/hash/utm params/trailing slash. PURE. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    const qs = u.searchParams.toString()
    return `${host}${path}${qs ? `?${qs}` : ''}`
  } catch {
    return raw
  }
}

/** Decode the few HTML entities search results carry in titles, collapse whitespace, cap length. PURE. */
export function cleanTitle(t: string | undefined): string | undefined {
  if (!t) return undefined
  const s = t
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s.slice(0, 200) : undefined
}

export class SourcePolicy {
  private allowed = new Map<string, SourceRef>()
  dropped = 0

  constructor(citations: { url: string; title?: string }[], contextUrls: string[]) {
    for (const c of citations) if (isValidUrl(c.url)) this.allowed.set(normalizeUrl(c.url), { url: c.url, title: cleanTitle(c.title) })
    for (const u of contextUrls) if (isValidUrl(u)) this.allowed.set(normalizeUrl(u), { url: u })
  }

  get size(): number {
    return this.allowed.size
  }

  /** Keep only allow-listed, valid sources (deduped). Counts every rejected entry. */
  filter(raw: unknown): SourceRef[] {
    const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
    const out = new Map<string, SourceRef>()
    for (const item of list) {
      const url = typeof item === 'string' ? item : (item as { url?: unknown } | null)?.url
      if (!isValidUrl(url)) {
        if (item != null) this.dropped++
        continue
      }
      const key = normalizeUrl(url)
      const known = this.allowed.get(key)
      if (!known) {
        this.dropped++
        continue
      }
      const o = typeof item === 'object' && item ? (item as Record<string, unknown>) : {}
      out.set(key, {
        url: known.url,
        title: known.title || cleanTitle(str(o.title)),
        publisher: str(o.publisher) || undefined,
        date: /^\d{4}-\d{2}-\d{2}$/.test(str(o.date)) ? str(o.date) : undefined,
      })
    }
    return [...out.values()]
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

const sentiment = (v: unknown): Sentiment => (v === 'bullish' || v === 'bearish' ? v : 'neutral')

function claims(raw: unknown, policy: SourcePolicy): Claim[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): Claim | null => {
      if (typeof item === 'string') return item.trim() ? { text: item.trim(), sources: [], sourced: false } : null
      const o = (item ?? {}) as Record<string, unknown>
      const text = str(o.text) || str(o.claim) || str(o.detail)
      if (!text) return null
      const sources = policy.filter(o.sources ?? o.source)
      return { text, sources, sourced: sources.length > 0 }
    })
    .filter((c): c is Claim => c !== null)
}

function drivers(raw: unknown, policy: SourcePolicy): Driver[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): Driver | null => {
      const o = (item ?? {}) as Record<string, unknown>
      const title = str(o.title)
      const detail = str(o.detail)
      if (!title && !detail) return null
      const sources = policy.filter(o.sources)
      return { title: title || detail.slice(0, 60), detail, sentiment: sentiment(o.sentiment), sources, sourced: sources.length > 0 }
    })
    .filter((d): d is Driver => d !== null)
}

function legs(raw: unknown): TradeLeg[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((l): TradeLeg | null => {
      const o = (l ?? {}) as Record<string, unknown>
      const instrument = str(o.instrument) || str(o.symbol)
      if (!instrument) return null
      return {
        instrument,
        side: str(o.side).toLowerCase() === 'short' ? 'short' : 'long',
        ratio: str(o.ratio) || undefined,
        role: str(o.role) || undefined,
      }
    })
    .filter((l): l is TradeLeg => l !== null)
}

export interface NormalizedReport {
  body: ReportBody
  sources: SourceRef[]
  unsourcedCount: number
  droppedSources: number
}

/**
 * Coerce an LLM JSON object into a typed report body, enforcing the sourcing
 * rules on every claim. Returns null when the object lacks the kind's core text. PURE.
 */
export function normalizeReport(kind: ReportBody['kind'], raw: Record<string, unknown> | null, policy: SourcePolicy, question = ''): NormalizedReport | null {
  if (!raw || typeof raw !== 'object') return null
  let body: ReportBody
  switch (kind) {
    case 'macro_brief': {
      const summary = str(raw.summary)
      if (!summary) return null
      body = {
        kind,
        summary,
        outlook: sentiment(raw.outlook),
        drivers: drivers(raw.drivers, policy),
        risks: claims(raw.risks, policy),
        whatWouldChangeMyMind: claims(raw.whatWouldChangeMyMind ?? raw.what_would_change_my_mind, policy),
      }
      break
    }
    case 'trade_brief': {
      const thesis = str(raw.thesis)
      if (!thesis) return null
      body = {
        kind,
        thesis,
        structure: str(raw.structure),
        legs: legs(raw.legs),
        entryPlan: str(raw.entryPlan ?? raw.entry_plan),
        catalysts: claims(raw.catalysts, policy),
        risks: claims(raw.risks, policy),
        invalidation: str(raw.invalidation),
      }
      break
    }
    case 'portfolio_commentary': {
      const paragraph = str(raw.paragraph) || str(raw.commentary)
      if (!paragraph) return null
      body = { kind, headline: str(raw.headline), paragraph, bullets: claims(raw.bullets, policy) }
      break
    }
    case 'ask': {
      const answer = str(raw.answer)
      if (!answer) return null
      body = { kind, question, answer, points: claims(raw.points, policy) }
      break
    }
  }
  const items: { sources: SourceRef[]; sourced: boolean }[] =
    body.kind === 'macro_brief'
      ? [...body.drivers, ...body.risks, ...body.whatWouldChangeMyMind]
      : body.kind === 'trade_brief'
        ? [...body.catalysts, ...body.risks]
        : body.kind === 'portfolio_commentary'
          ? body.bullets
          : body.points
  // Top-level "sources" the model listed are validated too and merged into the flat list.
  const topLevel = policy.filter(raw.sources)
  const flat = new Map<string, SourceRef>()
  for (const s of [...items.flatMap((i) => i.sources), ...topLevel]) if (!flat.has(normalizeUrl(s.url))) flat.set(normalizeUrl(s.url), s)
  return {
    body,
    sources: [...flat.values()],
    unsourcedCount: items.filter((i) => !i.sourced).length,
    droppedSources: policy.dropped,
  }
}

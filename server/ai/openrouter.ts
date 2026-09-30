// Graceful OpenRouter chat client (ported from CommodityFutures lib/ai/openrouter.ts),
// hardened with a per-attempt timeout, retries with backoff on 429/5xx/network
// errors, and extraction of web citations returned by `:online` models.
// chat() NEVER throws: it resolves to null (and reports why via onError).

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Citation {
  url: string
  title?: string
}

export interface ChatResult {
  text: string
  /** URLs the provider's web search actually returned (url_citation annotations / citations[]). */
  citations: Citation[]
  model: string
  tokens: number | null
  /** USD cost reported by OpenRouter (usage.cost), when available. */
  costUsd: number | null
  /** 'length' means the reply hit max_tokens and is truncated. */
  finishReason: string | null
}

export interface ChatOpts {
  apiKey: string
  /** OpenRouter model id. A trailing ':online' enables web search (see webResults). */
  model: string
  /**
   * Number of web results when the model id ends in ':online'. The request is
   * sent as the equivalent `plugins: [{ id: 'web', max_results }]` form so the
   * injected search context (and cost) stays bounded. Default 3.
   */
  webResults?: number
  temperature?: number
  maxTokens?: number
  /** Per-attempt timeout. */
  timeoutMs?: number
  /** Extra attempts after the first (on 429, 5xx, timeouts and network errors). */
  retries?: number
  backoffMs?: number
  fetchImpl?: typeof fetch
  onError?: (message: string) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface OpenRouterResponse {
  model?: string
  choices?: {
    finish_reason?: string | null
    message?: {
      content?: string | null
      annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[]
    }
  }[]
  citations?: unknown[]
  usage?: { total_tokens?: number; cost?: number }
  error?: { message?: string }
}

/** Citations from both OpenRouter shapes: message.annotations[url_citation] and top-level citations[]. PURE. */
export function extractCitations(data: OpenRouterResponse): Citation[] {
  const out: Citation[] = []
  for (const a of data.choices?.[0]?.message?.annotations ?? []) {
    if (a?.type === 'url_citation' && typeof a.url_citation?.url === 'string') out.push({ url: a.url_citation.url, title: a.url_citation.title })
  }
  for (const c of data.citations ?? []) {
    if (typeof c === 'string') out.push({ url: c })
    else if (c && typeof (c as { url?: unknown }).url === 'string') out.push({ url: (c as { url: string }).url, title: (c as { title?: string }).title })
  }
  return out
}

export async function chat(messages: ChatMessage[], opts: ChatOpts): Promise<ChatResult | null> {
  const f = opts.fetchImpl ?? fetch
  const report = (m: string) => opts.onError?.(m)
  if (!opts.apiKey) {
    report('OPENROUTER_API_KEY is not set')
    return null
  }
  const attempts = 1 + (opts.retries ?? 2)
  let lastError = 'unknown error'
  const online = /:online$/i.test(opts.model)
  const payload = {
    model: online ? opts.model.replace(/:online$/i, '') : opts.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 2000,
    // Ask OpenRouter to report the request's cost in usage.cost.
    usage: { include: true },
    ...(online ? { plugins: [{ id: 'web', max_results: opts.webResults ?? 3 }] } : {}),
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep((opts.backoffMs ?? 1500) * 2 ** (attempt - 1))
    try {
      const res = await f(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          'HTTP-Referer': 'http://localhost/gold-investment-dashboard',
          'X-Title': 'Real Assets Dashboard',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      })
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300)
        lastError = `OpenRouter HTTP ${res.status}${body ? `: ${body}` : ''}`
        if (res.status === 429 || res.status >= 500) continue
        break // 4xx other than 429: retrying won't help
      }
      const data = (await res.json()) as OpenRouterResponse
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || text.trim() === '') {
        lastError = data?.error?.message ? `OpenRouter: ${data.error.message}` : 'OpenRouter returned an empty completion'
        continue
      }
      return {
        text,
        citations: extractCitations(data),
        model: data.model ?? opts.model,
        tokens: data.usage?.total_tokens ?? null,
        costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : null,
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      }
    } catch (err) {
      lastError = err instanceof Error ? `${err.name === 'TimeoutError' ? 'timeout: ' : ''}${err.message}` : String(err)
    }
  }
  report(lastError)
  return null
}

/** Parse a fenced or bare JSON object out of an LLM reply (tolerant). Null on failure. PURE. */
export function extractJson<T>(text: string | null | undefined): T | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced ? fenced[1] : text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

// Graceful OpenRouter chat client (ported from CommodityFutures lib/ai/openrouter.ts),
// hardened with a per-attempt timeout, retries with backoff on 429/5xx/network
// errors, and extraction of web citations returned by `:online` models.
// chat() NEVER throws: it resolves to null (and reports why via onError).

import { createSseParser } from '../../shared/assistant.js'

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

// ── Streaming ──────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; model: string; tokens: number | null; costUsd: number | null; finishReason: string | null }
  | { type: 'error'; message: string; aborted?: boolean }

export interface StreamOpts extends Omit<ChatOpts, 'onError'> {
  /** Aborts the upstream request (e.g. the browser disconnected). */
  signal?: AbortSignal
}

interface StreamChunk {
  model?: string
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]
  usage?: { total_tokens?: number; cost?: number }
  error?: { message?: string }
}

/**
 * Streaming chat completion (stream: true, usage included in the final chunk).
 * Yields content deltas, then exactly one `done` or `error`. NEVER throws.
 * Retries (429/5xx/network) happen only before the first byte of the body.
 */
export async function* chatStream(messages: ChatMessage[], opts: StreamOpts): AsyncGenerator<StreamEvent> {
  const f = opts.fetchImpl ?? fetch
  if (!opts.apiKey) {
    yield { type: 'error', message: 'OPENROUTER_API_KEY is not set' }
    return
  }
  const online = /:online$/i.test(opts.model)
  const payload = {
    model: online ? opts.model.replace(/:online$/i, '') : opts.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1500,
    stream: true,
    usage: { include: true },
    ...(online ? { plugins: [{ id: 'web', max_results: opts.webResults ?? 3 }] } : {}),
  }
  const aborted = () => opts.signal?.aborted === true
  const attempts = 1 + (opts.retries ?? 1)
  let res: Response | null = null
  let lastError = 'unknown error'
  for (let attempt = 0; attempt < attempts && !res; attempt++) {
    if (attempt > 0) await sleep((opts.backoffMs ?? 1500) * 2 ** (attempt - 1))
    if (aborted()) {
      yield { type: 'error', message: 'aborted', aborted: true }
      return
    }
    try {
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? 120_000)
      const r = await f(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          'HTTP-Referer': 'http://localhost/gold-investment-dashboard',
          'X-Title': 'Real Assets Dashboard',
        },
        body: JSON.stringify(payload),
        signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
      })
      if (!r.ok || !r.body) {
        const body = (await r.text().catch(() => '')).slice(0, 300)
        lastError = `OpenRouter HTTP ${r.status}${body ? `: ${body}` : ''}`
        if (r.status === 429 || r.status >= 500) continue
        break
      }
      res = r
    } catch (err) {
      if (aborted()) {
        yield { type: 'error', message: 'aborted', aborted: true }
        return
      }
      lastError = err instanceof Error ? `${err.name === 'TimeoutError' ? 'timeout: ' : ''}${err.message}` : String(err)
    }
  }
  if (!res?.body) {
    yield { type: 'error', message: lastError }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let model = opts.model
  let tokens: number | null = null
  let costUsd: number | null = null
  let finishReason: string | null = null
  let sawText = false
  let finished = false
  const handle = (data: string): StreamEvent | 'end' | null => {
    if (data.trim() === '[DONE]') return 'end'
    let chunk: StreamChunk
    try {
      chunk = JSON.parse(data) as StreamChunk
    } catch {
      return null
    }
    if (chunk.error) return { type: 'error', message: `OpenRouter: ${chunk.error.message ?? 'stream error'}` }
    if (chunk.model) model = chunk.model
    if (chunk.usage) {
      if (typeof chunk.usage.total_tokens === 'number') tokens = chunk.usage.total_tokens
      if (typeof chunk.usage.cost === 'number') costUsd = chunk.usage.cost
    }
    const c = chunk.choices?.[0]
    if (c?.finish_reason) finishReason = c.finish_reason
    const text = c?.delta?.content
    if (typeof text === 'string' && text !== '') {
      sawText = true
      return { type: 'delta', text }
    }
    return null
  }
  try {
    while (!finished) {
      const { value, done } = await reader.read()
      const events = done ? parser.flush() : parser.feed(decoder.decode(value, { stream: true }))
      for (const ev of events) {
        const out = handle(ev.data)
        if (out === 'end') finished = true
        else if (out?.type === 'error') {
          yield out
          return
        } else if (out) yield out
      }
      if (done) break
    }
  } catch (err) {
    if (aborted()) yield { type: 'error', message: 'aborted', aborted: true }
    else yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    return
  } finally {
    reader.cancel().catch(() => {})
  }
  if (!sawText) {
    yield { type: 'error', message: 'OpenRouter returned an empty completion' }
    return
  }
  yield { type: 'done', model, tokens, costUsd, finishReason }
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

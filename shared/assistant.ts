// Site-wide AI assistant contracts (/api/ai/assistant/*).
// Server: server/ai/assistant/*. Client: src/features/assistant/*.

export const ASSISTANT_LIMITS = {
  /** Most recent turns sent with a question (user + assistant messages). */
  maxTurns: 20,
  /** Longest user message accepted, in characters. */
  maxQuestionChars: 4000,
  /** Longest on-screen summary accepted from the client, in UTF-8 bytes. */
  maxSummaryBytes: 4096,
} as const

export interface AssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

/** What the user is looking at. `summary` is compact text built from the page's own data. */
export interface AssistantPage {
  route: string
  /** "Quant Lab · Gold butterfly (c0−2·c1+c2)". */
  title: string
  asset?: string
  summary?: string
}

export interface AssistantChatRequest {
  sessionId: string
  messages: AssistantTurn[]
  page: AssistantPage
  /** Let the model search the web for this message (appends ':online'). Default false. */
  web?: boolean
}

/** Payload of the SSE `done` event. */
export interface AssistantDone {
  costUsd: number | null
  tokens: number | null
  model: string
  /** True when the monthly spend crossed 80% of the cap and the fallback model answered. */
  fallback: boolean
  monthSpendUsd: number
  capUsd: number
}

export type BudgetState = 'ok' | 'fallback' | 'capped'

export interface AssistantUsage {
  monthSpendUsd: number
  capUsd: number
  model: string
  fallbackModel: string
  configured: boolean
  state: BudgetState
}

export interface AssistantSettings {
  model: string
  fallbackModel: string
  monthlyCapUsd: number
}

export interface SseEvent {
  /** `message` when the stream names no event (OpenRouter's style). */
  event: string
  data: string
}

/**
 * Incremental Server-Sent Events parser: feed it decoded text chunks as they
 * arrive (split anywhere, even mid-line) and it returns the events completed so
 * far. Comment lines (":" prefix, e.g. ": OPENROUTER PROCESSING") are skipped;
 * multi-line `data:` fields are joined with "\n". PURE apart from its buffer.
 */
export function createSseParser(): { feed(chunk: string): SseEvent[]; flush(): SseEvent[] } {
  let buf = ''
  let event = ''
  let data: string[] = []
  const take = (lines: string[], out: SseEvent[]) => {
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line === '') {
        if (data.length) out.push({ event: event || 'message', data: data.join('\n') })
        event = ''
        data = []
        continue
      }
      if (line.startsWith(':')) continue
      const i = line.indexOf(':')
      const field = i < 0 ? line : line.slice(0, i)
      let value = i < 0 ? '' : line.slice(i + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
  }
  return {
    feed(chunk) {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      const out: SseEvent[] = []
      take(lines, out)
      return out
    },
    flush() {
      const out: SseEvent[] = []
      take(buf ? [buf, ''] : [''], out)
      buf = ''
      return out
    },
  }
}

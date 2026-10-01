import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotConfigured } from '@shared/api'
import { createSseParser, type AssistantChatRequest, type AssistantDone, type AssistantSettings, type AssistantUsage } from '@shared/assistant'
import { api } from '../../api/client'

// /api/ai/assistant: the chat stream (fetch + SSE, axios cannot stream) and
// TanStack Query hooks for usage and settings. Keys are prefixed 'assistant'.

export const CHAT_URL = '/api/ai/assistant/chat'

export interface StreamHandlers {
  onDelta(text: string): void
  onDone(done: AssistantDone): void
  onError(message: string): void
  onNotConfigured(info: NotConfigured): void
}

/**
 * POST a question and dispatch the streamed events. Resolves when the stream
 * ends (or is aborted via `signal`, which is not reported as an error).
 */
export async function streamChat(req: AssistantChatRequest, h: StreamHandlers, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}): Promise<void> {
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(req),
      signal: opts.signal,
    })
  } catch (err) {
    if (!opts.signal?.aborted) h.onError(err instanceof Error ? err.message : 'Network error')
    return
  }
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('text/event-stream') || !res.body) {
    const body = (await res.json().catch(() => null)) as { status?: string; message?: string; error?: string } | null
    if (body?.status === 'not_configured') h.onNotConfigured(body as NotConfigured)
    else h.onError(body?.message ?? body?.error ?? `Request failed (HTTP ${res.status})`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let ended = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      for (const ev of done ? parser.flush() : parser.feed(decoder.decode(value, { stream: true }))) {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(ev.data) as Record<string, unknown>
        } catch {
          continue
        }
        if (ev.event === 'delta' && typeof data.text === 'string') h.onDelta(data.text)
        else if (ev.event === 'done') {
          ended = true
          h.onDone(data as unknown as AssistantDone)
        } else if (ev.event === 'error') {
          ended = true
          h.onError(typeof data.message === 'string' ? data.message : 'The assistant failed')
        }
      }
      if (done) break
    }
  } catch (err) {
    if (opts.signal?.aborted) return
    h.onError(err instanceof Error ? err.message : 'The stream was interrupted')
    return
  }
  if (!ended && !opts.signal?.aborted) h.onError('The stream ended unexpectedly')
}

export function useAssistantUsage(enabled = true) {
  return useQuery({
    queryKey: ['assistant', 'usage'],
    queryFn: async () => (await api.get<AssistantUsage>('/ai/assistant/usage')).data,
    enabled,
    staleTime: 30_000,
  })
}

export function useAssistantSettings() {
  return useQuery({
    queryKey: ['assistant', 'settings'],
    queryFn: async () => (await api.get<AssistantSettings>('/ai/assistant/settings')).data,
  })
}

export function useSaveAssistantSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (s: Partial<AssistantSettings>) => (await api.put<AssistantSettings>('/ai/assistant/settings', s)).data,
    onSuccess: (data) => {
      qc.setQueryData(['assistant', 'settings'], data)
      void qc.invalidateQueries({ queryKey: ['assistant', 'usage'] })
    },
  })
}

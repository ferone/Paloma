import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotConfigured } from '@shared/api'
import { ASSISTANT_LIMITS, type AssistantDone, type AssistantPage, type AssistantTurn } from '@shared/assistant'
import { streamChat } from './api'

// Conversation state for one browser tab (sessionStorage), with streaming,
// Stop (aborts the request, which aborts the upstream call) and Clear.

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  web?: boolean
  streaming?: boolean
  stopped?: boolean
  error?: string
  done?: AssistantDone
}

interface Stored {
  sessionId: string
  items: ChatItem[]
}

export const STORAGE_KEY = 'gid.assistant.chat'

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

function load(): Stored {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Stored
      if (typeof s.sessionId === 'string' && Array.isArray(s.items)) return { sessionId: s.sessionId, items: s.items.map((i) => ({ ...i, streaming: false })) }
    }
  } catch {
    // fall through to a fresh session
  }
  return { sessionId: newId(), items: [] }
}

/** Turns sent with a question: completed messages only, newest last, at most maxTurns. PURE. */
export function historyTurns(items: ChatItem[]): AssistantTurn[] {
  return items
    .filter((i) => i.content.trim() !== '' && !(i.role === 'assistant' && i.error && !i.content))
    .map((i) => ({ role: i.role, content: i.content }))
    .slice(-(ASSISTANT_LIMITS.maxTurns - 1))
}

export function useChat(opts: { onDone?: (d: AssistantDone) => void; fetchImpl?: typeof fetch } = {}) {
  const [state, setState] = useState<Stored>(load)
  const [notConfigured, setNotConfigured] = useState<NotConfigured | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const onDone = useRef(opts.onDone)
  useEffect(() => {
    onDone.current = opts.onDone
  })

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // non-persistent is fine
    }
  }, [state])

  useEffect(() => () => ctl.current?.abort(), [])

  const patch = useCallback((id: string, f: (i: ChatItem) => ChatItem) => {
    setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? f(i) : i)) }))
  }, [])

  const streaming = state.items.some((i) => i.streaming)

  const send = useCallback(
    (question: string, page: AssistantPage, web: boolean) => {
      const q = question.trim().slice(0, ASSISTANT_LIMITS.maxQuestionChars)
      if (!q || ctl.current) return
      const user: ChatItem = { id: newId(), role: 'user', content: q, web }
      const reply: ChatItem = { id: newId(), role: 'assistant', content: '', streaming: true }
      const turns = [...historyTurns(state.items), { role: 'user' as const, content: q }]
      setState((s) => ({ ...s, items: [...s.items, user, reply] }))
      const c = new AbortController()
      ctl.current = c
      void streamChat(
        { sessionId: state.sessionId, messages: turns, page, web },
        {
          onDelta: (t) => patch(reply.id, (i) => ({ ...i, content: i.content + t })),
          onDone: (d) => {
            patch(reply.id, (i) => ({ ...i, streaming: false, done: d }))
            onDone.current?.(d)
          },
          onError: (m) => patch(reply.id, (i) => ({ ...i, streaming: false, error: m })),
          onNotConfigured: (info) => {
            setNotConfigured(info)
            setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== reply.id && i.id !== user.id) }))
          },
        },
        { signal: c.signal, fetchImpl: opts.fetchImpl },
      ).finally(() => {
        if (ctl.current === c) ctl.current = null
        patch(reply.id, (i) => (i.streaming ? { ...i, streaming: false, stopped: c.signal.aborted } : i))
      })
    },
    [state.items, state.sessionId, patch, opts.fetchImpl],
  )

  const stop = useCallback(() => {
    ctl.current?.abort()
  }, [])

  const clear = useCallback(() => {
    ctl.current?.abort()
    ctl.current = null
    setState({ sessionId: newId(), items: [] })
  }, [])

  return { items: state.items, sessionId: state.sessionId, streaming, notConfigured, send, stop, clear }
}

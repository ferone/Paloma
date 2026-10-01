import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { RiCloseLine, RiDeleteBin6Line, RiGlobalLine, RiSendPlane2Line, RiStopFill } from 'react-icons/ri'
import type { AssistantDone, AssistantUsage } from '@shared/assistant'
import { useSettings } from '../../store/settings-context'
import { fmtUsd } from '../../design/format'
import { Chip } from '../../ui'
import { resolveContext, type ContextRegistry } from './context'
import { useAssistantUsage } from './api'
import { Markdown } from './Markdown'
import { fallbackContext, startersFor } from './starters'
import { useChat, type ChatItem } from './useChat'

// Docked, non-modal assistant panel: the page stays usable beside it. Focus
// moves to the input on open; Esc closes (the provider restores focus).

export interface AssistantPanelProps {
  open: boolean
  onClose(): void
  /** Text to place in the input; `nonce` changes on every request. */
  prefill: { text: string; nonce: number } | null
  registry: ContextRegistry
  fetchImpl?: typeof fetch
}

const usd = (v: number | null | undefined) => (v == null ? '—' : v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : fmtUsd(v, 2))
const shortModel = (m: string) => m.split('/').pop() ?? m

export default function AssistantPanel({ open, onClose, prefill, registry, fetchImpl }: AssistantPanelProps) {
  const { pathname, search } = useLocation()
  const { asset } = useSettings()
  const entries = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
  const ctx = resolveContext(entries, fallbackContext(pathname, search, asset))
  const usage = useAssistantUsage(open)
  const qc = useQueryClient()
  const chat = useChat({
    fetchImpl,
    onDone: (d: AssistantDone) => qc.setQueryData<AssistantUsage>(['assistant', 'usage'], (u) => (u ? { ...u, monthSpendUsd: d.monthSpendUsd, capUsd: d.capUsd } : u)),
  })
  const [input, setInput] = useState('')
  const [web, setWeb] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // A new prefill (Ask about this) replaces the input once per request.
  const [seenNonce, setSeenNonce] = useState(0)
  if (prefill && prefill.nonce !== seenNonce) {
    setSeenNonce(prefill.nonce)
    setInput(prefill.text)
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open, prefill])

  const last = chat.items.at(-1)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.items.length, last?.content])

  const page = { route: pathname, title: ctx.label, asset, summary: ctx.summary }
  const ask = (q: string) => {
    if (!q.trim() || chat.streaming) return
    chat.send(q, page, web)
    setInput('')
    setWeb(false)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    ask(input)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      ask(input)
    }
  }

  const u = usage.data
  const notConfigured = chat.notConfigured ?? (u && !u.configured ? true : null)

  return (
    <aside
      aria-label="Assistant"
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      className="no-print fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-surface sm:w-[400px]"
    >
      <header className="border-b border-border px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <h2 className="display text-[17px] font-medium text-foreground">Assistant</h2>
          <span className="text-2xs text-faint" aria-hidden>
            Ctrl+J
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={chat.clear}
              disabled={!chat.items.length}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
            >
              <RiDeleteBin6Line size={13} aria-hidden /> Clear
            </button>
            <button type="button" onClick={onClose} aria-label="Close assistant" className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground">
              <RiCloseLine size={18} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="min-w-0 truncate text-2xs text-muted" title={ctx.label}>
            <span className="label mr-1">Looking at</span>
            <span className="text-foreground">{ctx.label}</span>
          </span>
          {u && (
            <span className="num ml-auto shrink-0 text-2xs text-muted" title="OpenRouter spend this month (assistant + AI reports) vs the cap">
              {usd(u.monthSpendUsd)} / {fmtUsd(u.capUsd, 2)}
            </span>
          )}
        </div>
        {u?.state === 'fallback' && <p className="mt-1.5 text-2xs text-muted">Over 80% of the monthly cap: answers use {shortModel(u.fallbackModel)}.</p>}
        {u?.state === 'capped' && <p className="mt-1.5 text-2xs text-neg-text">Monthly budget used up. Raise the cap in Settings.</p>}
      </header>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-[13px] leading-relaxed">
        {notConfigured ? (
          <div className="rounded-md border border-border bg-surface-2/50 p-3 text-xs text-muted">
            <p className="text-foreground">The assistant needs an OpenRouter API key.</p>
            <p className="mt-1">
              Add it in{' '}
              <Link to="/settings" className="text-brand underline underline-offset-2">
                Settings
              </Link>
              . Everything else in the platform works without it.
            </p>
          </div>
        ) : chat.items.length === 0 ? (
          <Intro starters={startersFor(pathname)} onPick={ask} />
        ) : (
          chat.items.map((m) => <Message key={m.id} m={m} />)
        )}
      </div>

      <form onSubmit={submit} className="border-t border-border px-3 pb-3 pt-2.5">
        <label htmlFor="assistant-input" className="sr-only">
          Ask about this page
        </label>
        <textarea
          id="assistant-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={4000}
          placeholder="Ask about this page, a rule or a trade…"
          disabled={!!notConfigured}
          className="block w-full resize-none rounded-md border border-border-strong bg-background px-2.5 py-2 text-[13px] text-foreground placeholder:text-faint focus:border-brand focus:outline-none disabled:opacity-50"
        />
        <div className="mt-2 flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-2xs text-muted" title="Let the model search the web for this message (costs more)">
            <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className="accent-[var(--brand)]" />
            <RiGlobalLine size={12} aria-hidden /> Web search
          </label>
          <span className="ml-auto text-2xs text-faint">Advisory · can be wrong</span>
          {chat.streaming ? (
            <button type="button" onClick={chat.stop} className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong px-2.5 text-xs text-foreground hover:bg-surface-2">
              <RiStopFill size={12} aria-hidden /> Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || !!notConfigured}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/85 disabled:opacity-40"
            >
              <RiSendPlane2Line size={12} aria-hidden /> Send
            </button>
          )}
        </div>
      </form>
    </aside>
  )
}

function Intro({ starters, onPick }: { starters: string[]; onPick(q: string): void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Ask about what is on screen, how a rule in this platform works, or the mechanics of trading these markets. Answers use the page’s own numbers and the app’s rules.
      </p>
      <ul className="space-y-1.5">
        {starters.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Message({ m }: { m: ChatItem }) {
  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-foreground">
          {m.content}
          {m.web && (
            <span className="mt-1 flex items-center gap-1 text-2xs text-muted">
              <RiGlobalLine size={11} aria-hidden /> web search
            </span>
          )}
        </div>
      </div>
    )
  return (
    <div className="text-foreground/90">
      {m.content ? <Markdown text={m.content} /> : m.streaming ? <p className="text-xs text-muted motion-safe:animate-pulse">Thinking…</p> : null}
      {m.error && <p className={clsx('text-xs text-neg-text', m.content && 'mt-2')}>{m.error}</p>}
      {m.stopped && <p className="mt-1 text-2xs text-faint">Stopped.</p>}
      {m.done && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone="neutral" title={`${m.done.tokens ?? '—'} tokens`}>
            <span className="num normal-case tracking-normal">{usd(m.done.costUsd)}</span>
          </Chip>
          <span className="num text-2xs text-faint">{shortModel(m.done.model)}</span>
          {m.done.fallback && (
            <Chip tone="moderate" title="Monthly spend is over 80% of the cap, so the cheaper fallback model answered">
              Fallback
            </Chip>
          )}
        </div>
      )}
    </div>
  )
}

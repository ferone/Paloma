import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { RiQuestionAnswerLine } from 'react-icons/ri'
import { AssistantCtx, createRegistry, useAssistant, type AssistantControls } from './context'

// Owns the panel's open state, the context registry and the Ctrl/⌘+J shortcut.
// The panel (and react-markdown) load on first open, then stay mounted so a
// conversation and a running stream survive closing the panel.

const AssistantPanel = lazy(() => import('./AssistantPanel'))

interface Internal {
  prefill: { text: string; nonce: number } | null
  everOpened: boolean
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createRegistry)
  const [isOpen, setOpen] = useState(false)
  const [internal, setInternal] = useState<Internal>({ prefill: null, everOpened: false })
  const returnFocus = useRef<HTMLElement | null>(null)
  const openRef = useRef(isOpen)
  useEffect(() => {
    openRef.current = isOpen
  }, [isOpen])

  const open = useCallback((prefill?: string) => {
    if (!openRef.current) {
      const a = document.activeElement
      returnFocus.current = a instanceof HTMLElement && a !== document.body ? a : null
    }
    setOpen(true)
    setInternal((s) => ({ everOpened: true, prefill: prefill ? { text: prefill, nonce: (s.prefill?.nonce ?? 0) + 1 } : s.prefill }))
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    const el = returnFocus.current
    returnFocus.current = null
    if (el?.isConnected) requestAnimationFrame(() => el.focus())
  }, [])

  const toggle = useCallback(() => (openRef.current ? close() : open()), [open, close])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const value = useMemo<AssistantControls & { internal: Internal }>(() => ({ isOpen, open, close, toggle, registry, internal }), [isOpen, open, close, toggle, registry, internal])
  return <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>
}

/** The docked panel. Mount once, after the main content. */
export function AssistantDock({ fetchImpl }: { fetchImpl?: typeof fetch } = {}) {
  const a = useAssistant() as (AssistantControls & { internal: Internal }) | null
  if (!a || !a.internal.everOpened) return null
  return (
    <Suspense fallback={null}>
      <AssistantPanel open={a.isOpen} onClose={a.close} prefill={a.internal.prefill} registry={a.registry} fetchImpl={fetchImpl} />
    </Suspense>
  )
}

/** Floating launcher, bottom-right, while the panel is closed. */
export function AssistantLauncher() {
  const a = useAssistant()
  if (!a || a.isOpen) return null
  return (
    <button
      type="button"
      onClick={() => a.open()}
      aria-keyshortcuts="Control+J Meta+J"
      title="Ask the assistant (Ctrl+J)"
      className="no-print fixed bottom-4 right-4 z-30 hidden items-center sm:inline-flex gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-xs font-medium text-foreground shadow-[var(--shadow-panel)] transition-colors hover:bg-surface-2"
    >
      <RiQuestionAnswerLine size={15} className="text-brand" aria-hidden />
      Ask
    </button>
  )
}

/** Top-bar toggle. */
export function AssistantToggle() {
  const a = useAssistant()
  if (!a) return null
  return (
    <button
      type="button"
      onClick={a.toggle}
      aria-pressed={a.isOpen}
      aria-keyshortcuts="Control+J Meta+J"
      title="Assistant (Ctrl+J)"
      className={clsx('rounded-md p-1.5 transition-colors hover:bg-surface-2 pointer-coarse:p-2.5', a.isOpen ? 'text-brand' : 'text-muted hover:text-foreground')}
    >
      <RiQuestionAnswerLine size={16} />
      <span className="sr-only">Toggle assistant</span>
    </button>
  )
}

/** Content wrapper that leaves room for the docked panel on wide screens. */
export function AssistantInset({ className, children }: { className?: string; children: ReactNode }) {
  const a = useAssistant()
  return <div className={clsx(className, a?.isOpen && 'lg:pr-[400px] print:pr-0')}>{children}</div>
}

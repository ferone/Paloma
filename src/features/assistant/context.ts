import { createContext, useContext, useEffect, useId, useMemo, type DependencyList } from 'react'

// The assistant's public surface for the rest of the app, kept free of UI so
// primitives (Explainer, HelpTip) and pages can import it cheaply.
//  - useAssistant(): open/close/toggle (null outside the provider);
//  - useAssistantContext(build, deps): a page publishes what it shows.

export interface PageContextValue {
  /** Short name of what is on screen, e.g. "Gold butterfly (c0−2·c1+c2)". */
  label: string
  /** Compact text of the figures on screen (kept under ~4 KB). */
  summary: string
}

/** Layout contexts (e.g. the Quant Lab's verdict mode) frame the page contexts nested in them. */
export type ContextLayer = 'layout' | 'page'

export interface RegistryEntry extends PageContextValue {
  id: string
  layer: ContextLayer
  seq: number
}

/** A tiny external store of the contexts registered by mounted components. */
export interface ContextRegistry {
  set(id: string, value: PageContextValue, layer: ContextLayer): void
  remove(id: string): void
  subscribe(fn: () => void): () => void
  getSnapshot(): readonly RegistryEntry[]
}

export function createRegistry(): ContextRegistry {
  const entries = new Map<string, RegistryEntry>()
  const subs = new Set<() => void>()
  let seq = 0
  let snapshot: readonly RegistryEntry[] = []
  const emit = () => {
    snapshot = [...entries.values()].sort((a, b) => (a.layer === b.layer ? a.seq - b.seq : a.layer === 'layout' ? -1 : 1))
    subs.forEach((f) => f())
  }
  return {
    set(id, value, layer) {
      const prev = entries.get(id)
      if (prev && prev.label === value.label && prev.summary === value.summary && prev.layer === layer) return
      entries.set(id, { id, layer, seq: prev?.seq ?? ++seq, label: value.label, summary: value.summary })
      emit()
    },
    remove(id) {
      if (entries.delete(id)) emit()
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    getSnapshot: () => snapshot,
  }
}

/** Label and summary the assistant sends: the newest page context wins the label; summaries are joined (layouts first). PURE. */
export function resolveContext(entries: readonly RegistryEntry[], fallback: PageContextValue): PageContextValue {
  if (!entries.length) return fallback
  const pages = entries.filter((e) => e.layer === 'page')
  const label = (pages.at(-1) ?? entries.at(-1))!.label
  const summary = entries.map((e) => (e.summary ? `[${e.label}]\n${e.summary}` : '')).filter(Boolean).join('\n\n')
  return { label, summary }
}

export interface AssistantControls {
  isOpen: boolean
  /** Open the panel; `prefill` replaces the input text (not sent). */
  open(prefill?: string): void
  close(): void
  toggle(): void
  registry: ContextRegistry
}

export const AssistantCtx = createContext<AssistantControls | null>(null)

/** Assistant controls, or null when rendered outside the provider (tests, print views). */
export function useAssistant(): AssistantControls | null {
  return useContext(AssistantCtx)
}

/**
 * Publish what this component shows to the assistant while it is mounted.
 * `build` runs again only when `deps` change.
 */
export function useAssistantContext(build: () => PageContextValue | null, deps: DependencyList, layer: ContextLayer = 'page'): void {
  const registry = useContext(AssistantCtx)?.registry
  const id = useId()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(build, deps)
  useEffect(() => {
    if (!registry) return
    if (value) registry.set(id, value, layer)
    else registry.remove(id)
  }, [registry, id, value, layer])
  useEffect(() => () => registry?.remove(id), [registry, id])
}

export const askPrompt = (term: string) => `Explain ${term} in the context of what I'm looking at.`

/** Publishes a context from places where hooks can't run directly (render props). Renders nothing. */
export function AssistantContextSource({ value }: { value: PageContextValue | null }): null {
  useAssistantContext(() => value, [value?.label, value?.summary])
  return null
}

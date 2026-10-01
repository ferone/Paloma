// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AssistantChatRequest, AssistantUsage } from '@shared/assistant'
import { SettingsProvider } from '../../store/settings-context'
import { Explainer } from '../../ui'
import AssistantPanel from './AssistantPanel'
import { AssistantProvider } from './AssistantProvider'
import { createRegistry, resolveContext, useAssistant, useAssistantContext, type ContextRegistry } from './context'
import { fallbackContext, startersFor } from './starters'
import { STORAGE_KEY } from './useChat'

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

function Page({ label, summary }: { label: string; summary: string }) {
  useAssistantContext(() => ({ label, summary }), [label, summary])
  return null
}

let registryOut: ContextRegistry | null = null
function Probe() {
  const r = useAssistant()?.registry ?? null
  useEffect(() => {
    registryOut = r
  })
  return null
}

describe('context registry', () => {
  it('returns the mounted page summary and forgets it on unmount', () => {
    const ui = (show: boolean) => (
      <AssistantProvider>
        <Probe />
        <Page label="Quant Lab" summary="mode conservative" />
        {show && <Page label="Gold butterfly (GC.fly.0-1-2)" summary="OU half-life 0.4 d" />}
      </AssistantProvider>
    )
    const { rerender } = render(ui(true))
    const fb = { label: 'fallback', summary: '' }
    let ctx = resolveContext(registryOut!.getSnapshot(), fb)
    expect(ctx.label).toBe('Gold butterfly (GC.fly.0-1-2)')
    expect(ctx.summary).toContain('OU half-life 0.4 d')
    expect(ctx.summary).toContain('mode conservative')
    rerender(ui(false))
    ctx = resolveContext(registryOut!.getSnapshot(), fb)
    expect(ctx.label).toBe('Quant Lab')
    expect(ctx.summary).not.toContain('OU half-life')
  })

  it('layout contexts come first and page contexts win the label', () => {
    const r = createRegistry()
    r.set('p', { label: 'Instrument', summary: 'b' }, 'page')
    r.set('l', { label: 'Layout', summary: 'a' }, 'layout')
    const ctx = resolveContext(r.getSnapshot(), { label: 'x', summary: '' })
    expect(ctx.label).toBe('Instrument')
    expect(ctx.summary.indexOf('[Layout]')).toBeLessThan(ctx.summary.indexOf('[Instrument]'))
    expect(resolveContext([], { label: 'Fallback', summary: 's' })).toEqual({ label: 'Fallback', summary: 's' })
  })

  it('builds a generic fallback and per-page starters', () => {
    const f = fallbackContext('/markets/curve', '?range=1y', 'silver')
    expect(f.label).toBe('Markets · curve')
    expect(f.summary).toContain('Silver')
    expect(f.summary).toContain('range=1y')
    expect(startersFor('/quant/i/GC.fly.0-1-2')).toContain('What does OU fail mean here?')
    expect(startersFor('/quant/i/GC.fly.0-1-2').length).toBeGreaterThanOrEqual(3)
  })
})

describe('Explainer "Ask about this"', () => {
  it('appears inside the provider and opens the assistant prefilled', () => {
    let open = false
    function OpenState() {
      const isOpen = !!useAssistant()?.isOpen
      useEffect(() => {
        open = isOpen
      })
      return null
    }
    render(
      <AssistantProvider>
        <OpenState />
        <Explainer title="What is the OU half-life?" ask="OU half-life">
          <p>body</p>
        </Explainer>
      </AssistantProvider>,
    )
    fireEvent.click(screen.getByText('Ask about this'))
    expect(open).toBe(true)
  })

  it('is absent outside the provider', () => {
    render(
      <Explainer title="Plain">
        <p>body</p>
      </Explainer>,
    )
    expect(screen.queryByText('Ask about this')).toBeNull()
  })
})

function sseFetch(capture: { body?: AssistantChatRequest }): typeof fetch {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body)) as AssistantChatRequest
    const enc = new TextEncoder()
    const parts = [
      'event: delta\ndata: {"text":"OU **fails** here: "}\n\n',
      'event: delta\ndata: {"text":"half-life 0.4 d."}\n\n',
      'event: done\ndata: {"costUsd":0.0012,"tokens":900,"model":"google/gemini-2.5-flash","fallback":false,"monthSpendUsd":0.31,"capUsd":5}\n\n',
    ]
    return new Response(
      new ReadableStream({
        async start(c) {
          for (const p of parts) {
            await new Promise((r) => setTimeout(r, 5))
            c.enqueue(enc.encode(p))
          }
          c.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  }) as unknown as typeof fetch
}

describe('AssistantPanel', () => {
  function setup(fetchImpl: typeof fetch) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData<AssistantUsage>(['assistant', 'usage'], { monthSpendUsd: 0.3, capUsd: 5, model: 'a/b', fallbackModel: 'google/gemini-2.5-flash', configured: true, state: 'ok' })
    const registry = createRegistry()
    registry.set('page', { label: 'Gold butterfly (GC.fly.0-1-2)', summary: 'OU: tradable no — half-life 0.4d < 5d' }, 'page')
    render(
      <QueryClientProvider client={qc}>
        <SettingsProvider>
          <MemoryRouter initialEntries={['/quant/i/GC.fly.0-1-2']}>
            <AssistantPanel open onClose={() => {}} prefill={null} registry={registry} fetchImpl={fetchImpl} />
          </MemoryRouter>
        </SettingsProvider>
      </QueryClientProvider>,
    )
  }

  it('shows what it is looking at, sends the page context and renders the streamed markdown with its cost', async () => {
    const cap: { body?: AssistantChatRequest } = {}
    setup(sseFetch(cap))
    expect(screen.getByText('Gold butterfly (GC.fly.0-1-2)')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('What does OU fail mean here?'))
    })
    await waitFor(() => expect(screen.getByText('fails').tagName).toBe('STRONG'))
    await waitFor(() => expect(screen.getByText('$0.0012')).toBeTruthy())
    expect(screen.getByText(/half-life 0\.4 d\./)).toBeTruthy()
    expect(cap.body?.page.route).toBe('/quant/i/GC.fly.0-1-2')
    expect(cap.body?.page.summary).toContain('half-life 0.4d')
    expect(cap.body?.messages.at(-1)).toEqual({ role: 'user', content: 'What does OU fail mean here?' })
    expect(cap.body?.web).toBe(false)
    // Persisted for the tab.
    expect(sessionStorage.getItem(STORAGE_KEY)).toContain('half-life 0.4 d.')
  })

  it('shows the not-configured state with a link to Settings', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'not_configured', missing: ['OPENROUTER_API_KEY'], message: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    setup(f)
    fireEvent.change(screen.getByLabelText('Ask about this page'), { target: { value: 'hello' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Send'))
    })
    await waitFor(() => expect(screen.getByText(/needs an OpenRouter API key/)).toBeTruthy())
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
  })
})

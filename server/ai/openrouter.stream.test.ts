import { describe, expect, it } from 'vitest'
import { createSseParser } from '../../shared/assistant.js'
import { chatStream, type StreamEvent } from './openrouter.js'

/** A fetch whose body streams `chunks` (strings) with a microtask gap between each. */
function streamingFetch(chunks: string[], opts: { status?: number; onRequest?: (body: Record<string, unknown>, signal?: AbortSignal | null) => void; hang?: boolean } = {}): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    opts.onRequest?.(JSON.parse(String(init?.body)), init?.signal)
    if (opts.status && opts.status !== 200) return new Response('upstream busy', { status: opts.status })
    const enc = new TextEncoder()
    const signal = init?.signal
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, 1))
          if (signal?.aborted) {
            controller.error(new DOMException('The operation was aborted.', 'AbortError'))
            return
          }
          controller.enqueue(enc.encode(c))
        }
        if (opts.hang) {
          await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
          controller.error(new DOMException('The operation was aborted.', 'AbortError'))
          return
        }
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
}

const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('createSseParser', () => {
  it('handles events split mid-line, comments, CRLF and multi-line data', () => {
    const p = createSseParser()
    const got = [
      ...p.feed(': OPENROUTER PROCESSING\n\nevent: delta\nda'),
      ...p.feed('ta: {"text":"a"}\r\n\r\ndata: line1\ndata: line2\n'),
      ...p.feed('\n'),
      ...p.flush(),
    ]
    expect(got).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'message', data: 'line1\nline2' },
    ])
  })

  it('flushes a trailing event without the final blank line', () => {
    const p = createSseParser()
    expect(p.feed('data: tail')).toEqual([])
    expect(p.flush()).toEqual([{ event: 'message', data: 'tail' }])
  })
})

describe('chatStream', () => {
  it('yields deltas across arbitrary chunk boundaries, skips comments and reports usage cost at the end', async () => {
    const wire =
      ': OPENROUTER PROCESSING\n\n' +
      chunk({ model: 'google/gemini-2.5-flash', choices: [{ delta: { content: 'Half-life ' } }] }) +
      ': OPENROUTER PROCESSING\n\n' +
      chunk({ choices: [{ delta: { content: '0.4 d' } }] }) +
      chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }) +
      chunk({ choices: [], usage: { total_tokens: 1234, cost: 0.00042 } }) +
      'data: [DONE]\n\n'
    // Split into ragged 7-byte chunks.
    const parts = wire.match(/[\s\S]{1,7}/g)!
    let sent: Record<string, unknown> = {}
    const events = await collect(
      chatStream([{ role: 'user', content: 'q' }], { apiKey: 'k', model: 'google/gemini-2.5-flash', fetchImpl: streamingFetch(parts, { onRequest: (b) => (sent = b) }) }),
    )
    expect(sent.stream).toBe(true)
    expect(sent.usage).toEqual({ include: true })
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('Half-life 0.4 d')
    expect(events.at(-1)).toEqual({ type: 'done', model: 'google/gemini-2.5-flash', tokens: 1234, costUsd: 0.00042, finishReason: 'stop' })
  })

  it('turns :online into the web plugin', async () => {
    let sent: Record<string, unknown> = {}
    await collect(chatStream([{ role: 'user', content: 'q' }], { apiKey: 'k', model: 'x/y:online', fetchImpl: streamingFetch([chunk({ choices: [{ delta: { content: 'ok' } }] })], { onRequest: (b) => (sent = b) }) }))
    expect(sent.model).toBe('x/y')
    expect(sent.plugins).toEqual([{ id: 'web', max_results: 3 }])
  })

  it('reports HTTP errors and mid-stream provider errors without throwing', async () => {
    const http = await collect(chatStream([{ role: 'user', content: 'q' }], { apiKey: 'k', model: 'a/b', retries: 0, fetchImpl: streamingFetch([], { status: 400 }) }))
    expect(http).toEqual([{ type: 'error', message: 'OpenRouter HTTP 400: upstream busy' }])
    const mid = await collect(
      chatStream([{ role: 'user', content: 'q' }], { apiKey: 'k', model: 'a/b', fetchImpl: streamingFetch([chunk({ choices: [{ delta: { content: 'par' } }] }), chunk({ error: { message: 'overloaded' } })]) }),
    )
    expect(mid.map((e) => e.type)).toEqual(['delta', 'error'])
    expect(mid[1]).toMatchObject({ message: 'OpenRouter: overloaded' })
    const nokey = await collect(chatStream([{ role: 'user', content: 'q' }], { apiKey: '', model: 'a/b' }))
    expect(nokey[0].type).toBe('error')
  })

  it('retries a 429 before the first byte', async () => {
    let calls = 0
    const f = (async (...args: Parameters<typeof fetch>) => {
      calls++
      return calls === 1 ? new Response('slow down', { status: 429 }) : streamingFetch([chunk({ choices: [{ delta: { content: 'ok' } }] })])(...args)
    }) as typeof fetch
    const ev = await collect(chatStream([{ role: 'user', content: 'q' }], { apiKey: 'k', model: 'a/b', retries: 1, backoffMs: 1, fetchImpl: f }))
    expect(calls).toBe(2)
    expect(ev.at(-1)?.type).toBe('done')
  })

  it('stops on abort and propagates the signal upstream', async () => {
    const ctl = new AbortController()
    let upstream: AbortSignal | null | undefined
    const gen = chatStream([{ role: 'user', content: 'q' }], {
      apiKey: 'k',
      model: 'a/b',
      signal: ctl.signal,
      fetchImpl: streamingFetch([chunk({ choices: [{ delta: { content: 'first' } }] })], { hang: true, onRequest: (_b, s) => (upstream = s) }),
    })
    const out: StreamEvent[] = []
    for await (const e of gen) {
      out.push(e)
      if (e.type === 'delta') ctl.abort()
    }
    expect(upstream?.aborted).toBe(true)
    expect(out.map((e) => e.type)).toEqual(['delta', 'error'])
    expect(out[1]).toMatchObject({ aborted: true })
  })
})

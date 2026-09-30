import { describe, expect, it, vi } from 'vitest'
import { chat, extractCitations, extractJson } from './openrouter.js'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

const completion = {
  model: 'anthropic/claude-sonnet-4.6',
  choices: [
    {
      message: {
        content: '```json\n{"summary":"ok"}\n```',
        annotations: [
          { type: 'url_citation', url_citation: { url: 'https://www.reuters.com/markets/gold-1', title: 'Gold climbs' } },
          { type: 'other' },
        ],
      },
    },
  ],
  usage: { total_tokens: 1234, cost: 0.0123 },
}

describe('OpenRouter chat()', () => {
  it('returns text, citations, tokens and cost on success', async () => {
    const f = vi.fn(async () => ok(completion))
    const r = await chat([{ role: 'user', content: 'hi' }], { apiKey: 'k', model: 'anthropic/claude-sonnet-4.6:online', fetchImpl: f as unknown as typeof fetch })
    expect(r).toEqual({
      text: completion.choices[0].message.content,
      citations: [{ url: 'https://www.reuters.com/markets/gold-1', title: 'Gold climbs' }],
      model: 'anthropic/claude-sonnet-4.6',
      tokens: 1234,
      costUsd: 0.0123,
      finishReason: null,
    })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    const sent = JSON.parse(String(init.body))
    // ':online' is sent as the equivalent, result-capped web plugin.
    expect(sent.model).toBe('anthropic/claude-sonnet-4.6')
    expect(sent.plugins).toEqual([{ id: 'web', max_results: 3 }])
    expect(sent.usage).toEqual({ include: true })
  })

  it('sends no web plugin for offline models and reports truncation', async () => {
    const f = vi.fn(async () => ok({ choices: [{ finish_reason: 'length', message: { content: '{"a":' } }] }))
    const r = await chat([], { apiKey: 'k', model: 'openai/gpt-5-mini', fetchImpl: f as unknown as typeof fetch })
    expect(r?.finishReason).toBe('length')
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent.model).toBe('openai/gpt-5-mini')
    expect(sent.plugins).toBeUndefined()
  })

  it('returns null without a key and never calls fetch', async () => {
    const f = vi.fn()
    const onError = vi.fn()
    expect(await chat([], { apiKey: '', model: 'm/x', fetchImpl: f as unknown as typeof fetch, onError })).toBeNull()
    expect(f).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('OPENROUTER_API_KEY is not set')
  })

  it('retries 429/5xx then returns null (never throws)', async () => {
    const f = vi.fn(async () => new Response('busy', { status: 503 }))
    const onError = vi.fn()
    const r = await chat([], { apiKey: 'k', model: 'm/x', retries: 2, backoffMs: 1, fetchImpl: f as unknown as typeof fetch, onError })
    expect(r).toBeNull()
    expect(f).toHaveBeenCalledTimes(3)
    expect(onError.mock.calls[0][0]).toContain('HTTP 503')
  })

  it('recovers when a retry succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(ok(completion))
    const r = await chat([], { apiKey: 'k', model: 'm/x', backoffMs: 1, fetchImpl: f as unknown as typeof fetch })
    expect(r?.tokens).toBe(1234)
  })

  it('does not retry other 4xx and survives network errors', async () => {
    const f400 = vi.fn(async () => new Response('bad model', { status: 400 }))
    expect(await chat([], { apiKey: 'k', model: 'm/x', backoffMs: 1, fetchImpl: f400 as unknown as typeof fetch })).toBeNull()
    expect(f400).toHaveBeenCalledTimes(1)
    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const onError = vi.fn()
    expect(await chat([], { apiKey: 'k', model: 'm/x', retries: 1, backoffMs: 1, fetchImpl: boom as unknown as typeof fetch, onError })).toBeNull()
    expect(boom).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith('fetch failed')
  })

  it('treats an empty completion as a failure', async () => {
    const f = vi.fn(async () => ok({ choices: [{ message: { content: '' } }] }))
    expect(await chat([], { apiKey: 'k', model: 'm/x', retries: 0, fetchImpl: f as unknown as typeof fetch })).toBeNull()
  })
})

describe('extractJson / extractCitations', () => {
  it('parses fenced, bare and prose-wrapped JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here you go: {"a":{"b":[1,2]}} thanks')).toEqual({ a: { b: [1, 2] } })
    expect(extractJson('no json')).toBeNull()
    expect(extractJson('{broken')).toBeNull()
    expect(extractJson(null)).toBeNull()
  })

  it('reads top-level citations arrays too', () => {
    expect(extractCitations({ citations: ['https://a.com/x', { url: 'https://b.org/y', title: 'B' }, 42] })).toEqual([
      { url: 'https://a.com/x' },
      { url: 'https://b.org/y', title: 'B' },
    ])
  })
})

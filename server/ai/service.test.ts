import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestDb } from '../db/client.js'
import { writeArtifact } from '../db/repo.js'
import { upsertMacro } from '../db/shared-repo.js'
import { ARTIFACTS, type QuantSnapshotLite } from '../../shared/artifacts.js'
import { BadRequest, parseRequest, startReport } from './service.js'
import { deleteReport, failOrphans, getReport, insertRunning, listReports } from './repo.js'
import { filterModels, getAiSettings, putAiSettings } from './settings.js'
import { buildMessages } from './prompts.js'
import { contextFor } from './context.js'

const reply = (content: string, annotations: unknown[] = []) =>
  vi.fn(async () =>
    Response.json({ model: 'x', choices: [{ message: { content, annotations } }], usage: { total_tokens: 900, cost: 0.004 } }),
  )

describe('AI prompts', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('briefs a real-assets analyst with the asset and its class in context', () => {
    const m = buildMessages({ kind: 'macro_brief', metal: 'silver', online: false, blocks: [], today: '2026-10-01' })
    expect(m[0].content).toContain('real-assets analyst')
    expect(m[0].content).not.toContain('gold and silver')
    expect(m[1].content).toContain('Asset in focus: Silver (precious metals, COMEX futures SI, priced in $/oz).')
    expect(m[1].content).toContain('precious metals drivers')
    const blocks = contextFor('macro_brief', 'silver')
    expect(blocks.map((b) => b.name)).toEqual(['Macro dashboard', 'COT positioning'])
    expect(blocks[1].text).toContain('CFTC COT (SILVER): not available')
    expect(contextFor('portfolio_commentary', 'gold').map((b) => b.name)).toEqual(['Portfolio summary', 'Macro dashboard (gold)', 'Macro dashboard (silver)'])
  })
})

describe('AI report service', () => {
  beforeEach(() => {
    useTestDb()
    upsertMacro([
      { seriesId: 'DFII10', date: '2026-06-26', value: 2.18, source: 'fred' },
      { seriesId: 'DFII10', date: '2026-09-28', value: 2.9, source: 'fred' },
    ])
  })

  it('generates, validates sources and stores a macro brief', async () => {
    const content = JSON.stringify({
      summary: 'Real yields at 2.90% (2026-09-28) are a headwind.',
      outlook: 'bearish',
      drivers: [
        { title: 'Real yields', detail: 'Up 72bp in 3m', sentiment: 'bearish', sources: [{ url: 'https://fred.stlouisfed.org/series/DFII10' }] },
        { title: 'ETF flows', detail: 'Inflows', sentiment: 'bullish', sources: [{ url: 'https://www.ft.com/content/abc', publisher: 'FT' }] },
        { title: 'Invented', detail: 'x', sentiment: 'neutral', sources: [{ url: 'https://www.bloomberg.com/fake' }] },
      ],
      risks: [{ text: 'Dollar rally', sources: [] }],
      whatWouldChangeMyMind: [{ text: 'Real yields < 2%', sources: [] }],
    })
    const f = reply(content, [{ type: 'url_citation', url_citation: { url: 'https://www.ft.com/content/abc', title: 'Gold ETFs' } }])
    const { id, done } = startReport(parseRequest({ kind: 'macro_brief', metal: 'gold' }), { apiKey: 'k', fetchImpl: f as unknown as typeof fetch, today: '2026-10-01' })
    expect(getReport(id)!.status).toBe('running')
    const r = await done
    expect(r.status).toBe('succeeded')
    expect(r.tokens).toBe(900)
    expect(r.costUsd).toBe(0.004)
    expect(r.model).toBe('anthropic/claude-sonnet-4.6:online') // default settings: online on
    expect(r.droppedSources).toBe(1)
    expect(r.unsourcedCount).toBe(3)
    expect(r.sources.map((s) => s.url)).toEqual(['https://fred.stlouisfed.org/series/DFII10', 'https://www.ft.com/content/abc'])
    expect(r.webResults).toEqual([{ url: 'https://www.ft.com/content/abc', title: 'Gold ETFs' }])
    expect(r.context.find((c) => c.name === 'Macro dashboard')).toMatchObject({ present: true, asOf: '2026-09-28' })
    expect(r.context.find((c) => c.name === 'COT positioning')!.present).toBe(false)
    expect(r.title).toBe('Gold macro brief')

    // The prompt carried live numbers with dates and stated the absent block.
    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const user = sent.messages[1].content as string
    expect(user).toContain('Real yield (10y TIPS): 2.90')
    expect(user).toContain('CFTC COT (GOLD): not available')
    expect(user).toContain('https://fred.stlouisfed.org/series/DFII10')

    expect(listReports({ kind: 'macro_brief' })).toHaveLength(1)
    expect(deleteReport(id)).toBe(true)
    expect(getReport(id)).toBeNull()
  })

  it('stores a failure (never throws) when OpenRouter errors or returns junk', async () => {
    const bad = vi.fn(async () => new Response('nope', { status: 401 }))
    const r = await startReport(parseRequest({ kind: 'ask', metal: 'silver', input: { question: 'Why?' } }), { apiKey: 'k', fetchImpl: bad as unknown as typeof fetch, retries: 0 }).done
    expect(r.status).toBe('failed')
    expect(r.error).toContain('HTTP 401')
    const junk = reply('I cannot answer in JSON')
    const r2 = await startReport(parseRequest({ kind: 'ask', metal: 'gold', input: { question: 'Why?' } }), { apiKey: 'k', fetchImpl: junk as unknown as typeof fetch }).done
    expect(r2.status).toBe('failed')
    expect(r2.error).toMatch(/valid JSON/)
    expect(r2.costUsd).toBe(0.004)
  })

  it('validates requests and resolves trade-brief opportunities from the quant snapshot', () => {
    expect(() => parseRequest({ kind: 'nope' })).toThrow(BadRequest)
    expect(() => parseRequest({ kind: 'ask', input: {} })).toThrow(/question/)
    expect(() => parseRequest({ kind: 'trade_brief', metal: 'gold' })).toThrow(/opportunity/)
    // An unknown asset is rejected, never silently turned into gold.
    expect(() => parseRequest({ kind: 'macro_brief', metal: 'unobtainium' })).toThrow(/unknown asset/)
    expect(parseRequest({ kind: 'macro_brief', asset: 'silver' }).metal).toBe('silver')
    const snap: QuantSnapshotLite = {
      asOf: '2026-09-30',
      dataThrough: '2026-09-29',
      opportunities: [
        { id: 'GC.fly.0-1-2', metal: 'gold', label: 'GC fly', side: 'long', tier: 'STRONG', verdict: 'BUY', qtRank: 80, z: -2.1, oosStatus: 'passed' },
        { id: 'GC.cal.0-1', metal: 'gold', label: 'GC calendar', side: 'short', tier: 'WATCH', verdict: 'AVOID', qtRank: 40, z: 1, oosStatus: 'untested' },
      ],
    }
    writeArtifact(ARTIFACTS.quantSnapshot, snap)
    expect(parseRequest({ kind: 'trade_brief', metal: 'gold' }).input!.opportunity!.id).toBe('GC.fly.0-1-2')
    expect(parseRequest({ kind: 'trade_brief', metal: 'gold', input: { opportunityId: 'GC.cal.0-1' } }).input!.opportunity!.id).toBe('GC.cal.0-1')
  })

  it('marks orphaned running reports as failed', () => {
    insertRunning({ kind: 'ask', metal: 'gold', model: 'm/x', promptHash: 'h', request: { kind: 'ask', metal: 'gold' }, context: [], asOf: null, online: false })
    expect(failOrphans()).toBe(1)
    expect(listReports()[0].status).toBe('failed')
  })
})

describe('AI settings and model catalogue', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('persists model and online toggle, stripping :online from ids', () => {
    expect(getAiSettings().online).toBe(true)
    expect(putAiSettings({ model: 'openai/gpt-5-mini:online', online: false })).toEqual({ model: 'openai/gpt-5-mini', online: false })
    expect(getAiSettings()).toEqual({ model: 'openai/gpt-5-mini', online: false })
    expect(putAiSettings({ model: 'bad model id' })).toHaveProperty('error')
  })

  it('filters the catalogue to sensible text chat models', () => {
    const models = filterModels([
      { id: 'anthropic/claude-sonnet-4.6', name: 'Sonnet', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
      { id: 'openai/text-embedding-3', context_length: 8000, architecture: { output_modalities: ['embeddings'] } },
      { id: 'someone/tiny-model', context_length: 128000, architecture: { output_modalities: ['text'] } },
      { id: 'google/gemini-image', context_length: 64000, architecture: { output_modalities: ['image', 'text'] } },
      { id: 'meta-llama/llama-small', context_length: 8000, architecture: { output_modalities: ['text'] } },
      { id: 'openai/gpt-oss:free', context_length: 128000, architecture: { output_modalities: ['text'] } },
    ])
    expect(models).toEqual([{ id: 'anthropic/claude-sonnet-4.6', name: 'Sonnet', contextLength: 200000, promptPrice: 3, completionPrice: 15 }])
  })
})

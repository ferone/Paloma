import { createHash } from 'node:crypto'
import type { NotConfigured } from '../../shared/api.js'
import type { AiReport, ReportKind, ReportRequest, SourceRef } from '../../shared/ai.js'
import { REPORT_KINDS } from '../../shared/ai.js'
import { isAssetId, parseAssetId } from '../../shared/universe.js'
import { ARTIFACTS, type QuantOpportunityLite, type QuantSnapshotLite } from '../../shared/artifacts.js'
import { readArtifact } from '../db/repo.js'
import { env } from '../lib/env.js'
import { chat, extractJson, type ChatResult, type Citation } from './openrouter.js'
import { contextFor } from './context.js'
import { buildMessages } from './prompts.js'
import { SourcePolicy, cleanTitle, isValidUrl, normalizeReport, normalizeUrl } from './sourcing.js'
import { completeReport, failReport, getReport, insertRunning } from './repo.js'
import { effectiveModel, getAiSettings } from './settings.js'

export const NOT_CONFIGURED: NotConfigured = {
  status: 'not_configured',
  missing: ['OPENROUTER_API_KEY'],
  message: 'The AI analyst needs an OpenRouter API key. Macro data, positioning and correlations work without it.',
}

export class BadRequest extends Error {}

function dedupeCitations(cs: Citation[]): SourceRef[] {
  const m = new Map<string, SourceRef>()
  for (const c of cs) if (isValidUrl(c.url) && !m.has(normalizeUrl(c.url))) m.set(normalizeUrl(c.url), { url: c.url, title: cleanTitle(c.title) })
  return [...m.values()]
}

/** Validate and complete a report request (resolves trade_brief opportunities from the quant snapshot). */
export function parseRequest(body: unknown): ReportRequest {
  const b = (body ?? {}) as Record<string, unknown>
  const kind = b.kind as ReportKind
  if (!REPORT_KINDS.includes(kind)) throw new BadRequest(`kind must be one of ${REPORT_KINDS.join(', ')}`)
  const raw = b.asset ?? b.metal
  if (raw != null && !isAssetId(raw)) throw new BadRequest(`unknown asset: ${String(raw)}`)
  const metal = parseAssetId(raw)
  const input = (b.input ?? {}) as NonNullable<ReportRequest['input']>
  if (kind === 'ask') {
    const q = typeof input.question === 'string' ? input.question.trim() : ''
    if (q.length < 3) throw new BadRequest('input.question is required for ask')
    return { kind, metal, input: { question: q.slice(0, 2000) } }
  }
  if (kind === 'trade_brief') {
    let opp: QuantOpportunityLite | undefined = input.opportunity
    if (!opp) {
      const snap = readArtifact<QuantSnapshotLite>(ARTIFACTS.quantSnapshot)?.data
      const pool = snap?.opportunities.filter((o) => o.asset === metal) ?? []
      opp = input.opportunityId ? pool.find((o) => o.id === input.opportunityId) : [...pool].sort((a, b) => b.qtRank - a.qtRank)[0]
    }
    if (!opp || typeof opp.id !== 'string' || typeof opp.label !== 'string')
      throw new BadRequest('trade_brief needs an opportunity: post input.opportunity, or run the quant engine so a snapshot exists')
    return { kind, metal: isAssetId(opp.asset) ? opp.asset : metal, input: { opportunity: opp } }
  }
  return { kind, metal }
}

export interface GenerateDeps {
  apiKey?: string
  fetchImpl?: typeof fetch
  today?: string
  retries?: number
  backoffMs?: number
}

/**
 * Create a report row and run the generation. Returns the row id immediately
 * with `done` resolving when the row is final. Never throws after the row exists.
 */
export function startReport(req: ReportRequest, deps: GenerateDeps = {}): { id: number; done: Promise<AiReport> } {
  const settings = getAiSettings()
  const model = effectiveModel(settings)
  const blocks = contextFor(req.kind, req.metal, req.input?.opportunity)
  const today = deps.today ?? new Date().toISOString().slice(0, 10)
  const messages = buildMessages({ kind: req.kind, metal: req.metal, online: settings.online, blocks, question: req.input?.question, today })
  const promptHash = createHash('sha256').update(JSON.stringify({ model, messages })).digest('hex').slice(0, 16)
  const asOf = blocks.map((b) => b.asOf).filter((d): d is string => !!d).sort().at(-1) ?? null
  const id = insertRunning({
    kind: req.kind,
    metal: req.metal,
    model,
    promptHash,
    request: req,
    context: blocks.map((b) => ({ name: b.name, present: b.present, asOf: b.asOf })),
    asOf,
    online: settings.online,
  })

  const done = (async (): Promise<AiReport> => {
    let result: ChatResult | null = null
    try {
      let error = 'OpenRouter request failed'
      result = await chat(messages, {
        apiKey: deps.apiKey ?? env.openrouterKey,
        model,
        maxTokens: req.kind === 'ask' ? 2000 : 4000,
        fetchImpl: deps.fetchImpl,
        retries: deps.retries,
        backoffMs: deps.backoffMs,
        onError: (m) => (error = m),
      })
      if (!result) {
        failReport(id, error)
      } else {
        const raw = extractJson<Record<string, unknown>>(result.text)
        const policy = new SourcePolicy(result.citations, blocks.flatMap((b) => b.urls))
        const norm = normalizeReport(req.kind, raw, policy, req.input?.question ?? '')
        const webResults = dedupeCitations(result.citations)
        if (!norm)
          failReport(
            id,
            result.finishReason === 'length'
              ? 'The model reply was cut off at the token limit before the JSON report was complete'
              : 'The model did not return a valid JSON report',
            { rawText: result.text, tokens: result.tokens, costUsd: result.costUsd, webResults },
          )
        else
          completeReport(id, {
            body: norm.body,
            sources: norm.sources,
            webResults,
            rawText: result.text,
            tokens: result.tokens,
            costUsd: result.costUsd,
            model,
            droppedSources: norm.droppedSources,
            unsourcedCount: norm.unsourcedCount,
          })
      }
    } catch (err) {
      failReport(id, err instanceof Error ? err.message : String(err), { rawText: result?.text })
    }
    return getReport(id)!
  })()
  return { id, done }
}

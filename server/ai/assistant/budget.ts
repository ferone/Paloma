import type { AiModelsResponse } from '../../../shared/ai.js'
import type { AssistantSettings, BudgetState } from '../../../shared/assistant.js'
import { getDb } from '../../db/client.js'
import { getSetting, readArtifact, setSetting } from '../../db/repo.js'
import { cleanModelId, getAiSettings, isValidModelId } from '../settings.js'

// Assistant budget: a monthly USD cap on OpenRouter spend (assistant chats +
// AI analyst reports). At 80% of the cap the cheaper fallback model answers;
// at 100% the assistant refuses until the next UTC month or a higher cap.

export const DEFAULT_CAP_USD = 5
export const DEFAULT_FALLBACK_MODEL = 'google/gemini-2.5-flash'
export const FALLBACK_AT = 0.8

const K = { model: 'ai.assistant.model', fallback: 'ai.assistant.fallbackModel', cap: 'ai.assistant.monthlyCapUsd' } as const

export function getAssistantSettings(): AssistantSettings {
  const model = getSetting<string | null>(K.model, null)
  const fallback = getSetting<string | null>(K.fallback, null)
  const cap = Number(getSetting<number>(K.cap, DEFAULT_CAP_USD))
  return {
    model: model && isValidModelId(model) ? model : getAiSettings().model,
    fallbackModel: fallback && isValidModelId(fallback) ? fallback : DEFAULT_FALLBACK_MODEL,
    monthlyCapUsd: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_CAP_USD,
  }
}

/** Models in the cached OpenRouter catalogue (empty when it was never fetched). */
function catalogueIds(): Set<string> {
  const c = readArtifact<AiModelsResponse>('ai:models')
  return new Set((c?.data.models ?? []).map((m) => m.id))
}

export function putAssistantSettings(input: Partial<AssistantSettings>): AssistantSettings | { error: string } {
  const next = getAssistantSettings()
  const known = catalogueIds()
  const model = (raw: unknown, name: string): string | { error: string } => {
    const m = cleanModelId(String(raw ?? ''))
    if (!isValidModelId(m)) return { error: `${name} must be an OpenRouter id like "provider/model"` }
    if (known.size && !known.has(m)) return { error: `${name} "${m}" is not in the OpenRouter catalogue` }
    return m
  }
  if (input.model !== undefined) {
    const m = model(input.model, 'model')
    if (typeof m !== 'string') return m
    next.model = m
  }
  if (input.fallbackModel !== undefined) {
    const m = model(input.fallbackModel, 'fallbackModel')
    if (typeof m !== 'string') return m
    next.fallbackModel = m
  }
  if (input.monthlyCapUsd !== undefined) {
    const n = Number(input.monthlyCapUsd)
    if (!Number.isFinite(n) || n < 0 || n > 10_000) return { error: 'monthlyCapUsd must be a number between 0 and 10000' }
    next.monthlyCapUsd = Math.round(n * 100) / 100
  }
  setSetting(K.model, next.model)
  setSetting(K.fallback, next.fallbackModel)
  setSetting(K.cap, next.monthlyCapUsd)
  return next
}

/** First instant of the UTC month containing `now`, in the tables' created_at format. */
export function monthStartIso(now = new Date()): string {
  return `${now.toISOString().slice(0, 7)}-01T00:00:00Z`
}

/** OpenRouter spend this UTC month: assistant messages + AI analyst reports. */
export function monthSpendUsd(now = new Date()): number {
  const since = monthStartIso(now)
  const row = getDb()
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_chat_messages WHERE created_at >= ?) +
         (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_reports WHERE created_at >= ?) AS total`,
    )
    .get(since, since) as { total: number }
  return row.total
}

export interface BudgetDecision {
  state: BudgetState
  /** Model to call (without the ':online' suffix). */
  model: string
  fallback: boolean
}

/** Normal below 80% of the cap, fallback model from 80%, refuse at 100%. A cap of 0 refuses. PURE. */
export function decideBudget(spend: number, settings: AssistantSettings): BudgetDecision {
  const cap = settings.monthlyCapUsd
  if (cap <= 0 || spend >= cap) return { state: 'capped', model: settings.fallbackModel, fallback: true }
  if (spend >= FALLBACK_AT * cap) return { state: 'fallback', model: settings.fallbackModel, fallback: true }
  return { state: 'ok', model: settings.model, fallback: false }
}

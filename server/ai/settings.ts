import type { AiModel, AiModelsResponse, AiSettings, AiStatus } from '../../shared/ai.js'
import { getSetting, readArtifact, setSetting, writeArtifact } from '../db/repo.js'
import { env } from '../lib/env.js'
import { OPENROUTER_MODELS_URL } from './openrouter.js'

// Model selection (settings ai.model / ai.online) and the cached OpenRouter
// model catalogue (artifact 'ai:models', refreshed at most every 24h).

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i

/** Strip inline comments and any ':online' suffix (online is a separate toggle). */
export function cleanModelId(raw: string): string {
  return raw.split('#')[0].trim().replace(/:online$/i, '')
}

export function isValidModelId(id: string): boolean {
  return MODEL_ID.test(id) && id.length <= 120
}

export function defaultModel(): string {
  const m = cleanModelId(env.openrouterModel || '')
  return isValidModelId(m) ? m : 'anthropic/claude-sonnet-4.6'
}

export function getAiSettings(): AiSettings {
  const model = getSetting<string>('ai.model', defaultModel())
  return { model: isValidModelId(model) ? model : defaultModel(), online: getSetting<boolean>('ai.online', true) }
}

export function putAiSettings(input: Partial<AiSettings>): AiSettings | { error: string } {
  const next = { ...getAiSettings() }
  if (input.model !== undefined) {
    const m = cleanModelId(String(input.model))
    if (!isValidModelId(m)) return { error: 'model must be an OpenRouter id like "provider/model"' }
    next.model = m
  }
  if (input.online !== undefined) next.online = !!input.online
  setSetting('ai.model', next.model)
  setSetting('ai.online', next.online)
  return next
}

export const effectiveModel = (s: AiSettings) => (s.online ? `${s.model}:online` : s.model)

export function aiStatus(): AiStatus {
  const s = getAiSettings()
  return { configured: !!env.openrouterKey, model: s.model, online: s.online, effectiveModel: effectiveModel(s), defaultModel: defaultModel() }
}

// ── Model catalogue ────────────────────────────────────────────────────────

const PROVIDERS = new Set(['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'meta-llama', 'mistralai', 'qwen', 'perplexity', 'moonshotai', 'z-ai'])
const EXCLUDE = /(embed|moderation|image|audio|tts|whisper|dall-e|vision-only|guard|:free|:extended|:beta|:batch|-instruct-v0|search-preview)/i
const TTL_MS = 24 * 3600_000

interface RawModel {
  id?: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; modality?: string }
}

/** Keep sensible text chat models from mainstream providers, ≥32k context. PURE. */
export function filterModels(raw: RawModel[]): AiModel[] {
  const perM = (v?: string) => (v != null && Number.isFinite(Number(v)) ? Number((Number(v) * 1e6).toPrecision(6)) : null)
  return raw
    .filter((m): m is RawModel & { id: string } => typeof m.id === 'string' && isValidModelId(m.id))
    .filter((m) => PROVIDERS.has(m.id.split('/')[0]) && !EXCLUDE.test(m.id))
    .filter((m) => {
      const a = m.architecture
      const out = a?.output_modalities ?? (a?.modality ? [a.modality.split('->')[1] ?? ''] : ['text'])
      const inp = a?.input_modalities ?? ['text']
      return out.length === 1 && out[0].includes('text') && inp.includes('text')
    })
    .filter((m) => (m.context_length ?? 0) >= 32_000)
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length ?? null,
      promptPrice: perM(m.pricing?.prompt),
      completionPrice: perM(m.pricing?.completion),
    }))
    .filter((m) => (m.promptPrice ?? 0) >= 0)
    .sort((a, b) => a.id.localeCompare(b.id))
}

let inflight: Promise<AiModelsResponse> | null = null

export async function listModels(opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<AiModelsResponse> {
  const cached = readArtifact<AiModelsResponse>('ai:models')
  const fresh = cached && cached.data.fetchedAt && Date.now() - new Date(cached.data.fetchedAt).getTime() < TTL_MS
  if (cached && fresh && !opts.force) return cached.data
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await (opts.fetchImpl ?? fetch)(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { data?: RawModel[] }
      const out: AiModelsResponse = { models: filterModels(data.data ?? []), fetchedAt: new Date().toISOString() }
      writeArtifact('ai:models', out)
      return out
    } catch (err) {
      const msg = `Could not reach the OpenRouter model catalogue: ${err instanceof Error ? err.message : String(err)}`
      return cached ? { ...cached.data, error: msg } : { models: [], fetchedAt: null, error: msg }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

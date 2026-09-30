// AI analyst API contracts (owned by the macro/AI workstream).
// Server: server/ai/*. Client: src/features/macro/ai/*.
import type { AssetId } from './universe.js'
import type { QuantOpportunityLite } from './artifacts.js'

export type ReportKind = 'macro_brief' | 'trade_brief' | 'portfolio_commentary' | 'ask'
export const REPORT_KINDS: readonly ReportKind[] = ['macro_brief', 'trade_brief', 'portfolio_commentary', 'ask'] as const

export type Sentiment = 'bullish' | 'bearish' | 'neutral'
export type ReportStatus = 'running' | 'succeeded' | 'failed'

export interface SourceRef {
  url: string
  title?: string
  publisher?: string
  date?: string
}

/**
 * One factual statement. `sourced` is true only when at least one source URL
 * survived validation (a real citation returned by an `:online` model, or a
 * data-source URL the app itself put in the prompt). Otherwise the UI flags it.
 */
export interface Claim {
  text: string
  sources: SourceRef[]
  sourced: boolean
}

export interface Driver {
  title: string
  detail: string
  sentiment: Sentiment
  sources: SourceRef[]
  sourced: boolean
}

export interface MacroBriefBody {
  kind: 'macro_brief'
  summary: string
  outlook: Sentiment
  drivers: Driver[]
  risks: Claim[]
  whatWouldChangeMyMind: Claim[]
}

export interface TradeLeg {
  instrument: string
  side: 'long' | 'short'
  ratio?: string
  role?: string
}

export interface TradeBriefBody {
  kind: 'trade_brief'
  thesis: string
  structure: string
  legs: TradeLeg[]
  entryPlan: string
  catalysts: Claim[]
  risks: Claim[]
  invalidation: string
}

export interface PortfolioCommentaryBody {
  kind: 'portfolio_commentary'
  headline: string
  paragraph: string
  bullets: Claim[]
}

export interface AskBody {
  kind: 'ask'
  question: string
  answer: string
  points: Claim[]
}

export type ReportBody = MacroBriefBody | TradeBriefBody | PortfolioCommentaryBody | AskBody

export interface ReportRequest {
  kind: ReportKind
  /** Asset id (the field keeps its historical name). */
  metal: AssetId
  /** trade_brief: an opportunity (or its id in the quant snapshot). ask: { question }. */
  input?: { opportunity?: QuantOpportunityLite; opportunityId?: string; question?: string }
}

export interface AiReport {
  id: number
  kind: ReportKind
  /** Asset id (the field keeps its historical name). */
  metal: AssetId
  model: string
  status: ReportStatus
  error: string | null
  createdAt: string
  /** Date of the newest live data injected into the prompt. */
  asOf: string | null
  title: string
  /** The original request (used to regenerate). */
  request: ReportRequest
  body: ReportBody | null
  /** De-duplicated flat list of every validated source in the report. */
  sources: SourceRef[]
  /** Web results the provider's search returned (`:online` only); the allow-list for citations. */
  webResults: SourceRef[]
  /** Which live context blocks were present in the prompt. */
  context: { name: string; present: boolean; asOf: string | null }[]
  /** Number of URLs the model returned that were dropped as unverifiable. */
  droppedSources: number
  /** Claims/drivers without a verified source. */
  unsourcedCount: number
  online: boolean
  tokens: number | null
  /** USD cost reported by OpenRouter for the generation, when available. */
  costUsd: number | null
}

export type AiReportSummary = Omit<AiReport, 'body' | 'context' | 'webResults'>

export interface AiSettings {
  model: string
  online: boolean
}

export interface AiStatus {
  configured: boolean
  model: string
  online: boolean
  /** The model id actually sent to OpenRouter (model + ':online' when enabled). */
  effectiveModel: string
  defaultModel: string
}

export interface AiModel {
  id: string
  name: string
  contextLength: number | null
  /** USD per million tokens. */
  promptPrice: number | null
  completionPrice: number | null
}

export interface AiModelsResponse {
  models: AiModel[]
  fetchedAt: string | null
  /** Set when the OpenRouter catalogue could not be reached. */
  error?: string
}

import { getDb } from '../db/client.js'
import type { AiReport, AiReportSummary, ReportBody, ReportKind, ReportRequest, SourceRef } from '../../shared/ai.js'
import type { Metal } from '../../shared/universe.js'

// ai_reports repository (migration 041).

interface Row {
  id: number
  kind: ReportKind
  metal: Metal
  model: string
  prompt_hash: string
  request: string
  response: string | null
  sources: string
  citations: string
  context: string
  created_at: string
  as_of: string | null
  status: AiReport['status']
  error: string | null
  tokens: number | null
  cost_usd: number | null
  online: number
  dropped_sources: number
  unsourced_count: number
}

const KIND_TITLE: Record<ReportKind, string> = {
  macro_brief: 'Macro brief',
  trade_brief: 'Trade brief',
  portfolio_commentary: 'Portfolio commentary',
  ask: 'Question',
}

function titleOf(r: Row, body: ReportBody | null, req: ReportRequest): string {
  const metal = r.metal === 'silver' ? 'Silver' : 'Gold'
  if (r.kind === 'ask') return (req.input?.question ?? 'Question').slice(0, 120)
  if (r.kind === 'trade_brief') return `${KIND_TITLE.trade_brief} · ${req.input?.opportunity?.label ?? req.input?.opportunityId ?? metal}`
  if (r.kind === 'portfolio_commentary') return body?.kind === 'portfolio_commentary' && body.headline ? body.headline : KIND_TITLE.portfolio_commentary
  return `${metal} ${KIND_TITLE[r.kind].toLowerCase()}`
}

function toReport(r: Row): AiReport {
  const req = JSON.parse(r.request) as ReportRequest
  const body = r.response ? (JSON.parse(r.response) as ReportBody) : null
  return {
    id: r.id,
    kind: r.kind,
    metal: r.metal,
    model: r.model,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    asOf: r.as_of,
    title: titleOf(r, body, req),
    request: req,
    body,
    sources: JSON.parse(r.sources) as SourceRef[],
    webResults: JSON.parse(r.citations) as SourceRef[],
    context: JSON.parse(r.context) as AiReport['context'],
    droppedSources: r.dropped_sources,
    unsourcedCount: r.unsourced_count,
    online: r.online === 1,
    tokens: r.tokens,
    costUsd: r.cost_usd,
  }
}

export function insertRunning(p: {
  kind: ReportKind
  metal: Metal
  model: string
  promptHash: string
  request: ReportRequest
  context: AiReport['context']
  asOf: string | null
  online: boolean
}): number {
  return Number(
    getDb()
      .prepare(
        `INSERT INTO ai_reports (kind, metal, model, prompt_hash, request, context, as_of, status, online)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(p.kind, p.metal, p.model, p.promptHash, JSON.stringify(p.request), JSON.stringify(p.context), p.asOf, p.online ? 1 : 0)
      .lastInsertRowid,
  )
}

export function completeReport(
  id: number,
  p: {
    body: ReportBody
    sources: SourceRef[]
    webResults: SourceRef[]
    rawText: string
    tokens: number | null
    costUsd: number | null
    model: string
    droppedSources: number
    unsourcedCount: number
  },
): void {
  getDb()
    .prepare(
      `UPDATE ai_reports SET status = 'succeeded', response = ?, sources = ?, citations = ?, raw_text = ?, tokens = ?, cost_usd = ?, model = ?,
         dropped_sources = ?, unsourced_count = ?, error = NULL WHERE id = ?`,
    )
    .run(
      JSON.stringify(p.body),
      JSON.stringify(p.sources),
      JSON.stringify(p.webResults),
      p.rawText,
      p.tokens,
      p.costUsd,
      p.model,
      p.droppedSources,
      p.unsourcedCount,
      id,
    )
}

export function failReport(
  id: number,
  error: string,
  extra: { rawText?: string; tokens?: number | null; costUsd?: number | null; webResults?: SourceRef[] } = {},
): void {
  getDb()
    .prepare(
      `UPDATE ai_reports SET status = 'failed', error = ?, raw_text = COALESCE(?, raw_text), tokens = COALESCE(?, tokens),
         cost_usd = COALESCE(?, cost_usd), citations = COALESCE(?, citations) WHERE id = ?`,
    )
    .run(error.slice(0, 1000), extra.rawText ?? null, extra.tokens ?? null, extra.costUsd ?? null, extra.webResults ? JSON.stringify(extra.webResults) : null, id)
}

export function getReport(id: number): AiReport | null {
  const r = getDb().prepare('SELECT * FROM ai_reports WHERE id = ?').get(id) as Row | undefined
  return r ? toReport(r) : null
}

export function listReports(filter: { kind?: ReportKind; metal?: Metal; limit?: number } = {}): AiReportSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM ai_reports WHERE (? IS NULL OR kind = ?) AND (? IS NULL OR metal = ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(filter.kind ?? null, filter.kind ?? null, filter.metal ?? null, filter.metal ?? null, filter.limit ?? 100) as Row[]
  return rows.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { body, context, webResults, ...rest } = toReport(r)
    return rest
  })
}

export function deleteReport(id: number): boolean {
  return getDb().prepare('DELETE FROM ai_reports WHERE id = ?').run(id).changes > 0
}

/** Mark reports left 'running' by a previous server process as failed (called on boot). */
export function failOrphans(): number {
  return getDb().prepare(`UPDATE ai_reports SET status = 'failed', error = 'Interrupted by a server restart' WHERE status = 'running'`).run().changes
}

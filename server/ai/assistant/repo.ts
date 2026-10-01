import { getDb } from '../../db/client.js'

// Persistence of assistant messages (table ai_chat_messages, migration 043).

export interface ChatMessageRow {
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  route?: string | null
  context?: unknown
  model?: string | null
  tokens?: number | null
  costUsd?: number | null
}

export function insertChatMessage(m: ChatMessageRow): number {
  const r = getDb()
    .prepare(
      `INSERT INTO ai_chat_messages (session_id, role, content, route, context_json, model, tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.sessionId,
      m.role,
      m.content,
      m.route ?? null,
      m.context === undefined ? null : JSON.stringify(m.context),
      m.model ?? null,
      m.tokens ?? null,
      m.costUsd ?? null,
    )
  return Number(r.lastInsertRowid)
}

export function listSessionMessages(sessionId: string): (ChatMessageRow & { id: number; createdAt: string })[] {
  const rows = getDb()
    .prepare('SELECT id, session_id, role, content, route, model, tokens, cost_usd, created_at FROM ai_chat_messages WHERE session_id = ? ORDER BY id')
    .all(sessionId) as { id: number; session_id: string; role: 'user' | 'assistant'; content: string; route: string | null; model: string | null; tokens: number | null; cost_usd: number | null; created_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    route: r.route,
    model: r.model,
    tokens: r.tokens,
    costUsd: r.cost_usd,
    createdAt: r.created_at,
  }))
}

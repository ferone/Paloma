import { Router, type Response } from 'express'
import { ASSISTANT_LIMITS, type AssistantChatRequest, type AssistantDone, type AssistantSettings, type AssistantTurn, type AssistantUsage } from '../../../shared/assistant.js'
import { env } from '../../lib/env.js'
import { requireAdmin } from '../../lib/admin.js'
import { chatStream } from '../openrouter.js'
import { NOT_CONFIGURED } from '../service.js'
import { decideBudget, getAssistantSettings, monthSpendUsd, putAssistantSettings } from './budget.js'
import { pageBlock, sanitize, serverBlocks } from './context.js'
import { buildAssistantMessages } from './prompt.js'
import { retrieve } from './retrieve.js'
import { insertChatMessage } from './repo.js'

// /api/ai/assistant — the site-wide, context-aware assistant.
//   POST /chat      → text/event-stream: `delta` {text}…, then `done` or `error`
//   GET  /usage     → month spend vs cap, models, configured
//   GET/PUT /settings (PUT needs the admin PIN)
export const assistantRouter = Router()

interface Deps {
  fetchImpl?: typeof fetch
  now?: () => Date
}
let deps: Deps = {}
/** Test hook: inject the OpenRouter fetch and the clock. */
export function __setAssistantDeps(d: Deps): void {
  deps = d
}

export class BadChat extends Error {}

/** Validate and normalise a chat request body. Throws BadChat. PURE. */
export function parseChat(body: unknown): AssistantChatRequest {
  const b = (body ?? {}) as Record<string, unknown>
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId.trim() : ''
  if (!/^[\w-]{6,64}$/.test(sessionId)) throw new BadChat('sessionId must be 6–64 letters, digits, "-" or "_"')
  if (!Array.isArray(b.messages) || b.messages.length === 0) throw new BadChat('messages must be a non-empty array')
  const turns: AssistantTurn[] = []
  for (const m of b.messages.slice(-ASSISTANT_LIMITS.maxTurns) as unknown[]) {
    const r = m as Record<string, unknown>
    if ((r?.role !== 'user' && r?.role !== 'assistant') || typeof r.content !== 'string') throw new BadChat('each message needs role user|assistant and string content')
    turns.push({ role: r.role, content: r.role === 'assistant' ? r.content.slice(0, 8000) : r.content })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  const last = turns.at(-1)
  if (!last || last.role !== 'user') throw new BadChat('the last message must be the user question')
  const q = last.content.trim()
  if (!q) throw new BadChat('the question is empty')
  if (q.length > ASSISTANT_LIMITS.maxQuestionChars) throw new BadChat(`the question is longer than ${ASSISTANT_LIMITS.maxQuestionChars} characters`)
  for (const t of turns) if (t.role === 'user' && t.content.length > ASSISTANT_LIMITS.maxQuestionChars) t.content = t.content.slice(0, ASSISTANT_LIMITS.maxQuestionChars)
  const p = (b.page ?? {}) as Record<string, unknown>
  return {
    sessionId,
    messages: turns,
    page: {
      route: typeof p.route === 'string' && p.route.startsWith('/') ? p.route.slice(0, 200) : '/',
      title: typeof p.title === 'string' ? p.title.slice(0, 200) : '',
      asset: typeof p.asset === 'string' ? p.asset.slice(0, 40) : undefined,
      summary: typeof p.summary === 'string' ? p.summary : undefined,
    },
    web: b.web === true,
  }
}

function usage(): AssistantUsage {
  const s = getAssistantSettings()
  const spend = monthSpendUsd(deps.now?.() ?? new Date())
  return { monthSpendUsd: spend, capUsd: s.monthlyCapUsd, model: s.model, fallbackModel: s.fallbackModel, configured: !!env.openrouterKey, state: decideBudget(spend, s).state }
}

assistantRouter.get('/usage', (_req, res) => {
  res.json(usage())
})

assistantRouter.get('/settings', (_req, res) => {
  res.json(getAssistantSettings())
})

assistantRouter.put('/settings', requireAdmin, (req, res) => {
  const out = putAssistantSettings((req.body ?? {}) as Partial<AssistantSettings>)
  if ('error' in out) res.status(400).json(out)
  else res.json(out)
})

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

assistantRouter.post('/chat', async (req, res) => {
  const apiKey = env.openrouterKey
  if (!apiKey) {
    res.json(NOT_CONFIGURED)
    return
  }
  let chatReq: AssistantChatRequest
  try {
    chatReq = parseChat(req.body)
  } catch (err) {
    if (err instanceof BadChat) {
      res.status(400).json({ error: err.message })
      return
    }
    throw err
  }

  const now = deps.now?.() ?? new Date()
  const settings = getAssistantSettings()
  const spend = monthSpendUsd(now)
  const budget = decideBudget(spend, settings)
  if (budget.state === 'capped') {
    res.status(402).json({
      status: 'capped',
      error: 'budget_exhausted',
      message: `The assistant's monthly budget is used up ($${spend.toFixed(2)} of $${settings.monthlyCapUsd.toFixed(2)}). It resets on the 1st (UTC), or raise the cap in Settings → Assistant.`,
      monthSpendUsd: spend,
      capUsd: settings.monthlyCapUsd,
    })
    return
  }

  const { page, messages, sessionId, web } = chatReq
  const question = messages.at(-1)!.content
  const blocks = serverBlocks(page.route, page.asset)
  const glossary = retrieve(question, page.route, { history: messages.filter((m) => m.role === 'user').slice(0, -1).map((m) => m.content) })
  const pageText = pageBlock(page)
  const model = web ? `${budget.model}:online` : budget.model
  const prompt = buildAssistantMessages({ turns: messages, glossary: glossary.text, blocks, page: pageText, today: now.toISOString().slice(0, 10), web: !!web })
  const contextJson = {
    title: sanitize(page.title, 200),
    asset: page.asset ?? null,
    summaryBytes: Buffer.byteLength(page.summary ?? '', 'utf8'),
    blocks: blocks.map((b) => ({ name: b.name, present: b.present, asOf: b.asOf })),
    glossary: glossary.full,
    web: !!web,
  }
  insertChatMessage({ sessionId, role: 'user', content: question, route: page.route, context: contextJson })

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // The browser closing the stream (Stop, navigation) aborts the upstream call.
  const upstream = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) upstream.abort()
  })

  let text = ''
  for await (const ev of chatStream(prompt, { apiKey, model, maxTokens: 4000, temperature: 0.2, fetchImpl: deps.fetchImpl, signal: upstream.signal, retries: 1 })) {
    if (ev.type === 'delta') {
      text += ev.text
      send(res, 'delta', { text: ev.text })
    } else if (ev.type === 'done') {
      insertChatMessage({ sessionId, role: 'assistant', content: text, route: page.route, model: ev.model, tokens: ev.tokens, costUsd: ev.costUsd })
      const done: AssistantDone = {
        costUsd: ev.costUsd,
        tokens: ev.tokens,
        model: ev.model,
        fallback: budget.fallback,
        monthSpendUsd: spend + (ev.costUsd ?? 0),
        capUsd: settings.monthlyCapUsd,
      }
      send(res, 'done', done)
    } else {
      if (text) insertChatMessage({ sessionId, role: 'assistant', content: `${text}\n\n[interrupted: ${ev.message}]`, route: page.route, model })
      if (!ev.aborted) send(res, 'error', { message: ev.message })
    }
  }
  res.end()
})

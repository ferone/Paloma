import { GENERIC_VARS, GLOSSARY, fillGlossary, type GlossaryEntry } from '../../../shared/glossary.js'

// Glossary retrieval for the assistant: alias/keyword scoring over the shared
// glossary (no embeddings; the corpus is small and the vocabulary is precise).
// Order of inclusion: entries the question matches, then the always-on core,
// then entries for the current route, then one-line definitions of the rest,
// all within a character budget (~4 chars per token).

/** Always offered: the rules most answers about this platform rest on. */
export const CORE_IDS = ['qt-rank', 'ou', 'structural', 'verdict', 'month-codes'] as const

export const DEFAULT_BUDGET_TOKENS = 3000
const CHARS_PER_TOKEN = 4

/** Lower-case, strip punctuation (keep letters, digits and a few math symbols), collapse spaces. PURE. */
export function normalize(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}/+().·:−-]+/gu, ' ')
    .replace(/[.:]+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `
}

const ALIASES = new Map(GLOSSARY.map((e) => [e.id, [e.term, ...e.aliases].map((a) => normalize(a).trim()).filter(Boolean)]))

/** A futures symbol or month+year code in the raw question: GCZ26, SIH27, Z26, "Dec 26" style codes. */
const SYMBOL = /\b(?:[A-Z]{1,4})?[FGHJKMNQUVXZ]\d{2}\b/

/** Relevance of each entry to `text` (0 = unrelated). Longer, more specific aliases weigh more. PURE. */
export function scoreEntries(text: string): Map<string, number> {
  const norm = normalize(text)
  const out = new Map<string, number>()
  for (const e of GLOSSARY) {
    let s = 0
    for (const a of ALIASES.get(e.id) ?? []) if (norm.includes(` ${a} `)) s += 1 + a.length / 6
    if (e.id === 'month-codes' && SYMBOL.test(text)) s += 4
    if (s > 0) out.set(e.id, s)
  }
  return out
}

/** Entries whose `pages` prefix the route, most specific prefix first. PURE. */
export function entriesForRoute(route: string): string[] {
  const hits: { id: string; len: number }[] = []
  for (const e of GLOSSARY) {
    const best = Math.max(-1, ...e.pages.filter((p) => (p === '/' ? route === '/' : route === p || route.startsWith(`${p}/`))).map((p) => p.length))
    if (best >= 0) hits.push({ id: e.id, len: best })
  }
  return hits.sort((a, b) => b.len - a.len).map((h) => h.id)
}

export function entryText(e: GlossaryEntry): string {
  const body = fillGlossary([e.body, e.more].filter(Boolean).join('\n\n'), GENERIC_VARS)
  return `### ${e.term}\n${body}`
}

export interface Retrieval {
  /** Entry ids included in full, in order. */
  full: string[]
  /** Entry ids included as one-line definitions. */
  brief: string[]
  text: string
}

/**
 * Pick glossary text for a question asked on `route`. `history` (earlier user
 * turns) adds a little weight so follow-ups keep their topic. PURE.
 */
export function retrieve(question: string, route: string, opts: { history?: string[]; budgetTokens?: number; maxQuestionMatches?: number } = {}): Retrieval {
  const budget = (opts.budgetTokens ?? DEFAULT_BUDGET_TOKENS) * CHARS_PER_TOKEN
  const scores = scoreEntries(question)
  for (const h of (opts.history ?? []).slice(-3)) for (const [id, s] of scoreEntries(h)) scores.set(id, (scores.get(id) ?? 0) + s * 0.3)
  const byQuestion = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, opts.maxQuestionMatches ?? 5)
  const byRoute = entriesForRoute(route).slice(0, 3)
  const order = [...new Set([...byQuestion, ...CORE_IDS, ...byRoute])]

  const byId = new Map(GLOSSARY.map((e) => [e.id, e]))
  const parts: string[] = []
  const full: string[] = []
  const brief: string[] = []
  let used = 0
  for (const id of order) {
    const t = entryText(byId.get(id)!)
    if (used + t.length > budget) continue
    parts.push(t)
    full.push(id)
    used += t.length + 2
  }
  const lines: string[] = []
  for (const e of GLOSSARY) {
    if (full.includes(e.id)) continue
    const line = `- **${e.term}**: ${fillGlossary(e.short, GENERIC_VARS)}`
    if (used + line.length > budget) continue
    lines.push(line)
    brief.push(e.id)
    used += line.length + 1
  }
  if (lines.length) parts.push(`### Other terms\n${lines.join('\n')}`)
  return { full, brief, text: parts.join('\n\n') }
}

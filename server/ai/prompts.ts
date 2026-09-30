import { ASSET_CLASS_LABEL, UNIVERSE, type AssetId } from '../../shared/universe.js'
import type { ReportKind } from '../../shared/ai.js'
import type { ChatMessage } from './openrouter.js'
import { assetLine, type ContextBlock } from './context.js'

// Prompts for each report kind. The system prompt carries the sourcing rules;
// the user prompt carries the live context blocks and the exact JSON shape.

export function systemPrompt(online: boolean): string {
  return [
    'You are the senior real-assets analyst of a fund that invests in real assets (precious and industrial metals, digital assets) through ETFs, listed futures, allocated bullion and custody holdings.',
    'Each task names one asset and its asset class. Reason with the drivers of THAT class (e.g. real yields and the dollar for precious metals, industrial activity for industrial metals, liquidity and risk appetite for digital assets); do not transfer one asset\'s narrative to another.',
    'Voice: sober, quantitative, precise. Say what is known, what is modeled and what is uncertain. No hype, no promises, no investment advice disclaimers beyond one short caveat where genuinely needed.',
    'SOURCING RULES (mandatory):',
    '1. Every factual claim about the world (a number, a date, a policy decision, a report, a flow) must cite a URL in its "sources" array.',
    online
      ? '2. Cite ONLY URLs of pages your web search actually returned in this conversation, or the data-source URLs listed in the LIVE CONTEXT. Never construct, guess or shorten a URL.'
      : '2. You have NO web access. Cite ONLY the data-source URLs listed in the LIVE CONTEXT. Do not cite any other URL — leave "sources" empty instead.',
    '3. If you cannot cite a claim, you may still state it, but leave its "sources" empty; the app will flag it as unsourced. Prefer omitting unverifiable specifics.',
    '4. Never fabricate prices, figures, quotes, dates or links. Numbers from the LIVE CONTEXT must be quoted exactly with their dates.',
    '5. When a context block says "not available", say so where relevant; do not invent the missing data.',
    'BREVITY: summaries/answers at most 120 words; each driver detail or claim text at most 45 words; at most 2 sources per item; a source needs only "url" and "publisher" (add "title"/"date" only if short).',
    'Reply with ONLY one JSON object, no prose before or after, no code fence.',
  ].join('\n')
}

const SOURCE_SHAPE = '[{"url":"https://…","publisher":"…"}]'
const CLAIM_SHAPE = `{"text":"…","sources":${SOURCE_SHAPE}}`

function shapeFor(kind: ReportKind, asset: AssetId): string {
  const m = UNIVERSE[asset].label.toLowerCase()
  const cls = ASSET_CLASS_LABEL[UNIVERSE[asset].assetClass].toLowerCase()
  switch (kind) {
    case 'macro_brief':
      return `Write a MACRO BRIEF for ${m}. JSON shape:
{"summary":"3-4 sentences: the macro picture for ${m} right now, quoting the key numbers with dates","outlook":"bullish|bearish|neutral","drivers":[{"title":"short driver name","detail":"1-2 sentences: the concrete fact and why it matters for ${m}","sentiment":"bullish|bearish|neutral","sources":${SOURCE_SHAPE}}],"risks":[${CLAIM_SHAPE}],"whatWouldChangeMyMind":[${CLAIM_SHAPE}]}
4-5 drivers covering the ${cls} drivers in the macro scorecard, flows/demand, positioning and anything else material now. Exactly two or three risks and two or three "what would change my mind" items.`
    case 'trade_brief':
      return `Write a TRADE BRIEF for the FOCUS OPPORTUNITY in the quant snapshot (${m}). Be defensible both ways: a trade must justify itself and name the single best counter-argument. Respect the out-of-sample status (failed/untested ⇒ say so plainly and lower conviction). JSON shape:
{"thesis":"one defensible paragraph","structure":"what the position is and why it captures the edge","legs":[{"instrument":"e.g. GCZ26","side":"long|short","ratio":"e.g. 1","role":"…"}],"entryPlan":"entry zone, sizing logic, target and stop in plain terms","catalysts":[${CLAIM_SHAPE}],"risks":[${CLAIM_SHAPE}],"invalidation":"the specific observable that proves the thesis wrong"}`
    case 'portfolio_commentary':
      return `Write INVESTOR COMMENTARY for the fund's factsheet (audience: investors/LPs; calm private-bank tone; no jargon without a plain explanation). Use ONLY the portfolio figures in the context; if the portfolio summary is not available, write macro-only commentary and state that performance figures are not yet available. JSON shape:
{"headline":"one line, no hype","paragraph":"one paragraph of 90-140 words on performance and the macro backdrop for the fund's assets","bullets":[${CLAIM_SHAPE}]}
3-5 bullets.`
    case 'ask':
      return `Answer the operator's QUESTION below using the live context and (if available) web search. JSON shape:
{"answer":"a direct answer in 1-3 short paragraphs","points":[${CLAIM_SHAPE}]}`
  }
}

export function buildMessages(opts: { kind: ReportKind; metal: AssetId; online: boolean; blocks: ContextBlock[]; question?: string; today: string }): ChatMessage[] {
  const ctx = opts.blocks.map((b) => b.text).join('\n\n')
  const allowed = [...new Set(opts.blocks.flatMap((b) => b.urls))]
  const user = [
    `Today is ${opts.today}.`,
    opts.kind === 'portfolio_commentary' ? '' : `Asset in focus: ${assetLine(opts.metal)}.`,
    '=== LIVE CONTEXT (from the fund\'s own data; quote numbers with their dates) ===',
    ctx,
    allowed.length ? `Data-source URLs you may cite: ${allowed.join(' ')}` : 'There are no data-source URLs to cite from the context.',
    '=== TASK ===',
    shapeFor(opts.kind, opts.metal),
    opts.kind === 'ask' ? `QUESTION: ${opts.question ?? ''}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return [
    { role: 'system', content: systemPrompt(opts.online) },
    { role: 'user', content: user },
  ]
}

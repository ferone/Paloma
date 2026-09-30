import type { Metal } from '../../shared/universe.js'
import { UNIVERSE } from '../../shared/universe.js'
import {
  ARTIFACTS,
  type MlPredictionsLite,
  type PortfolioSummaryLite,
  type QuantOpportunityLite,
  type QuantSnapshotLite,
} from '../../shared/artifacts.js'
import type { CotMarket } from '../../shared/macro.js'
import type { ReportKind } from '../../shared/ai.js'
import { readArtifact } from '../db/repo.js'
import { buildDashboard, cotResponse } from '../macro/service.js'
import { CFTC_SOCRATA_URL } from '../macro/cot.js'

// Live context injected into prompts. Each block states its data date, and an
// absent block is stated explicitly so the model never fills the gap itself.

export interface ContextBlock {
  name: string
  present: boolean
  asOf: string | null
  text: string
  /** Data-source URLs the app vouches for (allowed as citations). */
  urls: string[]
}

const f = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(d))
const sgn = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`)
const pctS = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)

export function macroBlock(metal: Metal): ContextBlock {
  const d = buildDashboard(metal)
  if (d.empty) return { name: 'Macro dashboard', present: false, asOf: null, text: 'MACRO DASHBOARD: not available (no macro data has been fetched yet).', urls: [] }
  const lines = [`MACRO DASHBOARD for ${UNIVERSE[metal].label} (data through ${d.asOf}). Regime: ${d.regime.label}. Net scorecard ${d.netScore >= 0 ? '+' : ''}${d.netScore} (${d.tailwinds} tailwinds, ${d.headwinds} headwinds).`]
  lines.push('Scorecard (driver: value | 1m Δ | 3m Δ | z | stance — rule reason [as of]):')
  for (const r of d.scorecard) {
    const ch = (v: number | null) => (r.changeKind === 'pct' ? pctS(v) : sgn(v))
    lines.push(`- ${r.label}: ${f(r.value)} | ${ch(r.change1m)} | ${ch(r.change3m)} | z ${f(r.z, 1)} | ${r.stance} — ${r.reason} [${r.asOf ?? 'n/a'}]`)
  }
  lines.push('Other series (latest [date]):')
  const urls: string[] = []
  for (const s of d.series) {
    if (s.latest == null) continue
    if (s.url) urls.push(s.url)
    lines.push(`- ${s.label} (${s.id}): ${f(s.latest)} [${s.latestDate}]${s.url ? ` source ${s.url}` : ''}`)
  }
  return { name: 'Macro dashboard', present: true, asOf: d.asOf, text: lines.join('\n'), urls: [...new Set(urls)] }
}

export function cotBlock(metal: Metal): ContextBlock {
  const market = UNIVERSE[metal].cotMarket as CotMarket
  const c = cotResponse(market)
  if (!c.latest) return { name: 'COT positioning', present: false, asOf: null, text: `CFTC COT (${market}): not available (not fetched yet).`, urls: [] }
  const l = c.latest
  const lines = [
    `CFTC DISAGGREGATED COT — ${c.marketName}, positions as of ${l.reportDate} (published ${l.publishedAt?.slice(0, 10) ?? 'n/a'}). Open interest ${f(l.openInterest, 0)} (${sgn(l.changeOpenInterest, 0)} w/w).`,
    `Managed-money net ${pctS(l.mmNetPctOi)} of OI, ${l.mmPercentile3y != null ? Math.round(l.mmPercentile3y * 100) : 'n/a'}th percentile of 3 years, z ${f(l.mmZ3y, 2)}.`,
    ...l.categories.map((k) => `- ${k.name}: long ${f(k.long, 0)}, short ${f(k.short, 0)}, net ${f(k.net, 0)} (Δw ${sgn(k.changeNet, 0)})`),
    `Source: ${CFTC_SOCRATA_URL}`,
  ]
  return { name: 'COT positioning', present: true, asOf: l.reportDate, text: lines.join('\n'), urls: ['https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm'] }
}

export function quantBlock(metal: Metal, focus?: QuantOpportunityLite): ContextBlock {
  const a = readArtifact<QuantSnapshotLite>(ARTIFACTS.quantSnapshot)
  if (!a) return { name: 'Quant snapshot', present: false, asOf: null, text: 'QUANT SNAPSHOT: not available (the quant engine has not published a snapshot).', urls: [] }
  const opps = a.data.opportunities.filter((o) => o.metal === metal).slice(0, 12)
  const line = (o: QuantOpportunityLite) =>
    `- ${o.id} "${o.label}": ${o.side} · tier ${o.tier} · verdict ${o.verdict} · rank ${f(o.qtRank, 0)} · z ${f(o.z)} · out-of-sample ${o.oosStatus}`
  const lines = [`QUANT SNAPSHOT (engine data through ${a.data.dataThrough ?? 'n/a'}, run ${a.data.asOf}). Top ${UNIVERSE[metal].label.toLowerCase()} opportunities:`]
  lines.push(...(opps.length ? opps.map(line) : ['- none for this metal']))
  if (focus) lines.push(`FOCUS OPPORTUNITY: ${line(focus).slice(2)}`)
  return { name: 'Quant snapshot', present: true, asOf: a.data.dataThrough ?? a.data.asOf, text: lines.join('\n'), urls: [] }
}

export function mlBlock(metal: Metal): ContextBlock {
  const a = readArtifact<MlPredictionsLite>(ARTIFACTS.mlPredictions)
  if (!a) return { name: 'ML predictions', present: false, asOf: null, text: 'ML PREDICTIONS: not available.', urls: [] }
  const preds = a.data.predictions.filter((p) => p.metal === metal).slice(0, 10)
  const lines = [`ML PREDICTIONS (as of ${a.data.asOf}):`]
  for (const p of preds)
    lines.push(`- ${p.instrumentId} ${p.horizonDays}d: ${p.pUp != null ? `P(up) ${f(p.pUp)}` : ''}${p.pConverge != null ? `P(converge) ${f(p.pConverge)}` : ''} · validation ${p.validationStatus}`)
  if (!preds.length) lines.push('- none for this metal')
  return { name: 'ML predictions', present: true, asOf: a.data.asOf, text: lines.join('\n'), urls: [] }
}

export function portfolioBlock(): ContextBlock {
  const a = readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)
  if (!a) return { name: 'Portfolio summary', present: false, asOf: null, text: 'PORTFOLIO SUMMARY: not available (no NAV has been computed yet).', urls: [] }
  const p = a.data
  const lines = [
    `PORTFOLIO SUMMARY as of ${p.asOf}: NAV $${f(p.nav, 0)}${p.navPerUnit != null ? `, NAV/unit ${f(p.navPerUnit, 4)}` : ''}.`,
    `Returns: day ${pctS(p.dayReturn, 2)}, MTD ${pctS(p.mtdReturn, 2)}, YTD ${pctS(p.ytdReturn, 2)}, since inception ${pctS(p.sinceInceptionReturn, 2)}.`,
    `Allocation by sleeve: ${p.allocation.map((x) => `${x.sleeve} ${(x.weight * 100).toFixed(1)}%`).join(', ') || 'n/a'}.`,
    `By metal: ${p.byMetal.map((x) => `${x.metal} ${(x.weight * 100).toFixed(1)}%`).join(', ') || 'n/a'}.`,
  ]
  return { name: 'Portfolio summary', present: true, asOf: p.asOf, text: lines.join('\n'), urls: [] }
}

export function contextFor(kind: ReportKind, metal: Metal, focus?: QuantOpportunityLite): ContextBlock[] {
  switch (kind) {
    case 'macro_brief':
      return [macroBlock(metal), cotBlock(metal)]
    case 'trade_brief':
      return [quantBlock(metal, focus), mlBlock(metal), macroBlock(metal), cotBlock(metal)]
    case 'portfolio_commentary':
      return [portfolioBlock(), { ...macroBlock('gold'), name: 'Macro dashboard (gold)' }, { ...macroBlock('silver'), name: 'Macro dashboard (silver)' }]
    case 'ask':
      return [macroBlock(metal), cotBlock(metal), quantBlock(metal), portfolioBlock()]
  }
}

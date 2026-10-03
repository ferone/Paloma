import { ASSETS, ASSET_CLASS_LABEL, UNIVERSE, type AssetId } from '../../shared/universe.js'
import {
  ARTIFACTS,
  type MlPredictionsLite,
  type PortfolioSummaryLite,
  type QuantOpportunityLite,
  type QuantSnapshotLite,
} from '../../shared/artifacts.js'
import type { ReportKind } from '../../shared/ai.js'
import { readArtifact } from '../db/repo.js'
import { readInstrumentDetail } from '../quant/store.js'
import { buildDashboard, cotResponse } from '../macro/service.js'
import { COT_FAMILIES } from '../macro/cot.js'

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

/** One line naming the asset and its class, e.g. "Gold (precious metals, COMEX futures GC)". */
export function assetLine(asset: AssetId): string {
  const s = UNIVERSE[asset]
  const fut = s.futures[0]
  return `${s.label} (${ASSET_CLASS_LABEL[s.assetClass].toLowerCase()}${fut ? `, ${fut.exchange} futures ${fut.root}` : ''}, priced in ${s.unitLabel})`
}

export function macroBlock(asset: AssetId): ContextBlock {
  const d = buildDashboard(asset)
  if (d.empty) return { name: 'Macro dashboard', present: false, asOf: null, text: 'MACRO DASHBOARD: not available (no macro data has been fetched yet).', urls: [] }
  const lines = [`MACRO DASHBOARD for ${assetLine(asset)} (data through ${d.asOf}). Drivers are the ${ASSET_CLASS_LABEL[UNIVERSE[asset].assetClass].toLowerCase()} driver set. Regime: ${d.regime.label}. Net scorecard ${d.netScore >= 0 ? '+' : ''}${d.netScore} (${d.tailwinds} tailwinds, ${d.headwinds} headwinds).`]
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

export function cotBlock(asset: AssetId): ContextBlock {
  const spec = UNIVERSE[asset]
  if (!spec.cot) return { name: 'COT positioning', present: false, asOf: null, text: `CFTC COT: not available (${spec.label} has no CFTC market).`, urls: [] }
  const market = spec.cot.market
  const c = cotResponse(market)
  if (!c?.latest) return { name: 'COT positioning', present: false, asOf: null, text: `CFTC COT (${market}): not available (not fetched yet).`, urls: [] }
  const l = c.latest
  const fam = COT_FAMILIES[c.report]
  const lines = [
    `${fam.label.toUpperCase()} — ${c.marketName}, positions as of ${l.reportDate} (published ${l.publishedAt?.slice(0, 10) ?? 'n/a'}). Open interest ${f(l.openInterest, 0)} (${sgn(l.changeOpenInterest, 0)} w/w).`,
    `${c.speculator.label} (speculators) net ${pctS(l.specNetPctOi)} of OI, ${l.specPercentile3y != null ? Math.round(l.specPercentile3y * 100) : 'n/a'}th percentile of 3 years, z ${f(l.specZ3y, 2)}.`,
    ...l.categories.map((k) => `- ${k.name}: long ${f(k.long, 0)}, short ${f(k.short, 0)}, net ${f(k.net, 0)} (Δw ${sgn(k.changeNet, 0)})`),
    `Source: ${fam.url}`,
  ]
  return { name: 'COT positioning', present: true, asOf: l.reportDate, text: lines.join('\n'), urls: ['https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm'] }
}

export function quantBlock(metal: AssetId, focus?: QuantOpportunityLite): ContextBlock {
  const a = readArtifact<QuantSnapshotLite>(ARTIFACTS.quantSnapshot)
  if (!a) return { name: 'Quant snapshot', present: false, asOf: null, text: 'QUANT SNAPSHOT: not available (the quant engine has not published a snapshot).', urls: [] }
  // Actionable first (what the Quant Lab would trade today), then by QT rank.
  const opps = rankForBrief(a.data.opportunities.filter((o) => o.asset === metal)).slice(0, 12)
  const line = (o: QuantOpportunityLite) =>
    `- ${o.id} "${o.label}": ${isActionable(o) ? `ACTIONABLE ${o.verdict} ${o.side}` : `not actionable (verdict ${o.verdict})`} · tier ${o.tier} · rank ${f(o.qtRank, 0)} · z ${f(o.z)} · out-of-sample ${o.oosStatus}`
  const lines = [
    `QUANT SNAPSHOT (engine data through ${a.data.dataThrough ?? 'n/a'}, run ${a.data.asOf}). ${UNIVERSE[metal].label} opportunities, actionable first (ACTIONABLE = the conservative verdict would trade it today; rank alone is not a trade signal):`,
  ]
  lines.push(...(opps.length ? opps.map(line) : ['- none for this asset']))
  for (const b of a.data.basis?.filter((x) => x.asset === metal) ?? [])
    lines.push(
      `CASH-AND-CARRY BASIS ${b.id} (${b.asOf}, ${b.contract}, ${b.daysToExpiry} d to expiry): basis ${f(b.basis)}% p.a., T-bill ${f(b.tbill)}%, excess carry ${f(b.excess)}% · z ${f(b.z)} · half-life ${f(b.halfLife, 1)} d · out-of-sample ${b.oosStatus} · verdict ${b.verdict}. A carry harvest (long spot / short future), not a directional bet.`,
    )
  if (focus) {
    lines.push(`FOCUS OPPORTUNITY: ${line(focus).slice(2)}`)
    lines.push(...focusDetail(focus.id))
  }
  return { name: 'Quant snapshot', present: true, asOf: a.data.dataThrough ?? a.data.asOf, text: lines.join('\n'), urls: [] }
}

export const isActionable = (o: QuantOpportunityLite) => o.verdict === 'BUY' || o.verdict === 'SELL'

/** Order for briefing: actionable first, then out-of-sample passed, then QT rank. */
export function rankForBrief<T extends QuantOpportunityLite>(opps: T[]): T[] {
  const score = (o: T) => (isActionable(o) ? 2 : 0) + (o.oosStatus === 'passed' ? 1 : 0)
  return [...opps].sort((a, b) => score(b) - score(a) || b.qtRank - a.qtRank)
}

/** The full engine read of the focus instrument: levels, window, verdicts, legs, plan. */
function focusDetail(id: string): string[] {
  const d = readInstrumentDetail(id)
  if (!d) return ['FOCUS DETAIL: not available (instrument detail missing from the latest engine run).']
  const last = d.series.at(-1)
  const v = d.verdicts
  const o = d.oos
  const p = d.plan
  return [
    `FOCUS DETAIL ${d.id} — ${d.label} (${d.kind}); unit ${d.unit}; $${f(d.pointValue, 0)} per 1.00 point; data through ${d.dataThrough ?? 'n/a'}.`,
    last ? `Current value ${f(last.value, 3)} ${d.unit}; ${d.bandWindow}-day mean ${f(last.mean, 3)}, z ${f(last.z)}.` : 'Current value: n/a.',
    d.window
      ? `Seasonal window: ${d.window.side} from ${d.window.entryLabel} to ${d.window.exitLabel}; in-sample won ${f(d.window.winRate * 100, 0)}% of ${d.window.years} seasons, t ${f(d.window.tStat)}; today inside the window: ${d.window.active ? 'yes' : 'no'}.`
      : '',
    `Verdict conservative: ${v.conservative.action}${v.conservative.direction ? ` (${v.conservative.direction})` : ''} — ${v.conservative.instruction}${v.conservative.blockers.length ? `; blockers: ${v.conservative.blockers.join('; ')}` : ''}.`,
    `Verdict aggressive: ${v.aggressive.action} — ${v.aggressive.instruction}.`,
    `Out-of-sample (${o.method}): ${o.status} — ${o.reason}; ${o.trades} trades, win rate ${f(o.winRate * 100, 0)}%, avg ${f(o.avgPnl, 0)} (${o.pnlUnit}), t ${f(o.tStat)}, Sharpe ${f(o.sharpe)}${o.regime ? `; regime ${o.regime.survives ? 'robust' : 'FRAGILE'}` : ''}.`,
    p.legs.length ? `Legs per structure: ${p.legs.map((l) => `${l.side} ${l.qty} × ${l.contract ?? l.leg}`).join(', ')}.` : '',
    `Engine trade plan: entry ${f(p.entry, 3)}, target ${f(p.target, 3)}, stop ${f(p.stop, 3)} (${p.unit}); expected $${f(p.expectedUsd, 0)} and risk $${f(p.riskUsd, 0)} per structure; liquidity ${p.capacity.tier} (suggested max ~${p.capacity.suggestedMaxContracts} structures)${p.kelly ? `; half-Kelly ${f(p.kelly.halfKelly * 100, 1)}% of capital` : ''}.`,
  ].filter(Boolean)
}

export function mlBlock(metal: AssetId): ContextBlock {
  const a = readArtifact<MlPredictionsLite>(ARTIFACTS.mlPredictions)
  if (!a) return { name: 'ML predictions', present: false, asOf: null, text: 'ML PREDICTIONS: not available.', urls: [] }
  const preds = a.data.predictions.filter((p) => p.asset === metal).slice(0, 10)
  const lines = [`ML PREDICTIONS (as of ${a.data.asOf}):`]
  for (const p of preds)
    lines.push(`- ${p.instrumentId} ${p.horizonDays}d: ${p.pUp != null ? `P(up) ${f(p.pUp)}` : ''}${p.pConverge != null ? `P(converge) ${f(p.pConverge)}` : ''} · validation ${p.validationStatus}`)
  if (!preds.length) lines.push('- none for this asset')
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
    `By asset: ${p.byAsset.map((x) => `${x.asset} ${(x.weight * 100).toFixed(1)}%`).join(', ') || 'n/a'}.`,
  ]
  return { name: 'Portfolio summary', present: true, asOf: p.asOf, text: lines.join('\n'), urls: [] }
}

export function contextFor(kind: ReportKind, metal: AssetId, focus?: QuantOpportunityLite): ContextBlock[] {
  switch (kind) {
    case 'macro_brief':
      return [macroBlock(metal), cotBlock(metal)]
    case 'trade_brief':
      return [quantBlock(metal, focus), mlBlock(metal), macroBlock(metal), cotBlock(metal)]
    case 'portfolio_commentary':
      return [portfolioBlock(), ...ASSETS.map((a) => ({ ...macroBlock(a), name: `Macro dashboard (${UNIVERSE[a].label.toLowerCase()})` }))]
    case 'ask':
      return [macroBlock(metal), cotBlock(metal), quantBlock(metal), portfolioBlock()]
  }
}

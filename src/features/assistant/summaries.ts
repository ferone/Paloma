import type { InstrumentDetail, OpportunitiesResponse, OosView, OuView, QuantMode, RelativeValueDetail, VerdictView } from '@shared/quant'
import type { CurveResponse, EtfsResponse } from '@shared/markets'
import type { MlPrediction, MlRunDetail } from '@shared/ml'
import type { HoldingsResponse, PerformanceResponse, PortfolioSummary, RiskResponse } from '@shared/portfolio'
import type { MacroDashboard } from '@shared/macro'
import { UNIVERSE, type AssetId } from '@shared/universe'
import { fmtNum, fmtPct, fmtSigned, fmtUsd } from '../../design/format'
import type { PageContextValue } from './context'

// Compact text descriptions of what a page shows, sent to the assistant as
// page context. PURE: built only from the data the page already rendered.
// Kept well under the 4 KB the server accepts.

export const SUMMARY_MAX_CHARS = 3800

export function clip(s: string, max = SUMMARY_MAX_CHARS): string {
  return s.length <= max ? s : `${s.slice(0, max - 12)}…[truncated]`
}

const lines = (...xs: (string | null | false | undefined)[]) => clip(xs.filter((x): x is string => !!x).join('\n'))
const yn = (b: boolean | null | undefined) => (b == null ? 'n/a' : b ? 'yes' : 'no')

function ouLine(ou: OuView | null): string {
  if (!ou) return 'OU: not fitted'
  return `OU: tradable ${yn(ou.tradable)} — ${ou.reason}; half-life ${ou.halfLife == null ? 'n/a' : `${fmtNum(ou.halfLife, 1)} trading days`}; b ${fmtNum(ou.b, 3)}; R² ${fmtNum(ou.r2, 2)}; effective z ${fmtSigned(ou.zEff, 2)} (lookback ${ou.nEff ?? 'n/a'})${ou.expectedDays != null ? `; expected reversion ~${fmtNum(ou.expectedDays, 0)} d` : ''}`
}

function oosLine(o: OosView): string {
  const regime = o.regime ? ` · regime ${o.regime.survives ? 'robust' : 'FRAGILE'} (${o.regime.note})` : ''
  return `Out-of-sample (${o.method}): ${o.status.toUpperCase()} — ${o.reason}; trades ${o.trades}, win rate ${fmtPct(o.winRate, 0)}, avg ${fmtNum(o.avgPnl, 0)} (${o.pnlUnit}), t ${fmtNum(o.tStat, 2)}, Sharpe ${fmtNum(o.sharpe, 2)}${regime}`
}

function verdictLines(v: VerdictView): string[] {
  return [
    `Verdict (${v.mode}): ${v.action}${v.direction ? ` (${v.direction})` : ''} · confidence ${v.confidence} — ${v.instruction}`,
    v.reasons.length ? `Reasons: ${v.reasons.join('; ')}` : '',
    v.blockers.length ? `Blockers: ${v.blockers.join('; ')}` : 'Blockers: none',
  ].filter(Boolean)
}

/** Quant Lab instrument page (/quant/i/:id). */
export function instrumentSummary(d: InstrumentDetail, mode: QuantMode): PageContextValue {
  const last = d.series.at(-1)
  const s = d.score
  const other: QuantMode = mode === 'conservative' ? 'aggressive' : 'conservative'
  return {
    label: `${d.label} (${d.id})`,
    summary: lines(
      `Instrument ${d.id} — ${d.label}; kind ${d.kind}; asset ${UNIVERSE[d.metal]?.label ?? d.metal}; unit ${d.unit}; $${fmtNum(d.pointValue, 2)} per 1.00 point; as of ${d.asOf}, data through ${d.dataThrough ?? 'n/a'}.`,
      last ? `Latest value ${fmtNum(last.value, 4)} ${d.unit}; ${d.bandWindow}-day mean ${fmtNum(last.mean, 4)}, σ ${fmtNum(last.sd, 4)}, z ${fmtSigned(last.z, 2)}.` : 'No series values.',
      s ? `Score ${fmtNum(s.score, 0)} (tier ${s.tier}${s.avoidOverride ? ', AVOID override' : ''}); z ${fmtSigned(s.z, 2)}; base ${fmtNum(s.base, 1)}; season factor ${fmtSigned(s.seasonFactor, 2)}; fund factor ${fmtSigned(s.fundFactor, 2)}; vol factor ${fmtNum(s.volFactor, 2)}.` : 'Score: n/a (seasonal pair or not enough history).',
      `QT rank ${fmtNum(d.qtRank, 1)}.`,
      ouLine(d.ou),
      d.carry ? `Carry: regime ${d.carry.regime}; slope (c1−c0) ${fmtSigned(d.carry.slope, 3)}; slope percentile ${fmtPct(d.carry.slopePctile, 0)}; slope momentum z ${fmtSigned(d.carry.slopeMomZ, 2)}; trending ${yn(d.carry.trending)}; alignment ${d.carry.alignment ?? 'n/a'}${d.carry.detail ? ` — ${d.carry.detail}` : ''}.` : 'Carry read: not applicable.',
      `Gates: OU tradable ${yn(d.gates.ouTradable)}; carry conflict ${yn(d.gates.carryConflict)}; structural move ${d.gates.structural == null ? 'n/a' : d.gates.structural ? 'YES (regime-off)' : 'no (pass)'}${d.gates.structuralDetail ? ` — ${d.gates.structuralDetail}` : ''}.`,
      ...verdictLines(d.verdicts[mode]),
      `Other mode (${other}): ${d.verdicts[other].action}${d.verdicts[other].blockers.length ? ` — blockers: ${d.verdicts[other].blockers.join('; ')}` : ''}`,
      oosLine(d.oos),
      d.plan.legs.length ? `Legs (per 1 structure): ${d.plan.legs.map((l) => `${l.side} ${l.qty} ${l.contract ?? l.leg}`).join(', ')}.` : '',
      `Trade plan: entry ${fmtNum(d.plan.entry, 3)}, target ${fmtNum(d.plan.target, 3)}, stop ${fmtNum(d.plan.stop, 3)} (${d.plan.unit}); expected ${fmtUsd(d.plan.expectedUsd, 0)} per structure; risk ${fmtUsd(d.plan.riskUsd, 0)}; capacity ${d.plan.capacity.tier} (max ~${d.plan.capacity.suggestedMaxContracts} contracts).${d.plan.kelly ? ` Half-Kelly ${fmtPct(d.plan.kelly.halfKelly, 1)}.` : ''}`,
      d.ml ? `ML: ${d.ml.pConverge != null ? `p(converge) ${fmtPct(d.ml.pConverge, 0)}` : `p(up) ${fmtPct(d.ml.pUp, 0)}`} over ${d.ml.horizonDays} d; validation ${d.ml.validationStatus}; counted ${yn(d.ml.counted)}.` : 'ML: none.',
      d.window ? `Seasonal window: ${d.window.side} ${d.window.entryLabel}→${d.window.exitLabel}, won ${fmtPct(d.window.winRate, 0)} of ${d.window.years} seasons, t ${fmtNum(d.window.tStat, 2)}, active ${yn(d.window.active)}.` : '',
      d.basis ? `Basis: ${d.basis.latest.contract}, ${d.basis.latest.daysToExpiry} d to expiry, basis ${fmtNum(d.basis.latest.basis, 2)}% p.a., T-bill ${fmtNum(d.basis.latest.tbill, 2)}%, excess ${fmtNum(d.basis.latest.excess, 2)}%; $/bp ${fmtNum(d.basis.dollarsPerBp, 2)}; excess carry to expiry ${fmtUsd(d.basis.excessCarryUsd, 0)} per contract.` : '',
      d.decision ? `Decision lenses: conviction ${d.decision.convictionLabel}${d.decision.trap ? ' (TRAP flagged)' : ''} — ${d.decision.headline}` : '',
      d.evidence.length ? `Evidence: ${d.evidence.slice(0, 6).join('; ')}` : '',
      d.caveats.length ? `Caveats: ${d.caveats.slice(0, 4).join('; ')}` : '',
    ),
  }
}

/** Quant Lab scanner: top 10 rows by QT rank. */
export function scannerSummary(data: OpportunitiesResponse): PageContextValue {
  const top = [...data.rows].sort((a, b) => b.qtRank - a.qtRank).slice(0, 10)
  const acts = data.rows.filter((o) => o.verdict.action !== 'AVOID')
  return {
    label: `Scanner · ${UNIVERSE[data.metal].label} · ${data.mode}`,
    summary: lines(
      `Quant scanner for ${UNIVERSE[data.metal].label}, ${data.mode} mode, data through ${data.dataThrough ?? 'n/a'}. ${data.rows.length} instruments; ${acts.filter((o) => o.verdict.action === 'BUY').length} BUY, ${acts.filter((o) => o.verdict.action === 'SELL').length} SELL; ${data.rows.filter((o) => o.oos === 'passed').length} passed OOS.`,
      'Top 10 by QT rank (id | label | tier | verdict | QT rank | z | half-life | OOS | gates):',
      ...top.map(
        (o) =>
          `- ${o.id} | ${o.label} | ${o.tier} | ${o.verdict.action} | ${fmtNum(o.qtRank, 1)} | z ${fmtSigned(o.z, 2)} | HL ${o.halfLife == null ? 'n/a' : `${fmtNum(o.halfLife, 1)}d`} | OOS ${o.oos}${o.survivesRegime === false ? ' (regime-fragile)' : ''} | OU ${o.gates.ouTradable ? 'ok' : 'FAIL'}, carry ${o.gates.carryConflict ? 'CONFLICT' : o.carry ?? 'n/a'}, structural ${o.gates.structural == null ? 'n/a' : o.gates.structural ? 'MOVE' : 'ok'}${o.verdict.blockers.length ? ` | first blocker: ${o.verdict.blockers[0]}` : ''}`,
      ),
    ),
  }
}

/** Relative-value pair page (one pair). */
export function relativeValueSummary(rv: RelativeValueDetail, pairLabel: string, mode: QuantMode): PageContextValue {
  const r = rv.ratio
  return {
    label: `${pairLabel} relative value`,
    summary: lines(
      `${pairLabel} ratio, data through ${rv.dataThrough ?? 'n/a'}: latest ${fmtNum(r.latest, 4)}; z ${fmtSigned(r.z, 2)} (${r.bandWindow}-day band); long-window z ${fmtSigned(r.zLong, 2)}; percentile ${fmtPct(r.percentile, 0)}.`,
      ouLine(r.ou),
      ...verdictLines(r.verdicts[mode]),
      oosLine(r.oos),
      `Dollar-neutral hedge: ${r.hedge.goldContracts} numerator contract vs ${fmtNum(r.hedge.silverContracts, 2)} denominator contracts — ${r.hedge.note}`,
      `Dollar spread: latest ${fmtNum(rv.spread.latest, 0)}, z ${fmtSigned(rv.spread.z, 2)}, vol-parity ratio ${fmtNum(rv.spread.volParityRatio, 2)}; verdict (${mode}) ${rv.spread.verdicts[mode].action}.`,
    ),
  }
}

/** Markets → futures curve. */
export function curveSummary(c: CurveResponse): PageContextValue {
  const label = UNIVERSE[c.metal].label
  return {
    label: `${label} futures curve`,
    summary: lines(
      `${label} futures curve (${c.root ?? 'no futures'} on ${c.exchange ?? 'n/a'}, ${c.unitLabel}): shape ${c.shape}; 12M term carry ${fmtPct(c.termCarry, 2)}; T-bill ${fmtPct(c.rate.value, 2)}; carry − rate ${fmtPct(c.carryMinusRate, 2)}; reference ${c.referenceSymbol ?? 'n/a'}.`,
      'Contracts (symbol | expiry | price | spread vs reference | annualized carry | OI):',
      ...c.contracts.slice(0, 14).map((k) => `- ${k.symbol.split('.')[0]} (${k.label}) | ${k.expiry ?? 'n/a'} | ${fmtNum(k.price, UNIVERSE[c.metal].displayDecimals)} | ${fmtSigned(k.spread, 2)} | ${fmtPct(k.carry, 2)} | ${k.openInterest ?? 'n/a'}${k.stale ? ' | STALE' : ''}${k.isReference ? ' | reference' : ''}`),
    ),
  }
}

/** Markets → ETFs. */
export function etfSummary(d: EtfsResponse): PageContextValue {
  const label = UNIVERSE[d.metal].label
  return {
    label: `${label} ETFs`,
    summary: lines(
      `${label} ETFs vs ${d.spotSymbol} (1Y spot ${fmtPct(d.spotReturns.y1, 1)}):`,
      ...d.rows.map(
        (r) =>
          `- ${r.symbol} (${r.kind}) ${r.name}: price ${fmtNum(r.price, 2)}, premium ${fmtPct(r.premium, 2)} (${r.premiumMethod}), expense ${fmtPct(r.expenseRatio, 2)}, AUM ${fmtUsd(r.aum, 0)}, 1Y ${fmtPct(r.returns.y1, 1)}, tracking diff ${fmtPct(r.trackingDiff1y, 2)}, tracking error ${fmtPct(r.trackingError1y, 2)}`,
      ),
    ),
  }
}

/** Intelligence → signal cards (every asset; the asset in focus first). */
export function mlSignalSummary(preds: MlPrediction[] | undefined, asset: AssetId): PageContextValue {
  const ordered = [...(preds ?? [])].sort((a, b) => (a.metal === asset ? -1 : b.metal === asset ? 1 : 0))
  return {
    label: 'ML signal',
    summary: lines(
      ordered.length ? 'ML 20-day direction predictions:' : 'No ML predictions yet.',
      ...ordered.map(
        (p) =>
          `- ${UNIVERSE[p.metal]?.label ?? p.metal} (${p.instrumentId}, ${p.date}): p(up) ${fmtPct(p.pUp, 0)} [historical hit band ${fmtPct(p.pUpLow, 0)}–${fmtPct(p.pUpHigh, 0)}], expected move ${fmtPct(p.expectedMove, 1)} (${fmtPct(p.lower, 1)} to ${fmtPct(p.upper, 1)}); validation ${p.validationStatus}${p.reasons.length ? ` — ${p.reasons.join('; ')}` : ''}`,
      ),
    ),
  }
}

/** Intelligence → validation of one run. */
export function mlValidationSummary(run: MlRunDetail): PageContextValue {
  const m = run.metrics
  return {
    label: `ML validation · ${UNIVERSE[run.metal]?.label ?? run.metal} run ${run.id}`,
    summary: m
      ? lines(
          `ML run ${run.id} for ${UNIVERSE[run.metal]?.label ?? run.metal}: gate ${m.gate.status}${m.gate.reasons.length ? ` — ${m.gate.reasons.join('; ')}` : ''}.`,
          `Checks: ${m.gate.checks.map((c) => `${c.label} ${c.value == null ? 'n/a' : fmtNum(c.value, 3)} (needs ${c.id === 'pValue' ? '<' : c.id === 'baseline' ? '>' : '≥'} ${c.threshold == null ? 'baseline' : fmtNum(c.threshold, 3)}) ${c.ok ? 'PASS' : 'FAIL'}`).join('; ')}.`,
          `Walk-forward: mean AUC ${fmtNum(m.summary.auc, 3)}, pooled AUC ${fmtNum(m.summary.pooledAuc, 3)}, baseline AUC ${fmtNum(m.summary.baselineAuc, 3)}, hit ${fmtPct(m.summary.hit, 1)}, always-up ${fmtPct(m.summary.baseRate, 1)}, Brier ${fmtNum(m.summary.brier, 3)}, test years ${m.summary.folds}; data ${m.dataFrom ?? 'n/a'} to ${m.labelThrough ?? 'n/a'}.`,
        )
      : `ML run ${run.id}: no metrics (${run.status}).`,
  }
}

/** Portfolio → holdings. */
export function holdingsSummary(s: PortfolioSummary | undefined, h: HoldingsResponse | undefined): PageContextValue {
  return {
    label: 'Portfolio holdings',
    summary: lines(
      s && !s.empty
        ? `Fund as of ${s.asOf}: NAV ${fmtUsd(s.nav, 0)}, NAV/unit ${fmtNum(s.navPerUnit, 4)}, day ${fmtPct(s.dayReturn, 2)}, MTD ${fmtPct(s.mtdReturn, 2)}, YTD ${fmtPct(s.ytdReturn, 2)}, since inception ${fmtPct(s.sinceInceptionReturn, 2)}; cash ${fmtUsd(s.cash, 0)}; gross exposure ${fmtUsd(s.grossExposure, 0)}; unrealized ${fmtUsd(s.unrealizedPnl, 0)}, realized ${fmtUsd(s.realizedPnl, 0)}.`
        : 'The fund has no transactions yet.',
      s?.allocation.length ? `Allocation by sleeve: ${s.allocation.map((a) => `${a.sleeve} ${fmtPct(a.weight, 1)}`).join(', ')}.` : '',
      s?.netExposure.length ? `Net exposure: ${s.netExposure.map((e) => `${UNIVERSE[e.asset]?.label ?? e.asset} ${fmtNum(e.exposureUnits, 2)} ${e.unitLabel}`).join(', ')}.` : '',
      h?.holdings.length ? 'Holdings (instrument | kind | qty | value | unrealized P&L):' : '',
      ...(h?.holdings ?? []).slice(0, 25).map((x) => `- ${x.instrumentId} ${x.name} | ${x.kind} | ${fmtNum(x.quantity, 4)} | ${fmtUsd(x.value, 0)} | ${fmtUsd(x.unrealizedPnl, 0)}${x.priceStale ? ' | stale price' : ''}`),
      h?.warnings.length ? `Warnings: ${h.warnings.join('; ')}` : '',
    ),
  }
}

/** Portfolio → performance and risk. */
export function performanceSummary(p: PerformanceResponse | undefined, risk: RiskResponse | undefined): PageContextValue {
  const s = p?.stats
  const v95 = risk?.var.find((v) => v.confidence === 0.95)
  return {
    label: 'Portfolio performance',
    summary: lines(
      p && s
        ? `Performance ${p.from ?? 'n/a'} to ${p.to ?? 'n/a'} vs ${p.benchmarkLabel}: TWR ${fmtPct(s.twr, 2)}, annualized ${fmtPct(s.annualizedReturn, 2)}, IRR ${fmtPct(s.irr, 2)}, vol ${fmtPct(s.volatility, 1)}, Sharpe ${fmtNum(s.sharpe, 2)}, Sortino ${fmtNum(s.sortino, 2)}, Calmar ${fmtNum(s.calmar, 2)}; risk-free ${fmtPct(p.riskFreeRate, 2)}. Benchmark TWR ${fmtPct(p.benchmarkStats?.twr, 2)}.`
        : 'Performance: not available.',
      p ? `Drawdown: max ${fmtPct(p.drawdown.maxDrawdown, 2)} (peak ${p.drawdown.peakDate ?? 'n/a'}, trough ${p.drawdown.troughDate ?? 'n/a'}, recovered ${p.drawdown.recoveryDate ?? 'no'}), current ${fmtPct(p.drawdown.current, 2)}.` : '',
      v95 ? `1-day VaR 95%: historical ${fmtPct(v95.historicalPct, 2)} (${fmtUsd(v95.historicalUsd, 0)}), parametric ${fmtPct(v95.parametricPct, 2)}; CVaR historical ${fmtPct(v95.historicalCvarPct, 2)}.` : '',
      risk ? `Gross leverage ${fmtNum(risk.grossLeverage, 2)}×; observations ${risk.observations}.` : '',
    ),
  }
}

/** Macro dashboard. */
export function macroSummary(d: MacroDashboard): PageContextValue {
  const label = UNIVERSE[d.asset].label
  return {
    label: `Macro · ${label}`,
    summary: d.empty
      ? 'Macro data has not been fetched yet.'
      : lines(
          `Macro for ${label} as of ${d.asOf ?? 'n/a'}: regime ${d.regime.label} (${d.regime.parts.map((x) => `${x.label} ${x.stance}`).join(', ')}); net score ${d.netScore} (${d.tailwinds} tailwinds, ${d.headwinds} headwinds).`,
          ...d.scorecard.map((r) => `- ${r.label}: ${fmtNum(r.value, 2)} | 1m ${fmtSigned(r.change1m, 2)} | 3m ${fmtSigned(r.change3m, 2)} | z ${fmtSigned(r.z, 1)} | ${r.stance} — ${r.reason} [${r.asOf ?? 'n/a'}]`),
        ),
  }
}

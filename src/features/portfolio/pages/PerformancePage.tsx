import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { BENCHMARKS, type AttributionRow, type BenchmarkId, type PerformanceStats, type RiskResponse } from '@shared/portfolio'
import { fmtDate, fmtNum, fmtPct, fmtPctSigned, fmtUsd, fmtUsdSigned } from '../../../design/format'
import { PALETTE, signColor } from '../../../design/tokens'
import { ErrorNote, Explainer, HelpTip, Panel, PanelSkeleton, Segmented, Stat } from '../../../ui'
import { useAttribution, usePerformance, useRisk, useSummary } from '../api'
import { RecordFirstTransaction } from '../components/common'
import { MonthlyHeatmap } from '../components/MonthlyHeatmap'
import { TimeChart } from '../components/TimeChart'

type Range = 'ITD' | '5Y' | '3Y' | '1Y' | 'YTD'
const RANGES: Range[] = ['ITD', '5Y', '3Y', '1Y', 'YTD']

function rangeFrom(r: Range, asOf: string | null): string | undefined {
  if (r === 'ITD' || !asOf) return undefined
  if (r === 'YTD') return `${asOf.slice(0, 4)}-01-01`
  const years = Number(r[0])
  return `${Number(asOf.slice(0, 4)) - years}${asOf.slice(4)}`
}

export default function PerformancePage() {
  const summary = useSummary()
  const [benchmark, setBenchmark] = useState<BenchmarkId>('GLD')
  const [range, setRange] = useState<Range>('ITD')
  const from = rangeFrom(range, summary.data?.asOf ?? null)
  const perf = usePerformance(benchmark, from)
  const risk = useRisk()
  const attribution = useAttribution(from)

  if (summary.data?.empty) return <Panel provenance={summary.data.provenance}><RecordFirstTransaction title="No performance history yet" /></Panel>
  if (perf.isLoading || summary.isLoading) return <Panel><PanelSkeleton rows={10} /></Panel>
  if (perf.error) return <ErrorNote error={perf.error} onRetry={() => perf.refetch()} />
  const p = perf.data!
  const s = p.stats
  const r = risk.data

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented<Range> ariaLabel="Period" value={range} onChange={setRange} options={RANGES} />
      <Segmented<BenchmarkId> ariaLabel="Benchmark" value={benchmark} onChange={setBenchmark} options={BENCHMARKS.map((b) => ({ value: b.id, label: b.label }))} />
    </div>
  )
  const var95 = r?.var.find((v) => v.confidence === 0.95)
  const betaGold = r?.betas.find((b) => b.symbol === 'GC=F')

  return (
    <div className={clsx('space-y-6', perf.isPlaceholderData && 'opacity-70 transition-opacity')}>
      <Panel
        title="NAV per unit vs benchmark"
        eyebrow={`${fmtDate(p.from)} – ${fmtDate(p.to)} · rebased to 100`}
        actions={controls}
        provenance={p.provenance}
      >
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={<HelpTip term="TWR">Time-weighted return: chain-linked daily NAV/unit returns, so investor flows don't distort it.</HelpTip>} value={<span className={signColor(s.twr)}>{fmtPctSigned(s.twr)}</span>} hint={`${p.benchmarkLabel} ${fmtPctSigned(p.benchmarkStats?.twr)}`} />
          <Stat label="Annualized" value={fmtPctSigned(s.annualizedReturn)} hint={s.annualizedReturn == null ? 'Shown for periods ≥ 1 year' : `${s.days} calendar days`} />
          <Stat label={<HelpTip term="IRR">Money-weighted return (XIRR) of investor subscriptions and redemptions, with the opening and closing NAV as flows.</HelpTip>} value={fmtPctSigned(s.irr)} hint="Money-weighted" />
          <Stat label="Volatility" value={fmtPct(s.volatility)} hint="Annualized, daily" />
          <Stat label="Sharpe" value={fmtNum(s.sharpe)} hint={`Risk-free ${fmtPct(p.riskFreeRate)}`} />
          <Stat label="Max drawdown" value={<span className="text-neg-text">{fmtPct(p.drawdown.maxDrawdown)}</span>} hint={p.drawdown.peakDate ? `${fmtDate(p.drawdown.peakDate)} → ${fmtDate(p.drawdown.troughDate)}` : undefined} />
        </dl>
        <TimeChart
          ariaLabel={`NAV per unit versus ${p.benchmarkLabel}, rebased to 100`}
          data={p.series}
          series={[
            { key: 'fund', label: 'Fund NAV / unit', color: 'brand' },
            { key: 'benchmark', label: p.benchmarkLabel, color: 'muted', dashed: true },
          ]}
          format={(v) => fmtNum(v, 1)}
          reference={100}
          height={320}
        />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Statistics" eyebrow={`Fund vs ${p.benchmarkLabel}`} provenance={p.provenance}>
          <StatsTable fund={s} bench={p.benchmarkStats} benchLabel={p.benchmarkLabel} />
        </Panel>
        <Panel title="Drawdown" eyebrow="From running peak of NAV / unit" provenance={p.provenance}>
          <TimeChart ariaLabel="Drawdown of NAV per unit" data={p.drawdownSeries} series={[{ key: 'drawdown', label: 'Drawdown', color: 'neg' }]} format={(v) => fmtPct(v, 0)} kind="area" height={200} />
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <Stat size="sm" label="Current" value={fmtPct(p.drawdown.current)} />
            <Stat size="sm" label="Worst episode" value={p.drawdown.durationDays != null ? `${p.drawdown.durationDays} d` : '—'} hint={p.drawdown.recoveryDate ? `Recovered ${fmtDate(p.drawdown.recoveryDate)}` : p.drawdown.peakDate ? 'Not yet recovered' : undefined} />
            <Stat size="sm" label="Calmar" value={fmtNum(s.calmar)} />
          </dl>
        </Panel>
      </div>

      <Panel title="Monthly returns" eyebrow="NAV per unit, year × month" provenance={p.provenance}>
        {p.monthly.length ? <MonthlyHeatmap rows={p.monthly} /> : <p className="text-sm text-muted">Not enough history.</p>}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Rolling volatility" eyebrow="63-day window, annualized" provenance={p.provenance}>
          {p.rollingVol.length ? (
            <TimeChart ariaLabel="Rolling 63-day annualized volatility" data={p.rollingVol} series={[{ key: 'vol', label: 'Volatility', color: 'series2' }]} format={(v) => fmtPct(v, 0)} height={220} />
          ) : (
            <p className="text-sm text-muted">Needs at least 63 daily returns.</p>
          )}
        </Panel>
        <RiskPanel risk={r} loading={risk.isLoading} error={risk.error} var95={var95} betaGold={betaGold} />
      </div>

      <Panel
        title="Attribution"
        eyebrow={attribution.data?.from ? `${fmtDate(attribution.data.from)} – ${fmtDate(attribution.data.to)}` : 'Contribution to return'}
        provenance={attribution.data?.provenance ?? p.provenance}
      >
        {attribution.isLoading ? (
          <PanelSkeleton />
        ) : attribution.error ? (
          <ErrorNote error={attribution.error} />
        ) : attribution.data && attribution.data.byHolding.length ? (
          <div className="space-y-6">
            <p className="text-sm text-muted">
              Total P&L <span className={clsx('num', signColor(attribution.data.totalPnl))}>{fmtUsdSigned(attribution.data.totalPnl, 0)}</span> · TWR{' '}
              <span className="num text-foreground">{fmtPctSigned(attribution.data.twr)}</span>
              {attribution.data.residual != null && Math.abs(attribution.data.residual) > 1e-6 && <> · residual {fmtPctSigned(attribution.data.residual)}</>}
            </p>
            <div className="grid gap-8 xl:grid-cols-3">
              <AttributionTable title="By holding" rows={attribution.data.byHolding} />
              <AttributionTable title="By sleeve" rows={attribution.data.bySleeve} />
              <AttributionTable title="By metal" rows={attribution.data.byMetal} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No P&L in this period.</p>
        )}
      </Panel>

      <Explainer>
        <p>NAV per unit is the fund's unit price. Subscriptions and redemptions issue or cancel units at the day's pre-flow NAV per unit, so NAV per unit moves only with investment performance.</p>
        <p>TWR chain-links daily NAV/unit returns; IRR is money-weighted and rewards good timing of flows. Futures add their variation P&L to NAV, not their notional. VaR is a one-day loss not exceeded on 95% (99%) of days, historical (empirical quantile) or parametric (Gaussian). CVaR is the average loss beyond VaR.</p>
        <p>Contributions are daily P&L divided by prior-day NAV, linked by NAV/unit growth so they sum exactly to TWR.</p>
      </Explainer>
    </div>
  )
}

function StatsTable({ fund, bench, benchLabel }: { fund: PerformanceStats; bench: PerformanceStats | null; benchLabel: string }) {
  const rows: [string, (x: PerformanceStats) => string][] = [
    ['Total return (TWR)', (x) => fmtPctSigned(x.twr)],
    ['Annualized return', (x) => fmtPctSigned(x.annualizedReturn)],
    ['Money-weighted (IRR)', (x) => fmtPctSigned(x.irr)],
    ['Volatility', (x) => fmtPct(x.volatility)],
    ['Sharpe ratio', (x) => fmtNum(x.sharpe)],
    ['Sortino ratio', (x) => fmtNum(x.sortino)],
    ['Calmar ratio', (x) => fmtNum(x.calmar)],
    ['Best day', (x) => fmtPctSigned(x.bestDay)],
    ['Worst day', (x) => fmtPctSigned(x.worstDay)],
    ['Positive days', (x) => fmtPct(x.positiveDays, 0)],
  ]
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Performance statistics</caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="label py-2 text-left font-medium">Measure</th>
          <th scope="col" className="label py-2 text-right font-medium">Fund</th>
          <th scope="col" className="label py-2 text-right font-medium">{benchLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, f]) => (
          <tr key={label} className="border-b border-border/50 last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal text-muted">{label}</th>
            <td className="num py-1.5 text-right text-foreground">{f(fund)}</td>
            <td className="num py-1.5 text-right text-muted">{bench ? f(bench) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RiskPanel({ risk, loading, error, var95, betaGold }: { risk?: RiskResponse; loading: boolean; error: unknown; var95?: RiskResponse['var'][number]; betaGold?: RiskResponse['betas'][number] }) {
  if (loading) return <Panel title="Risk"><PanelSkeleton /></Panel>
  if (error || !risk) return <Panel title="Risk"><ErrorNote error={error} /></Panel>
  return (
    <Panel title="Risk" eyebrow={`1-day · ${risk.observations} observations`} provenance={risk.provenance}>
      {risk.var.length === 0 ? (
        <p className="text-sm text-muted">Risk needs at least two daily returns.</p>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-4">
            <Stat size="sm" label="VaR 95% (hist.)" value={fmtUsd(var95?.historicalUsd, 0)} hint={fmtPct(var95?.historicalPct)} />
            <Stat size="sm" label="Gross leverage" value={risk.grossLeverage != null ? `${fmtNum(risk.grossLeverage, 2)}×` : '—'} hint={`Gross ${fmtUsd(risk.grossExposure, 0)}`} />
            <Stat size="sm" label="Beta to gold" value={fmtNum(betaGold?.beta)} hint={`ρ ${fmtNum(betaGold?.correlation)}`} />
          </dl>
          <table className="w-full text-sm">
            <caption className="sr-only">Value at risk</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="label py-1.5 text-left font-medium">Confidence</th>
                <th scope="col" className="label py-1.5 text-right font-medium">Hist. VaR</th>
                <th scope="col" className="label py-1.5 text-right font-medium">Hist. CVaR</th>
                <th scope="col" className="label py-1.5 text-right font-medium">Param. VaR</th>
                <th scope="col" className="label py-1.5 text-right font-medium">Param. CVaR</th>
              </tr>
            </thead>
            <tbody className="num">
              {risk.var.map((v) => (
                <tr key={v.confidence} className="border-b border-border/50 last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal">{fmtPct(v.confidence, 0)}</th>
                  {[
                    [v.historicalUsd, v.historicalPct],
                    [v.historicalCvarUsd, v.historicalCvarPct],
                    [v.parametricUsd, v.parametricPct],
                    [v.parametricCvarUsd, v.parametricCvarPct],
                  ].map(([usd, pct], i) => (
                    <td key={i} className="py-1.5 text-right">
                      {fmtUsd(usd, 0)}
                      <span className="block text-2xs text-muted">{fmtPct(pct)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-sm">
            <caption className="sr-only">Beta and correlation</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="label py-1.5 text-left font-medium">Versus</th>
                <th scope="col" className="label py-1.5 text-right font-medium">Beta</th>
                <th scope="col" className="label py-1.5 text-right font-medium">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {risk.betas.map((b) => (
                <tr key={b.symbol} className="border-b border-border/50 last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-muted">{b.label}</th>
                  <td className="num py-1.5 text-right">{fmtNum(b.beta)}</td>
                  <td className="num py-1.5 text-right">{fmtNum(b.correlation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function AttributionTable({ title, rows }: { title: string; rows: AttributionRow[] }) {
  const max = useMemo(() => Math.max(...rows.map((r) => Math.abs(r.contribution)), 1e-9), [rows])
  return (
    <table className="w-full text-sm">
      <caption className="label mb-2 text-left">{title}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Contribution</th>
          <th scope="col">P&L</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-border/50 last:border-0">
            <th scope="row" className="max-w-[10rem] truncate py-1.5 pr-2 text-left font-normal text-foreground" title={r.label}>
              {r.key.length <= 8 && r.key !== r.label ? r.key : r.label}
            </th>
            <td className="w-[35%] py-1.5 pr-2" aria-hidden>
              <div className="relative h-2">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                <div
                  className="absolute inset-y-0 rounded-[2px]"
                  style={{
                    background: r.contribution >= 0 ? PALETTE.pos : PALETTE.neg,
                    width: `${(Math.abs(r.contribution) / max) * 50}%`,
                    left: r.contribution >= 0 ? '50%' : undefined,
                    right: r.contribution < 0 ? '50%' : undefined,
                  }}
                />
              </div>
            </td>
            <td className={clsx('num py-1.5 text-right', signColor(r.contribution))}>{fmtPctSigned(r.contribution)}</td>
            <td className="num py-1.5 pl-2 text-right text-muted">{fmtUsdSigned(r.pnl, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

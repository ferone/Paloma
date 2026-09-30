import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { HoldingsResponse, PerformanceResponse, PortfolioSummary, RiskResponse } from '@shared/portfolio'
import type { AiReport, AiReportSummary, PortfolioCommentaryBody } from '@shared/ai'
import { api } from '../../api/client'
import { Button, EmptyState, ErrorNote, PanelSkeleton } from '../../ui'
import { fmtDate, fmtNum, fmtPct, fmtPctSigned, fmtUsd, fmtUsdCompact } from '../../design/format'
import { signColor } from '../../design/tokens'
import { NavChart } from './NavChart'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SLEEVE_LABEL: Record<string, string> = { physical: 'Physical metal', etf: 'ETFs', futures: 'Futures', equity: 'Equities', cash: 'Cash' }

/**
 * Read-only investor factsheet. Composes the portfolio and AI APIs; prints to a
 * clean A4 page via the browser (print styles force the light token set).
 */
export default function InvestorReportPage() {
  const summary = useQuery({ queryKey: ['portfolio', 'summary'], queryFn: async () => (await api.get<PortfolioSummary>('/portfolio/summary')).data })
  const perf = useQuery({ queryKey: ['portfolio', 'performance', 'GLD'], queryFn: async () => (await api.get<PerformanceResponse>('/portfolio/performance', { params: { benchmark: 'GLD' } })).data })
  const risk = useQuery({ queryKey: ['portfolio', 'risk'], queryFn: async () => (await api.get<RiskResponse>('/portfolio/risk')).data })
  const holdings = useQuery({ queryKey: ['portfolio', 'holdings'], queryFn: async () => (await api.get<HoldingsResponse>('/portfolio/holdings')).data })
  const commentary = useQuery({
    queryKey: ['ai', 'reports', 'portfolio_commentary', 'latest'],
    queryFn: async () => {
      const list = (await api.get<AiReportSummary[]>('/ai/reports', { params: { kind: 'portfolio_commentary', limit: 10 } })).data
      const latest = list.find((r) => r.status === 'succeeded')
      return latest ? (await api.get<AiReport>(`/ai/reports/${latest.id}`)).data : null
    },
  })

  if (summary.isLoading || perf.isLoading) return <PanelSkeleton rows={10} />
  if (summary.error || !summary.data) return <ErrorNote error={summary.error} onRetry={() => summary.refetch()} />

  const s = summary.data
  if (s.empty) {
    return (
      <EmptyState
        title="The investor report needs fund history"
        action={
          <Link to="/portfolio/ledger" className="rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background">
            Go to the ledger
          </Link>
        }
      >
        Record subscriptions and positions first; the factsheet is generated from the ledger and NAV history.
      </EmptyState>
    )
  }

  const p = perf.data
  const r = risk.data
  const var95 = r?.var.find((v) => v.confidence === 0.95 && v.horizonDays === 1) ?? r?.var[0]
  const goldBeta = r?.betas.find((b) => b.symbol === 'GC=F')
  const topHoldings = (holdings.data?.holdings ?? []).filter((h) => h.value !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 8)
  const body = commentary.data?.body?.kind === 'portfolio_commentary' ? (commentary.data.body as PortfolioCommentaryBody) : null

  return (
    <article className="mx-auto max-w-[920px] print:max-w-none">
      <div className="no-print mb-6 flex items-center justify-between gap-4">
        <p className="text-xs text-muted">Read-only view for investors. Print or save as PDF for distribution.</p>
        <Button variant="primary" onClick={() => window.print()}>
          Download PDF
        </Button>
      </div>

      {/* Masthead */}
      <header className="border-b-2 border-foreground pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">Monthly factsheet · Precious metals</div>
            <h1 className="display mt-2 text-[2.5rem] font-light leading-none text-foreground">Gold &amp; Silver Fund</h1>
          </div>
          <div className="text-right text-xs text-muted">
            <div>Data as of <span className="text-foreground">{fmtDate(s.asOf)}</span></div>
            {s.inceptionDate && <div>Inception {fmtDate(s.inceptionDate)}</div>}
            <div>Reporting currency USD</div>
          </div>
        </div>
      </header>

      {/* Key figures */}
      <section className="grid grid-cols-2 gap-6 border-b border-border py-6 sm:grid-cols-4">
        <KeyFigure label="NAV per unit" value={fmtNum(s.navPerUnit, 4)} serif />
        <KeyFigure label="Fund assets" value={fmtUsdCompact(s.nav)} serif />
        <KeyFigure label="Year to date" value={fmtPctSigned(s.ytdReturn)} tone={s.ytdReturn} />
        <KeyFigure label="Since inception" value={fmtPctSigned(s.sinceInceptionReturn)} tone={s.sinceInceptionReturn} />
      </section>

      <div className="grid gap-10 py-6 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] print:grid-cols-[1.6fr_1fr]">
        <div className="space-y-8">
          {/* Commentary */}
          <section>
            <h2 className="display mb-3 text-xl text-foreground">Manager commentary</h2>
            {body ? (
              <>
                <p className="mb-2 font-medium text-foreground">{body.headline}</p>
                <p className="max-w-[68ch] text-sm leading-relaxed text-foreground/90">{body.paragraph}</p>
                {body.bullets.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/90">
                    {body.bullets.map((b) => (
                      <li key={b.text}>{b.text}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-2xs text-muted">
                  Drafted with AI assistance ({commentary.data?.model}) from fund and market data as of {fmtDate(commentary.data?.asOf ?? null)}; reviewed by the manager.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                No commentary yet.{' '}
                <Link to="/macro/analyst" className="no-print text-brand underline underline-offset-2">
                  Draft one with the AI analyst
                </Link>
              </p>
            )}
          </section>

          {/* Performance chart */}
          <section>
            <h2 className="display mb-3 text-xl text-foreground">Performance</h2>
            {p && p.series.length > 1 ? <NavChart series={p.series} benchmarkLabel={p.benchmarkLabel} /> : <p className="text-sm text-muted">Performance history is not available yet.</p>}
          </section>

          {/* Calendar returns */}
          {p && p.monthly.length > 0 && (
            <section>
              <h2 className="display mb-3 text-xl text-foreground">Monthly returns</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-border-strong">
                      <th className="label py-1.5 pr-2 text-left font-medium">Year</th>
                      {MONTHS.map((m) => (
                        <th key={m} className="label px-1 py-1.5 text-right font-medium">
                          {m}
                        </th>
                      ))}
                      <th className="label py-1.5 pl-2 text-right font-medium text-foreground">YTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...p.monthly].reverse().map((row) => (
                      <tr key={row.year} className="border-b border-border/60">
                        <td className="num py-1.5 pr-2 text-foreground">{row.year}</td>
                        {row.months.map((v, i) => (
                          <td key={i} className={clsx('num px-1 py-1.5 text-right', signColor(v))}>
                            {v == null ? '' : fmtNum(v * 100, 1)}
                          </td>
                        ))}
                        <td className={clsx('num py-1.5 pl-2 text-right font-medium', signColor(row.ytd))}>{row.ytd == null ? '' : fmtNum(row.ytd * 100, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-2xs text-muted">Net returns in %, based on NAV per unit.</p>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-8">
          <FactTable
            title="Returns"
            rows={[
              ['Month to date', fmtPctSigned(s.mtdReturn), s.mtdReturn],
              ['Year to date', fmtPctSigned(s.ytdReturn), s.ytdReturn],
              ['Since inception', fmtPctSigned(s.sinceInceptionReturn), s.sinceInceptionReturn],
              ['Annualized', fmtPctSigned(p?.stats.annualizedReturn), p?.stats.annualizedReturn],
              [`${p?.benchmarkLabel ?? 'Benchmark'} (same period)`, fmtPctSigned(p?.benchmarkStats?.twr), p?.benchmarkStats?.twr],
            ]}
          />
          <FactTable
            title="Risk"
            rows={[
              ['Volatility (ann.)', fmtPct(p?.stats.volatility, 1)],
              ['Sharpe ratio', fmtNum(p?.stats.sharpe, 2)],
              ['Sortino ratio', fmtNum(p?.stats.sortino, 2)],
              ['Maximum drawdown', fmtPct(p ? -Math.abs(p.drawdown.maxDrawdown) : null, 1)],
              ['1-day VaR (95%)', var95 ? fmtPct(var95.historicalPct, 2) : '—'],
              ['Beta to gold', fmtNum(goldBeta?.beta, 2)],
            ]}
          />
          <section>
            <h2 className="label mb-2 border-b border-border-strong pb-1.5 text-foreground">Allocation</h2>
            <ul className="space-y-2 text-sm">
              {s.allocation
                .filter((a) => a.weight > 0)
                .sort((a, b) => b.weight - a.weight)
                .map((a) => (
                  <li key={a.sleeve}>
                    <div className="flex justify-between">
                      <span className="text-foreground">{SLEEVE_LABEL[a.sleeve] ?? a.sleeve}</span>
                      <span className="num text-foreground">{fmtPct(a.weight, 1)}</span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-surface-2">
                      <div className="h-1 rounded-full bg-brand" style={{ width: `${Math.min(100, a.weight * 100)}%` }} />
                    </div>
                  </li>
                ))}
            </ul>
            {s.byMetal.length > 0 && (
              <p className="mt-3 text-2xs text-muted">
                Metal exposure:{' '}
                {s.byMetal
                  .filter((m) => m.weight > 0)
                  .map((m) => `${m.metal} ${fmtPct(m.weight, 0)}`)
                  .join(' · ')}
              </p>
            )}
          </section>
          {topHoldings.length > 0 && (
            <section>
              <h2 className="label mb-2 border-b border-border-strong pb-1.5 text-foreground">Largest positions</h2>
              <table className="w-full text-sm">
                <tbody>
                  {topHoldings.map((h) => (
                    <tr key={h.instrumentId} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 pr-2 text-foreground">{h.name}</td>
                      <td className="num py-1.5 text-right text-muted">{fmtPct(h.weight, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </aside>
      </div>

      <footer className="border-t border-border pt-4 text-[10px] leading-relaxed text-muted">
        Figures are unaudited and computed from the fund ledger with Yahoo Finance closing prices; futures are marked to the front-month contract and physical metal to spot{s.warnings.length > 0 ? ` (${s.warnings.length} data warning${s.warnings.length > 1 ? 's' : ''})` : ''}. Past performance is not a reliable indicator of future results. The value of investments can fall as well as rise. This document is for information only and does not constitute an offer or solicitation. Fund NAV {fmtUsd(s.nav, 0)} as of {fmtDate(s.asOf)}.
      </footer>
    </article>
  )
}

function KeyFigure({ label, value, serif, tone }: { label: string; value: string; serif?: boolean; tone?: number | null }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={clsx('mt-1.5', serif ? 'display text-[1.9rem] font-light leading-none text-foreground' : ['num text-2xl', signColor(tone)])}>{value}</div>
    </div>
  )
}

function FactTable({ title, rows }: { title: string; rows: [string, string, (number | null | undefined)?][] }) {
  return (
    <section>
      <h2 className="label mb-2 border-b border-border-strong pb-1.5 text-foreground">{title}</h2>
      <dl className="text-sm">
        {rows.map(([k, v, tone]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className={clsx('num', tone === undefined ? 'text-foreground' : signColor(tone))}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

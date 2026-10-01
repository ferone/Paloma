import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { pairRatio, type OverviewResponse } from '@shared/overview'
import { RELATIVE_VALUE_PAIRS } from '@shared/universe'
import { assetBucketLabel as assetLabel } from '@shared/portfolio'
import type { PortfolioSummaryLite, QuantOpportunityLite, MlPredictionLite, MacroDriverLite, Sleeve } from '@shared/artifacts'
import { api } from '../../api/client'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { Chip, EmptyState, ErrorNote, PageHeader, Panel, PanelSkeleton, Stat, type ChipTone } from '../../ui'
import { fmtAge, fmtNum, fmtPct, fmtPctSigned, fmtSigned, fmtUsd, fmtUsdCompact, fmtUsdSigned, fmtRatio } from '../../design/format'
import { PALETTE, signColor, TIER } from '../../design/tokens'

const SLEEVE_LABEL: Record<Sleeve, string> = {
  physical: 'Direct holdings',
  etf: 'ETFs',
  futures: 'Futures',
  equity: 'Equities',
  cash: 'Cash',
}
const SLEEVE_COLOR: Record<Sleeve, string> = {
  physical: 'var(--series-1)',
  etf: 'var(--series-2)',
  futures: 'var(--series-5)',
  equity: 'var(--series-4)',
  cash: 'var(--series-6)',
}

export default function OverviewPage() {
  const refetchInterval = useAutoRefresh()
  const q = useQuery({
    queryKey: ['overview'],
    queryFn: async () => (await api.get<OverviewResponse>('/overview')).data,
    refetchInterval,
  })

  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

  return (
    <>
      <PageHeader eyebrow={today} title="Fund overview" description="Where the fund stands, what the market is doing, and where the models see an edge." />

      {q.isLoading ? (
        <PanelSkeleton rows={8} />
      ) : q.error || !q.data ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <FundPanel portfolio={q.data.portfolio?.data ?? null} generatedAt={q.data.portfolio?.generatedAt ?? null} />
          <MarketStrip data={q.data} />
          <div className="grid gap-6 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <OpportunitiesPanel ops={q.data.quant?.data.opportunities ?? null} generatedAt={q.data.quant?.generatedAt ?? null} dataThrough={q.data.quant?.data.dataThrough ?? null} />
            </div>
            <div className="space-y-6 xl:col-span-2">
              <MacroPanel regime={q.data.macro?.data.regime ?? null} drivers={q.data.macro?.data.drivers ?? null} generatedAt={q.data.macro?.generatedAt ?? null} />
              <MlPanel predictions={q.data.ml?.data.predictions ?? null} generatedAt={q.data.ml?.generatedAt ?? null} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FundPanel({ portfolio, generatedAt }: { portfolio: PortfolioSummaryLite | null; generatedAt: string | null }) {
  if (!portfolio || portfolio.nav === 0) {
    return (
      <Panel>
        <EmptyState
          title="No fund activity recorded yet"
          action={
            <Link to="/portfolio/ledger" className="rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background hover:bg-foreground/85">
              Record the first subscription
            </Link>
          }
        >
          NAV, returns and allocation appear here once the ledger has a subscription and at least one position.
        </EmptyState>
      </Panel>
    )
  }

  const returns: { label: string; value: number | null }[] = [
    { label: 'Today', value: portfolio.dayReturn },
    { label: 'Month to date', value: portfolio.mtdReturn },
    { label: 'Year to date', value: portfolio.ytdReturn },
    { label: 'Since inception', value: portfolio.sinceInceptionReturn },
  ]

  return (
    <Panel provenance={{ source: 'Fund ledger · Yahoo Finance closes', asOf: portfolio.asOf, note: generatedAt ? `recomputed ${fmtAge(generatedAt)}` : undefined }}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <Stat size="hero" label="NAV per unit" value={portfolio.navPerUnit != null ? fmtNum(portfolio.navPerUnit, 4) : '—'} />
            <Stat size="lg" label="Net asset value" value={fmtUsd(portfolio.nav, 0)} delta={portfolio.dayPnl != null ? `${fmtUsdSigned(portfolio.dayPnl, 0)} today` : undefined} deltaValue={portfolio.dayPnl} />
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
            {returns.map((r) => (
              <div key={r.label}>
                <dt className="label">{r.label}</dt>
                <dd className={clsx('num mt-1 text-lg', signColor(r.value))}>{fmtPctSigned(r.value)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <div className="label mb-2">Allocation</div>
          <AllocationBar items={portfolio.allocation} />
          <ul className="mt-3 divide-y divide-border/60 text-sm">
            {portfolio.allocation
              .filter((a) => a.value !== 0)
              .sort((a, b) => b.value - a.value)
              .map((a) => (
                <li key={a.sleeve} className="flex items-center gap-3 py-1.5">
                  <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: SLEEVE_COLOR[a.sleeve] }} />
                  <span className="flex-1 text-foreground">{SLEEVE_LABEL[a.sleeve]}</span>
                  <span className="num text-muted">{fmtUsdCompact(a.value)}</span>
                  <span className="num w-14 text-right text-foreground">{fmtPct(a.weight, 1)}</span>
                </li>
              ))}
          </ul>
          {portfolio.byAsset.length > 0 && (
            <p className="mt-3 text-2xs text-muted">
              By asset:{' '}
              {portfolio.byAsset
                .filter((m) => m.value !== 0)
                .map((m) => `${assetLabel(m.asset)} ${fmtPct(m.weight, 0)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}

function AllocationBar({ items }: { items: PortfolioSummaryLite['allocation'] }) {
  const positive = items.filter((a) => a.weight > 0)
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Allocation by sleeve">
      {positive.map((a) => (
        <div key={a.sleeve} style={{ width: `${a.weight * 100}%`, background: SLEEVE_COLOR[a.sleeve] }} title={`${SLEEVE_LABEL[a.sleeve]} ${fmtPct(a.weight, 1)}`} />
      ))}
    </div>
  )
}

function MarketStrip({ data }: { data: OverviewResponse }) {
  return (
    <section aria-label="Markets" className="rounded-lg border border-border bg-surface">
      <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 lg:grid-cols-7 lg:divide-x">
        {data.markets.map((m) => {
          const isYield = m.symbol === '^TNX'
          return (
            <div key={m.symbol} className="px-4 py-3">
              <dt className="label">{m.label}</dt>
              <dd className="num mt-1 text-base text-foreground">{isYield ? `${fmtNum(m.price, 2)}%` : m.symbol.startsWith('^') || m.symbol.includes('.') ? fmtNum(m.price, 2) : fmtUsd(m.price, 2)}</dd>
              <dd className={clsx('num text-2xs', signColor(m.change))}>
                {isYield ? `${fmtSigned(m.change * 100, 0)} bp` : fmtPctSigned(m.changePercent / 100)}
              </dd>
            </div>
          )
        })}
        {RELATIVE_VALUE_PAIRS.map((pair) => {
          const { ratio, caption } = pairRatio(pair, data.markets)
          return (
            <div key={pair.id} className="px-4 py-3">
              <dt className="label">{pair.label}</dt>
              <dd className="num mt-1 text-base text-foreground">{fmtRatio(ratio, 2)}</dd>
              <dd className="text-2xs text-muted">{caption}</dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

const VERDICT_TONE: Record<QuantOpportunityLite['verdict'], ChipTone> = { BUY: 'strong', SELL: 'avoid', AVOID: 'neutral' }
const OOS_TONE: Record<QuantOpportunityLite['oosStatus'], ChipTone> = { passed: 'strong', failed: 'avoid', untested: 'neutral' }

function OpportunitiesPanel({ ops, generatedAt, dataThrough }: { ops: QuantOpportunityLite[] | null; generatedAt: string | null; dataThrough: string | null }) {
  const top = (ops ?? []).filter((o) => o.verdict !== 'AVOID').sort((a, b) => b.qtRank - a.qtRank).slice(0, 5)
  return (
    <Panel
      eyebrow="Quant Lab"
      title="Where the models see an edge"
      actions={<Link to="/quant" className="text-xs text-muted hover:text-foreground">Open scanner →</Link>}
      provenance={{ source: 'Quant engine · Databento GLBX.MDP3', asOf: dataThrough, note: generatedAt ? `run ${fmtAge(generatedAt)}` : undefined }}
    >
      {!ops ? (
        <EmptyState compact title="The quant engine hasn’t run yet" action={<Link to="/data" className="text-sm text-brand underline underline-offset-2">Load contract history in the Data Center</Link>}>
          Spreads, butterflies and seasonal windows need per-contract futures history.
        </EmptyState>
      ) : top.length === 0 ? (
        <EmptyState compact title="No actionable setups today">Every instrument is either inside its normal range or blocked by a gate. Standing aside is a position.</EmptyState>
      ) : (
        <ol className="divide-y divide-border/60">
          {top.map((o) => (
            <li key={o.id}>
              <Link to={`/quant/i/${encodeURIComponent(o.id)}`} className="-mx-2 flex items-center gap-3 rounded px-2 py-2.5 hover:bg-surface-2">
                <Chip tone={VERDICT_TONE[o.verdict]}>{o.side === 'long' ? 'Long' : 'Short'}</Chip>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{o.label}</span>
                <span className={clsx('hidden text-2xs sm:inline', TIER[o.tier].text)}>{TIER[o.tier].label}</span>
                <span className="num w-14 text-right text-xs text-muted">z {fmtSigned(o.z, 2)}</span>
                <Chip tone={OOS_TONE[o.oosStatus]} title="Walk-forward out-of-sample validation">
                  OOS {o.oosStatus}
                </Chip>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

const STANCE_TONE: Record<MacroDriverLite['stance'], ChipTone> = { tailwind: 'strong', headwind: 'avoid', neutral: 'neutral' }

function MacroPanel({ regime, drivers, generatedAt }: { regime: string | null; drivers: MacroDriverLite[] | null; generatedAt: string | null }) {
  return (
    <Panel
      eyebrow="Macro"
      title={regime ?? 'Macro regime'}
      actions={<Link to="/macro" className="text-xs text-muted hover:text-foreground">Macro & AI →</Link>}
      provenance={{ source: 'FRED · CFTC · Yahoo Finance', asOf: generatedAt ? generatedAt.slice(0, 10) : null }}
    >
      {!drivers || drivers.length === 0 ? (
        <EmptyState compact title="Macro data not loaded">Run a macro refresh to score real yields, the dollar and positioning.</EmptyState>
      ) : (
        <ul className="divide-y divide-border/60 text-sm">
          {drivers.slice(0, 6).map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 text-foreground">{d.label}</span>
              <span className="num text-xs text-muted">{fmtNum(d.value, 2)}</span>
              <Chip tone={STANCE_TONE[d.stance]}>{d.stance}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function MlPanel({ predictions, generatedAt }: { predictions: MlPredictionLite[] | null; generatedAt: string | null }) {
  const outrights = (predictions ?? []).filter((p) => p.pUp != null)
  return (
    <Panel
      eyebrow="Intelligence"
      title="Model signal · 20-day direction"
      actions={<Link to="/intelligence" className="text-xs text-muted hover:text-foreground">Details →</Link>}
      provenance={{ source: 'Gradient-boosted classifier, walk-forward validated', asOf: generatedAt ? generatedAt.slice(0, 10) : null }}
    >
      {outrights.length === 0 ? (
        <EmptyState compact title="No model run yet">Train the model in Intelligence to see calibrated probabilities.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {outrights.map((p) => {
            const validated = p.validationStatus === 'passed'
            const pUp = p.pUp ?? 0.5
            return (
              <li key={p.instrumentId}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-foreground">{assetLabel(p.asset)}</span>
                  <span className={clsx('num text-sm', validated ? 'text-foreground' : 'text-muted')}>P(up) {fmtPct(pUp, 0)}</span>
                </div>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-surface-2">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" aria-hidden />
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      left: `${Math.min(pUp, 0.5) * 100}%`,
                      width: `${Math.abs(pUp - 0.5) * 100}%`,
                      background: validated ? (pUp >= 0.5 ? PALETTE.pos : PALETTE.neg) : PALETTE.faint,
                    }}
                  />
                </div>
                {!validated && <p className="mt-1 text-2xs text-muted">Not validated ({p.validationStatus}) — informational only.</p>}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

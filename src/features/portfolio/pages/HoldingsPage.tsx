import clsx from 'clsx'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HoldingView, HoldingsResponse, PortfolioSummary } from '@shared/portfolio'
import { SLEEVE_LABEL } from '@shared/portfolio'
import { fmtDate, fmtNum, fmtPct, fmtPctSigned, fmtSigned, fmtUsd, fmtUsdCompact, fmtUsdSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { Chip, ErrorNote, HelpTip, Panel, PanelSkeleton, Stat } from '../../../ui'
import { useAccounts, useHoldings, useSummary } from '../api'
import { AllocationBar } from '../components/AllocationBar'
import { ASSET_BUCKET_COLOR, SLEEVE_COLOR } from '../components/colors'
import { RecordFirstTransaction, Warnings } from '../components/common'
import { assetLabel, fmtQty, qtyDigits } from '../components/units'
import { useAssistantContext } from '../../assistant/context'
import { holdingsSummary } from '../../assistant/summaries'

export default function HoldingsPage() {
  const summary = useSummary()
  const holdings = useHoldings()
  useAssistantContext(() => holdingsSummary(summary.data, holdings.data), [summary.data, holdings.data])

  if (summary.isLoading || holdings.isLoading) return <Panel><PanelSkeleton rows={8} /></Panel>
  if (summary.error || holdings.error) return <ErrorNote error={summary.error ?? holdings.error} onRetry={() => { summary.refetch(); holdings.refetch() }} />
  const s = summary.data!
  const h = holdings.data!
  if (s.empty) return <Panel provenance={s.provenance}><RecordFirstTransaction /></Panel>

  return (
    <div className="space-y-6">
      <NavHero s={s} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Allocation by sleeve" eyebrow="Share of NAV" provenance={{ source: 'Fund ledger', asOf: s.asOf, note: 'Futures count at variation P&L, not notional' }}>
          <AllocationBar
            caption="Allocation by sleeve"
            items={s.allocation.map((a) => ({ key: a.sleeve, label: SLEEVE_LABEL[a.sleeve], value: a.value, weight: a.weight, color: SLEEVE_COLOR[a.sleeve] }))}
          />
        </Panel>
        <Panel title="Allocation by asset" eyebrow="Share of NAV" provenance={{ source: 'Fund ledger', asOf: s.asOf, note: `Gross exposure ${fmtUsdCompact(s.grossExposure)} (${fmtPct(s.nav ? s.grossExposure / s.nav : null, 0)} of NAV)` }}>
          <AllocationBar
            caption="Allocation by asset"
            items={s.byMetal.map((m) => ({ key: m.metal, label: assetLabel(m.metal), value: m.value, weight: m.weight, color: ASSET_BUCKET_COLOR[m.metal] }))}
          />
          {s.netExposure.length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-3">
              {s.netExposure.map((x) => (
                <div key={x.asset}>
                  <dt className="label">
                    <HelpTip term={`${assetLabel(x.asset)} exposure`}>
                      Direct holdings + futures contracts × contract size + ETF value ÷ spot ({x.unitLabel}-equivalent). Miners excluded.
                    </HelpTip>
                  </dt>
                  <dd className="num mt-0.5 text-foreground">{fmtQty(x.exposureUnits, x.unitLabel, 1)}</dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>
      <Warnings items={h.warnings} />
      <HoldingsTables h={h} />
    </div>
  )
}

function NavHero({ s }: { s: PortfolioSummary }) {
  const periods = [
    { label: 'Day', v: s.dayReturn },
    { label: 'MTD', v: s.mtdReturn },
    { label: 'YTD', v: s.ytdReturn },
    { label: 'Since inception', v: s.sinceInceptionReturn },
  ]
  return (
    <Panel provenance={s.provenance}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
        <div>
          <Stat size="hero" label={`Net asset value · ${fmtDate(s.asOf)}`} value={fmtUsd(s.nav, 0)} delta={`${fmtUsdSigned(s.dayPnl, 0)} today`} deltaValue={s.dayPnl} />
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="label">NAV per unit</dt>
              <dd className="display mt-0.5 text-2xl text-foreground">{fmtNum(s.navPerUnit, 4)}</dd>
            </div>
            <div>
              <dt className="label">Units outstanding</dt>
              <dd className="num mt-1 text-foreground">{fmtNum(s.unitsOutstanding, 3)}</dd>
            </div>
            <div>
              <dt className="label">Inception</dt>
              <dd className="num mt-1 text-foreground">{fmtDate(s.inceptionDate)}</dd>
            </div>
          </dl>
        </div>
        <div className="grid content-start gap-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {periods.map((p) => (
              <div key={p.label}>
                <dt className="label">{p.label}</dt>
                <dd className={clsx('num mt-1 text-xl', signColor(p.v))}>{fmtPctSigned(p.v)}</dd>
              </div>
            ))}
          </dl>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-4">
            <Stat size="sm" label="Unrealized P&L" value={<span className={signColor(s.unrealizedPnl)}>{fmtUsdSigned(s.unrealizedPnl, 0)}</span>} />
            <Stat size="sm" label="Realized P&L" value={<span className={signColor(s.realizedPnl)}>{fmtUsdSigned(s.realizedPnl, 0)}</span>} />
            <Stat size="sm" label="Income − expenses" value={<span className={signColor(s.income - s.expenses)}>{fmtUsdSigned(s.income - s.expenses, 0)}</span>} />
            <Stat size="sm" label="Net contributions" value={fmtUsd(s.netContributions, 0)} hint={`Total P&L ${fmtUsdSigned(s.totalPnl, 0)}`} />
          </dl>
        </div>
      </div>
    </Panel>
  )
}

function HoldingsTables({ h }: { h: HoldingsResponse }) {
  const accounts = useAccounts()
  const accName = (id: number | null) => accounts.data?.find((a) => a.id === id)?.name ?? '—'
  const securities = h.holdings.filter((x) => x.kind === 'etf' || x.kind === 'equity')
  const physical = h.holdings.filter((x) => x.kind === 'physical')
  const futures = h.holdings.filter((x) => x.kind === 'future')
  const prov = { source: 'Fund ledger · FIFO lots · Yahoo Finance closes', asOf: h.asOf }

  return (
    <div className="space-y-6">
      <Panel title="ETFs and miners" eyebrow={`${securities.length} positions`} provenance={prov}>
        {securities.length ? <LotTable rows={securities} accName={accName} digits={() => 0} /> : <p className="text-sm text-muted">No ETF or miner positions.</p>}
      </Panel>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Direct holdings"
          eyebrow="Allocated bullion (fine oz) and custody balances"
          actions={<Link to="/portfolio/vault" className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline">Vault register</Link>}
          provenance={{ ...prov, note: "Valued at each asset's reference spot, net of the configured haircut" }}
        >
          {physical.length ? <LotTable rows={physical} accName={accName} digits={(r) => qtyDigits(r.asset)} compact /> : <p className="text-sm text-muted">No direct holdings on the ledger.</p>}
        </Panel>
        <Panel title="Futures" eyebrow="Contracts marked to the continuous front month" provenance={{ ...prov, note: 'NAV counts variation P&L; notional shown separately' }}>
          {futures.length ? <FuturesTable rows={futures} /> : <p className="text-sm text-muted">No open futures positions.</p>}
        </Panel>
      </div>
      <Panel title="Cash" eyebrow="By account" provenance={{ source: 'Fund ledger', asOf: h.asOf }}>
        <table className="w-full text-sm">
          <caption className="sr-only">Cash balance by account</caption>
          <tbody>
            {h.cash.map((c) => (
              <tr key={c.accountId ?? c.accountName} className="border-b border-border/50">
                <th scope="row" className="py-2 text-left font-normal">{c.accountName}</th>
                <td className={clsx('num py-2 text-right', c.balance < 0 && 'text-neg-text')}>{fmtUsd(c.balance)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="label pt-3 text-left">Total cash</th>
              <td className="num pt-3 text-right font-medium text-foreground">{fmtUsd(h.totalCash)}</td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

function StaleChip({ row }: { row: HoldingView }) {
  if (!row.priceStale) return null
  return (
    <Chip tone="watch" title={`Marked at ${fmtUsd(row.price)} from ${fmtDate(row.priceDate)}`}>
      Stale mark
    </Chip>
  )
}

function LotTable({ rows, accName, digits, compact }: { rows: HoldingView[]; accName: (id: number | null) => string; digits: (r: HoldingView) => number; compact?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const th = 'label whitespace-nowrap px-2 py-2 font-medium'
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={clsx(th, 'text-left')}>Holding</th>
            <th scope="col" className={clsx(th, 'text-right')}>Quantity</th>
            <th scope="col" className={clsx(th, 'text-right')}>Price</th>
            <th scope="col" className={clsx(th, 'text-right')}>Value</th>
            {!compact && <th scope="col" className={clsx(th, 'text-right')}>Weight</th>}
            <th scope="col" className={clsx(th, 'text-right')}>Avg cost</th>
            <th scope="col" className={clsx(th, 'text-right')}>Unrealized</th>
            {!compact && <th scope="col" className={clsx(th, 'text-right')}>Day</th>}
            {!compact && <th scope="col" className={clsx(th, 'text-right')}>Total P&L</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.instrumentId)
            return (
              <Fragment key={r.instrumentId}>
                <tr className="border-b border-border/60">
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(r.instrumentId)}
                      aria-expanded={isOpen}
                      aria-controls={`lots-${r.instrumentId}`}
                      className="group inline-flex items-center gap-2 text-left"
                    >
                      <span aria-hidden className={clsx('inline-block text-faint transition-transform', isOpen && 'rotate-90')}>›</span>
                      <span>
                        <span className="font-medium text-foreground group-hover:underline">{r.instrumentId}</span>
                        <span className="ml-2 text-xs text-muted">{r.lots.length} {r.lots.length === 1 ? 'lot' : 'lots'}</span>
                      </span>
                    </button>
                    <span className="ml-2">
                      <StaleChip row={r} />
                    </span>
                  </td>
                  <td className="num px-2 text-right">{fmtNum(r.quantity, digits(r))}</td>
                  <td className="num px-2 text-right">{fmtUsd(r.price)}</td>
                  <td className="num px-2 text-right text-foreground">{fmtUsd(r.value, 0)}</td>
                  {!compact && <td className="num px-2 text-right text-muted">{fmtPct(r.weight, 1)}</td>}
                  <td className="num px-2 text-right text-muted">{fmtUsd(r.avgCost)}</td>
                  <td className={clsx('num px-2 text-right', signColor(r.unrealizedPnl))}>{fmtUsdSigned(r.unrealizedPnl, 0)}</td>
                  {!compact && <td className={clsx('num px-2 text-right', signColor(r.dayPnl))}>{fmtUsdSigned(r.dayPnl, 0)}</td>}
                  {!compact && <td className={clsx('num px-2 text-right', signColor(r.totalPnl))}>{fmtUsdSigned(r.totalPnl, 0)}</td>}
                </tr>
                {isOpen && (
                  <tr id={`lots-${r.instrumentId}`} className="border-b border-border/60 bg-surface-2/40">
                    <td colSpan={compact ? 6 : 9} className="px-2 py-2">
                      <table className="w-full text-xs">
                        <caption className="sr-only">FIFO lots for {r.instrumentId}</caption>
                        <thead>
                          <tr className="text-muted">
                            <th scope="col" className="px-2 py-1 text-left font-medium">Opened</th>
                            <th scope="col" className="px-2 py-1 text-left font-medium">Account</th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">Quantity</th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">Unit cost</th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">Cost basis</th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">Value</th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">Unrealized</th>
                            <th scope="col" className="px-2 py-1 text-right font-medium">Held</th>
                          </tr>
                        </thead>
                        <tbody className="num">
                          {r.lots.map((l, i) => (
                            <tr key={`${l.txnId}-${i}`}>
                              <td className="px-2 py-1">{fmtDate(l.openDate)}</td>
                              <td className="px-2 py-1 font-sans">{accName(l.accountId)}</td>
                              <td className="px-2 py-1 text-right">{fmtNum(l.quantity, digits(r))}</td>
                              <td className="px-2 py-1 text-right">{fmtUsd(l.unitCost, 4)}</td>
                              <td className="px-2 py-1 text-right">{fmtUsd(l.costBasis, 0)}</td>
                              <td className="px-2 py-1 text-right">{fmtUsd(l.marketValue, 0)}</td>
                              <td className={clsx('px-2 py-1 text-right', signColor(l.unrealizedPnl))}>{fmtUsdSigned(l.unrealizedPnl, 0)}</td>
                              <td className="px-2 py-1 text-right text-muted">{l.holdingDays} d</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-1 px-2 text-2xs text-muted">
                        Realized {fmtUsdSigned(r.realizedPnl, 0)} · income {fmtUsd(r.income, 0)} · expenses {fmtUsd(r.expenses, 0)} · lot cost includes acquisition fees
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FuturesTable({ rows }: { rows: HoldingView[] }) {
  const th = 'label whitespace-nowrap px-2 py-2 font-medium'
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Open futures positions</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={clsx(th, 'text-left')}>Contract</th>
            <th scope="col" className={clsx(th, 'text-right')}>Contracts</th>
            <th scope="col" className={clsx(th, 'text-right')}>Exposure</th>
            <th scope="col" className={clsx(th, 'text-right')}>Avg entry</th>
            <th scope="col" className={clsx(th, 'text-right')}>Mark</th>
            <th scope="col" className={clsx(th, 'text-right')}>Notional</th>
            <th scope="col" className={clsx(th, 'text-right')}>Variation P&L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.instrumentId} className="border-b border-border/60 last:border-0">
              <td className="px-2 py-2.5">
                <span className="font-medium text-foreground">{r.instrumentId}</span>
                <span className="ml-2 text-xs text-muted">{r.quantity > 0 ? 'Long' : 'Short'}</span> <StaleChip row={r} />
              </td>
              <td className="num px-2 text-right">{fmtSigned(r.quantity, 0)}</td>
              <td className="num px-2 text-right">{fmtQty(r.exposureUnits, r.unitLabel, 0)}</td>
              <td className="num px-2 text-right text-muted">{fmtUsd(r.avgCost)}</td>
              <td className="num px-2 text-right">{fmtUsd(r.price)}</td>
              <td className="num px-2 text-right text-muted">{fmtUsd(r.notional, 0)}</td>
              <td className={clsx('num px-2 text-right', signColor(r.value))}>{fmtUsdSigned(r.value, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

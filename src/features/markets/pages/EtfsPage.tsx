import type { EtfRow } from '@shared/markets'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Chip, DataTable, EmptyState, ErrorNote, Explainer, Panel, PanelSkeleton, type Column } from '../../../ui'
import { fmtCompact, fmtNum, fmtPct, fmtPctSigned, fmtUsdCompact } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { useEtfs } from '../hooks'
import { useAssistantContext } from '../../assistant/context'
import { etfSummary } from '../../assistant/summaries'

const ret = (v: number | null) => <span className={signColor(v)}>{fmtPctSigned(v, 1)}</span>

export default function EtfsPage() {
  const { asset: metal } = useSettings()
  const q = useEtfs(metal)
  useAssistantContext(() => (q.data ? etfSummary(q.data) : null), [q.data])
  const spec = UNIVERSE[metal]

  if (q.isLoading) return <Panel><PanelSkeleton rows={7} /></Panel>
  if (q.error || !q.data) return <Panel><ErrorNote error={q.error ?? new Error('No data')} onRetry={() => q.refetch()} /></Panel>
  const d = q.data
  if (spec.etfs.length === 0 && !spec.miners) {
    return (
      <Panel provenance={d.provenance}>
        <EmptyState title={`No listed funds for ${spec.label.toLowerCase()}`}>
          The universe has no ETF or miners proxy for {spec.label.toLowerCase()}, so there are no premiums or tracking figures to compute.
        </EmptyState>
      </Panel>
    )
  }

  const columns: Column<EtfRow>[] = [
    {
      key: 'symbol',
      header: 'Fund',
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="num font-medium text-foreground">{r.symbol}</span>
            {r.kind === 'miners' && <Chip tone="neutral">Miners</Chip>}
          </div>
          <div className="max-w-52 truncate text-2xs text-muted" title={r.name}>{r.name}</div>
        </div>
      ),
      sortValue: (r) => r.symbol,
    },
    { key: 'price', header: 'Price', numeric: true, cell: (r) => fmtNum(r.price), sortValue: (r) => r.price },
    { key: 'chg', header: 'Day', numeric: true, cell: (r) => ret(r.changePercent), sortValue: (r) => r.changePercent },
    {
      key: 'dvol',
      header: '$ volume',
      numeric: true,
      cell: (r) => <span title={`${fmtCompact(r.volume)} shares`}>{fmtUsdCompact(r.dollarVolume)}</span>,
      sortValue: (r) => r.dollarVolume,
    },
    { key: 'aum', header: 'AUM', numeric: true, cell: (r) => fmtUsdCompact(r.aum), sortValue: (r) => r.aum },
    { key: 'er', header: 'Fee', numeric: true, cell: (r) => fmtPct(r.expenseRatio), sortValue: (r) => r.expenseRatio },
    {
      key: 'nav',
      header: 'NAV',
      numeric: true,
      cell: (r) => (r.premiumMethod === 'modeled' ? <span className="text-muted">{fmtNum(r.nav)}</span> : fmtNum(r.nav)),
      sortValue: (r) => r.nav,
    },
    {
      key: 'prem',
      // Plain `title` tooltips on right-edge headers: a HelpTip popover would overflow the table.
      header: <span title="Market price vs NAV: published NAV where available, otherwise a modeled estimate (marked Modeled). See the notes below.">Prem/disc</span>,
      numeric: true,
      cell: (r) =>
        r.premiumMethod === 'none' ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="inline-flex items-center justify-end gap-1.5">
            {r.premiumMethod === 'modeled' && <Chip tone="modeled" title="Relative to the trust's 1Y median price/spot ratio">Modeled</Chip>}
            <span className={signColor(r.premium)}>{fmtPctSigned(r.premium)}</span>
          </span>
        ),
      sortValue: (r) => r.premium,
    },
    { key: 'm1', header: '1M', numeric: true, cell: (r) => ret(r.returns.m1), sortValue: (r) => r.returns.m1 },
    { key: 'm3', header: '3M', numeric: true, cell: (r) => ret(r.returns.m3), sortValue: (r) => r.returns.m3 },
    { key: 'ytd', header: 'YTD', numeric: true, cell: (r) => ret(r.returns.ytd), sortValue: (r) => r.returns.ytd },
    { key: 'y1', header: '1Y', numeric: true, cell: (r) => ret(r.returns.y1), sortValue: (r) => r.returns.y1 },
    {
      key: 'td',
      header: <span title={`1Y fund return minus 1Y return of ${d.spotSymbol} (front future, the spot proxy). Includes fees and futures roll.`}>Track. diff</span>,
      numeric: true,
      cell: (r) => ret(r.trackingDiff1y),
      sortValue: (r) => r.trackingDiff1y,
    },
    {
      key: 'te',
      header: <span title="Annualized volatility of weekly (fund − spot proxy) return differences over 1Y.">Track. err.</span>,
      numeric: true,
      cell: (r) => fmtPct(r.trackingError1y, 1),
      sortValue: (r) => r.trackingError1y,
    },
    { key: 'corr', header: 'Corr.', numeric: true, cell: (r) => fmtNum(r.correlation1y, 2), sortValue: (r) => r.correlation1y },
  ]

  const physical = d.rows.filter((r) => r.kind === 'physical')
  const cheapest = [...physical].filter((r) => r.expenseRatio != null).sort((a, b) => (a.expenseRatio as number) - (b.expenseRatio as number))[0]
  const deepest = [...physical].filter((r) => r.dollarVolume != null).sort((a, b) => (b.dollarVolume as number) - (a.dollarVolume as number))[0]

  const pick = (keys: string[]) => columns.filter((c) => keys.includes(c.key))
  const marketCols = pick(['symbol', 'price', 'chg', 'dvol', 'aum', 'er', 'nav', 'prem'])
  const perfCols = pick(['symbol', 'm1', 'm3', 'ytd', 'y1', 'td', 'te', 'corr'])

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 2xl:grid-cols-2">
        <Panel density="dense" title={`${spec.label} ETFs · price, liquidity, premium`} eyebrow={spec.miners ? 'Physically backed funds + miners' : 'Physically backed funds'} provenance={d.provenance}>
          <DataTable columns={marketCols} rows={d.rows} rowKey={(r) => r.symbol} dense initialSort={{ key: 'dvol', dir: 'desc' }} caption="ETF price, liquidity and premium" />
          <p className="mt-3 text-xs text-muted">
            {deepest && (
              <>
                Deepest liquidity: <span className="num text-foreground">{deepest.symbol}</span> ({fmtUsdCompact(deepest.dollarVolume)} today).{' '}
              </>
            )}
            {cheapest && (
              <>
                Lowest fee: <span className="num text-foreground">{cheapest.symbol}</span> ({fmtPct(cheapest.expenseRatio)}).
              </>
            )}
          </p>
        </Panel>
        <Panel
          density="dense"
          title="Returns & tracking vs spot"
          eyebrow={
            <span className="num normal-case tracking-normal">
              Spot proxy {d.spotSymbol}: 1M {ret(d.spotReturns.m1)} · 3M {ret(d.spotReturns.m3)} · YTD {ret(d.spotReturns.ytd)} · 1Y {ret(d.spotReturns.y1)}
            </span>
          }
          provenance={{ source: `Yahoo Finance daily closes (1Y) · spot proxy ${d.spotSymbol}`, asOf: d.provenance.asOf }}
        >
          <DataTable columns={perfCols} rows={d.rows} rowKey={(r) => r.symbol} dense initialSort={{ key: 'y1', dir: 'desc' }} caption="ETF returns and tracking" />
        </Panel>
      </div>

      <Explainer title="How premiums and tracking are calculated">
        <p>
          <strong>Premium/discount</strong> compares the last traded price with the latest NAV the fund published (Yahoo, struck at the prior business
          day's reference price, the LBMA PM for metals). Intraday, part of the gap is simply the underlying's move since that fix, so small readings (±0.3%) are noise.
        </p>
        <p>
          <strong>Modeled</strong> (closed-end trusts such as PHYS/PSLV, for which no NAV is available here): we take the median ratio of the trust's
          close to the {d.spotSymbol} close over the past year as its metal per unit, value that at today's price, and compare. It shows whether the
          trust trades rich or cheap <em>relative to its own recent norm</em>, not the premium to its published NAV. Check the sponsor's daily NAV
          before acting on it.
        </p>
        <p>
          <strong>Tracking</strong> uses {d.spotSymbol} as the spot proxy, sampled weekly so the 4 pm ETF close and the 1:30 pm futures settle
          don't read as tracking error. Tracking difference includes fees and the futures roll.
        </p>
      </Explainer>
    </div>
  )
}

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { priceSeriesId, type MacroDashboard, type ScorecardRow } from '@shared/macro'
import { ASSETS, UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Button, Chip, DataTable, EmptyState, ErrorNote, Explainer, HelpTip, Panel, PanelSkeleton, Segmented, type Column } from '../../../ui'
import { fmtDate, fmtNum, fmtSigned } from '../../../design/format'
import { useMacroDashboard, useMacroRefresh, useMacroSeries } from '../api'
import { STANCE_LABEL, STANCE_TONE, alignToDates, changeCorrelation, fmtChange, fmtLevel, isoYearsAgo, thin } from '../lib'
import { AssetPriceChart, DriverChart } from '../components/PairChart'
import { useAssistantContext } from '../../assistant/context'
import { macroSummary } from '../../assistant/summaries'

export default function DashboardPage() {
  const { asset } = useSettings()
  const dash = useMacroDashboard(asset)
  const refresh = useMacroRefresh()
  useAssistantContext(() => (dash.data ? macroSummary(dash.data) : null), [dash.data])

  if (dash.isLoading) return <PanelSkeleton rows={8} />
  if (dash.error) return <ErrorNote error={dash.error} onRetry={() => dash.refetch()} />
  const d = dash.data!
  if (d.empty)
    return (
      <Panel>
        <EmptyState
          title="No macro data yet"
          action={
            <Button variant="primary" onClick={() => refresh.mutate('all')} disabled={refresh.isPending}>
              Fetch FRED, market and COT data
            </Button>
          }
        >
          The scorecard needs FRED series (keyless download works without a FRED key), Yahoo prices ({ASSETS.map((a) => UNIVERSE[a].spot).join(', ')},
          DXY and SPY) and the CFTC Commitments of Traders. The first refresh takes about 30 seconds.
        </EmptyState>
      </Panel>
    )

  return (
    <div className="space-y-5">
      <RegimeStrip d={d} />
      <Scorecard d={d} />
      <SmallMultiples d={d} />
    </div>
  )
}

function RegimeStrip({ d }: { d: MacroDashboard }) {
  return (
    <section aria-label="Macro regime" className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label mb-1.5">Regime · {UNIVERSE[d.asset].label}</div>
          <p className="display text-[clamp(1.25rem,2vw,1.6rem)] leading-snug text-foreground">
            {d.regime.parts.map((p, i) => (
              <span key={p.key}>
                {i > 0 && <span className="mx-2 text-faint">·</span>}
                <span className={clsx(p.stance === 'tailwind' && 'text-pos-text', p.stance === 'headwind' && 'text-neg-text')}>{p.label}</span>
              </span>
            ))}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {d.regime.parts.map((p) => (
              <Chip key={p.key} tone={STANCE_TONE[p.stance]}>
                {p.label.split(' ')[0]} · {STANCE_LABEL[p.stance]}
              </Chip>
            ))}
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="label">Net score</div>
            <div className={clsx('num text-2xl', d.netScore > 0 ? 'text-pos-text' : d.netScore < 0 ? 'text-neg-text' : 'text-foreground')}>
              {fmtSigned(d.netScore, 0)}
            </div>
          </div>
          <div>
            <div className="label">Tailwinds / headwinds</div>
            <div className="num text-2xl text-foreground">
              {d.tailwinds} <span className="text-faint">/</span> {d.headwinds}
            </div>
          </div>
          <div>
            <div className="label">Data through</div>
            <div className="num mt-1.5 text-sm text-foreground">{fmtDate(d.asOf)}</div>
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Explainer title="How the regime is derived">
          <p>
            Three explicit reads, recomputed on every refresh. <strong>Real yields:</strong> the 10-year TIPS yield (DFII10) changed by more than
            ±0.15pp over three months → falling or rising. <strong>Dollar:</strong> the Fed broad dollar index moved more than ±1.5% over three
            months → weakening or strengthening. <strong>Risk:</strong> VIX ≥ 22 or a high-yield spread z-score ≥ 1 → risk-off; VIX ≤ 15 with
            spreads at or below their 3-year mean → risk-on; otherwise mixed.
          </p>
          <p>
            Colour marks the effect on {UNIVERSE[d.asset].label.toLowerCase()}. Risk-off supports a safe haven (gold) but weighs on cyclical
            assets such as silver, industrial metals and crypto, which trade with growth and risk appetite.
          </p>
        </Explainer>
      </div>
    </section>
  )
}

const JARGON: Record<string, string> = {
  DFII10: 'Real yield: the return on 10-year inflation-protected Treasuries after inflation. Real assets pay no coupon, so a higher real yield raises the cost of holding them.',
  T10YIE: 'Breakeven inflation: the inflation rate the bond market is pricing over ten years (nominal minus TIPS yield).',
  COT_MM: 'Managed money: hedge funds and CTAs in the CFTC Commitments of Traders report. Their net long as a share of open interest measures speculative crowding.',
  COT_LF: 'Leveraged funds: hedge funds and CTAs in the CFTC Traders in Financial Futures report. Their net long as a share of open interest measures speculative crowding.',
}

function Scorecard({ d }: { d: MacroDashboard }) {
  const describe = useMemo(() => new Map(d.series.map((s) => [s.id, s.description])), [d.series])
  const cols: Column<ScorecardRow>[] = [
    {
      key: 'driver',
      header: 'Driver',
      cell: (r) => {
        const help = JARGON[r.id] ?? describe.get(r.seriesId)
        return help ? <HelpTip term={r.label}>{help}</HelpTip> : r.label
      },
      sortValue: (r) => r.label,
    },
    { key: 'value', header: 'Value', numeric: true, cell: (r) => fmtLevel(r.value, r.unit), sortValue: (r) => r.value },
    { key: 'c1', header: '1m Δ', numeric: true, cell: (r) => fmtChange(r.change1m, r.changeKind, r.unit), sortValue: (r) => r.change1m },
    { key: 'c3', header: '3m Δ', numeric: true, cell: (r) => fmtChange(r.change3m, r.changeKind, r.unit), sortValue: (r) => r.change3m },
    {
      key: 'z',
      header: <HelpTip term="z (3y)">How many standard deviations the current level sits from its 3-year average. |z| ≥ 2 is unusual.</HelpTip>,
      numeric: true,
      cell: (r) => fmtNum(r.z, 1),
      sortValue: (r) => r.z,
    },
    {
      key: 'stance',
      header: 'Stance',
      cell: (r) => <Chip tone={STANCE_TONE[r.stance]}>{STANCE_LABEL[r.stance]}</Chip>,
      sortValue: (r) => (r.stance === 'tailwind' ? 1 : r.stance === 'headwind' ? -1 : 0),
    },
    {
      key: 'why',
      header: 'Why',
      cell: (r) => (
        <span className="text-xs text-muted" title={`Rule: ${r.rule}`}>
          {r.reason}
        </span>
      ),
    },
    { key: 'asof', header: 'As of', numeric: true, cell: (r) => <span className="text-xs text-muted">{fmtDate(r.asOf)}</span>, sortValue: (r) => r.asOf },
  ]
  return (
    <Panel
      title="Macro scorecard"
      eyebrow={UNIVERSE[d.asset].label}
      density="dense"
      provenance={{ source: 'FRED · Yahoo · CFTC; stances by the documented rules below', asOf: d.asOf }}
    >
      <DataTable columns={cols} rows={d.scorecard} rowKey={(r) => r.id} dense caption="Macro drivers with stance for the asset in focus" />
      <div className="mt-3">
        <Explainer title="Rules behind each stance">
          <ul className="space-y-1">
            {d.scorecard.map((r) => (
              <li key={r.id}>
                <span className="font-medium text-foreground">{r.label}:</span> {r.rule}.
              </li>
            ))}
          </ul>
          <p>Changes compare the latest observation with the one on or before the same date one or three months earlier. Monthly series (CPI, M2) lag by about six weeks.</p>
        </Explainer>
      </div>
    </Panel>
  )
}

/**
 * Driver charts in display order. Only series the dashboard carries for the
 * asset's class are drawn (e.g. GVZ for precious metals, QQQ for crypto), up to six.
 */
const CHART_CANDIDATES = ['DFII10', 'DTWEXBGS', 'T10YIE', 'VIXCLS', 'BAMLH0A0HYM2', 'GVZCLS', 'INDPRO_YOY', 'QQQ', 'M2_YOY']
const MAX_CHARTS = 6

const RANGES = [
  { value: '1', label: '1Y' },
  { value: '3', label: '3Y' },
  { value: '5', label: '5Y' },
] as const

function SmallMultiples({ d }: { d: MacroDashboard }) {
  const [range, setRange] = useState<'1' | '3' | '5'>('3')
  const priceId = priceSeriesId(d.asset)
  const pairs = useMemo(() => {
    const have = new Set(d.series.map((s) => s.id))
    return CHART_CANDIDATES.filter((id) => have.has(id)).slice(0, MAX_CHARTS)
  }, [d.series])
  const from = useMemo(() => isoYearsAgo(Number(range)), [range])
  const q = useMacroSeries([priceId, ...pairs], from)
  const byId = useMemo(() => new Map((q.data?.series ?? []).map((s) => [s.id, s])), [q.data])
  const price = byId.get(priceId)

  // One date axis for all charts: the asset's (thinned) trading days.
  // Each driver is forward-filled onto exactly these dates, so hovering any
  // chart puts every crosshair on the same date.
  const aligned = useMemo(() => {
    if (!price?.points.length) return null
    const dates = thin(price.points, 400).map((p) => p.date)
    return {
      price: alignToDates(dates, price.points),
      drivers: new Map(pairs.map((id) => [id, alignToDates(dates, byId.get(id)?.points ?? [])])),
    }
  }, [price, byId, pairs])

  return (
    <section aria-label="Drivers against price">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium text-foreground">Drivers against {UNIVERSE[d.asset].label.toLowerCase()}</h2>
        <Segmented ariaLabel="Chart range" value={range} options={RANGES} onChange={setRange} />
      </div>
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <PanelSkeleton rows={6} />
      ) : !price?.points.length || !aligned ? (
        <Panel>
          <EmptyState title={`No ${UNIVERSE[d.asset].label.toLowerCase()} price history cached`}>Run a data refresh to cache Yahoo daily closes.</EmptyState>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel
            density="dense"
            title={`${UNIVERSE[d.asset].label} price`}
            provenance={{ source: `Yahoo ${UNIVERSE[d.asset].spot} daily close`, asOf: price.provenance.asOf, note: 'Hover any chart: all panels follow the same date' }}
          >
            <AssetPriceChart asset={d.asset} data={aligned.price} />
          </Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pairs.map((id) => {
              const s = byId.get(id)
              const corr = s && s.points.length ? changeCorrelation(price.points, s.points) : null
              return (
                <Panel
                  key={id}
                  title={s?.label ?? id}
                  density="dense"
                  actions={
                    corr ? (
                      <span
                        className="num text-2xs text-muted"
                        title={`Correlation of daily changes with ${UNIVERSE[d.asset].label.toLowerCase()} over the selected range (${corr.n} days)`}
                      >
                        ρ <span className={corr.rho > 0.15 ? 'text-pos-text' : corr.rho < -0.15 ? 'text-neg-text' : 'text-foreground'}>{fmtSigned(corr.rho, 2)}</span>
                      </span>
                    ) : null
                  }
                  provenance={{ source: s?.provenance.source ?? id, asOf: s?.provenance.asOf ?? null }}
                >
                  {s && s.points.length ? (
                    <DriverChart label={s.label} unit={s.unit} data={aligned.drivers.get(id) ?? []} />
                  ) : (
                    <EmptyState compact title="No data for this series yet" />
                  )}
                </Panel>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

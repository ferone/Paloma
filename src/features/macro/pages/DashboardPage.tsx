import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { MacroDashboard, ScorecardRow } from '@shared/macro'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Button, Chip, DataTable, EmptyState, ErrorNote, Explainer, HelpTip, Panel, PanelSkeleton, Segmented, type Column } from '../../../ui'
import { fmtDate, fmtNum, fmtSigned } from '../../../design/format'
import { useMacroDashboard, useMacroRefresh, useMacroSeries } from '../api'
import { STANCE_LABEL, STANCE_TONE, fmtChange, fmtLevel, isoYearsAgo, changeCorrelation } from '../lib'
import { DriverChart, MetalPriceChart } from '../components/PairChart'

export default function DashboardPage() {
  const { metal } = useSettings()
  const dash = useMacroDashboard(metal)
  const refresh = useMacroRefresh()

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
          The scorecard needs FRED series (keyless download works without a FRED key), Yahoo prices for GC=F, SI=F, DXY and SPY, and the
          CFTC Commitments of Traders. The first refresh takes about 30 seconds.
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
          <div className="label mb-1.5">Regime · {UNIVERSE[d.metal].label}</div>
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
            Colour marks the effect on {UNIVERSE[d.metal].label.toLowerCase()}: risk-off supports gold as a haven but weighs on silver, which also
            behaves like an industrial metal.
          </p>
        </Explainer>
      </div>
    </section>
  )
}

const JARGON: Record<string, string> = {
  DFII10: 'Real yield: the return on 10-year inflation-protected Treasuries after inflation. Gold pays no yield, so a higher real yield raises the cost of holding it.',
  T10YIE: 'Breakeven inflation: the inflation rate the bond market is pricing over ten years (nominal minus TIPS yield).',
  COT_MM: 'Managed money: hedge funds and CTAs in the CFTC Commitments of Traders report. Their net long as a share of open interest measures speculative crowding.',
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
      eyebrow={UNIVERSE[d.metal].label}
      density="dense"
      provenance={{ source: 'FRED · Yahoo · CFTC; stances by the documented rules below', asOf: d.asOf }}
    >
      <DataTable columns={cols} rows={d.scorecard} rowKey={(r) => r.id} dense caption="Macro drivers with stance for the metal in focus" />
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

const PAIRS: { id: string; label: string; note?: string }[] = [
  { id: 'DFII10', label: 'Real yield vs price' },
  { id: 'DTWEXBGS', label: 'Dollar vs price' },
  { id: 'T10YIE', label: 'Breakeven inflation vs price' },
  { id: 'VIXCLS', label: 'VIX vs price' },
  { id: 'BAMLH0A0HYM2', label: 'High-yield spread vs price' },
  { id: 'GVZCLS', label: 'Gold volatility (GVZ) vs price' },
]

const RANGES = [
  { value: '1', label: '1Y' },
  { value: '3', label: '3Y' },
  { value: '5', label: '5Y' },
] as const

function SmallMultiples({ d }: { d: MacroDashboard }) {
  const [range, setRange] = useState<'1' | '3' | '5'>('3')
  const metalId = d.metal === 'gold' ? 'GOLD' : 'SILVER'
  const from = useMemo(() => isoYearsAgo(Number(range)), [range])
  const q = useMacroSeries([metalId, ...PAIRS.map((p) => p.id)], from)
  const byId = useMemo(() => new Map((q.data?.series ?? []).map((s) => [s.id, s])), [q.data])
  const metal = byId.get(metalId)

  return (
    <section aria-label="Drivers against price">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium text-foreground">Drivers against {UNIVERSE[d.metal].label.toLowerCase()}</h2>
        <Segmented ariaLabel="Chart range" value={range} options={RANGES} onChange={setRange} />
      </div>
      {q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <PanelSkeleton rows={6} />
      ) : !metal?.points.length ? (
        <Panel>
          <EmptyState title={`No ${UNIVERSE[d.metal].label.toLowerCase()} price history cached`}>Run a data refresh to cache Yahoo daily closes.</EmptyState>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel
            density="dense"
            title={`${UNIVERSE[d.metal].label} price`}
            provenance={{ source: `Yahoo ${UNIVERSE[d.metal].spot} daily close`, asOf: metal.provenance.asOf, note: 'Hover any chart: all panels follow the same date' }}
          >
            <MetalPriceChart label={UNIVERSE[d.metal].label} color={d.metal} points={metal.points} />
          </Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {PAIRS.map((p) => {
              const s = byId.get(p.id)
              const corr = s && s.points.length ? changeCorrelation(metal.points, s.points) : null
              return (
                <Panel
                  key={p.id}
                  title={s?.label ?? p.id}
                  density="dense"
                  actions={
                    corr ? (
                      <span
                        className="num text-2xs text-muted"
                        title={`Correlation of daily changes with ${UNIVERSE[d.metal].label.toLowerCase()} over the selected range (${corr.n} days)`}
                      >
                        ρ <span className={corr.rho > 0.15 ? 'text-pos-text' : corr.rho < -0.15 ? 'text-neg-text' : 'text-foreground'}>{fmtSigned(corr.rho, 2)}</span>
                      </span>
                    ) : null
                  }
                  provenance={{ source: `FRED ${p.id}`, asOf: s?.provenance.asOf ?? null }}
                >
                  {s && s.points.length ? <DriverChart label={s.label} unit={s.unit} points={s.points} /> : <EmptyState compact title="No data for this series yet" />}
                </Panel>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

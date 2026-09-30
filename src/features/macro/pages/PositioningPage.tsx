import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CotCategoryRow, CotMarket, CotResponse } from '@shared/macro'
import { METALS, UNIVERSE, type Metal } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Chip, DataTable, EmptyState, ErrorNote, Explainer, HelpTip, Panel, PanelSkeleton, Segmented, Stat, type Column } from '../../../ui'
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtPctSigned, fmtSigned } from '../../../design/format'
import { signColor, CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useCot } from '../api'
import { tickMonth, useChartColors } from '../lib'
import { cotStanceLabel } from '../cot'

export default function PositioningPage() {
  const { metal } = useSettings()
  // Metal in focus first, then the other one.
  const order: Metal[] = [metal, ...METALS.filter((m) => m !== metal)]
  return (
    <div className="space-y-6">
      <Explainer title="How to read positioning">
        <p>
          The CFTC Commitments of Traders report splits COMEX futures open interest by trader type. <strong>Managed money</strong> (hedge funds and
          CTAs) is the speculative, trend-following cohort; <strong>producers/merchants</strong> and <strong>swap dealers</strong> are mostly hedgers
          and bullion banks and usually sit net short.
        </p>
        <p>
          We track managed-money net length as a share of open interest and rank it against the last three years (156 weekly reports). Above the 85th
          percentile the trade is crowded (a contrarian headwind); below the 15th it is washed out (a tailwind). Positions are as of Tuesday and are
          published the following Friday at 15:30 ET, so the chart only &ldquo;knows&rdquo; a report from its release date.
        </p>
      </Explainer>
      {order.map((m) => (
        <MarketSection key={m} metal={m} />
      ))}
    </div>
  )
}

const RANGES = [
  { value: '156', label: '3Y' },
  { value: '260', label: '5Y' },
  { value: '9999', label: 'All' },
] as const

function MarketSection({ metal }: { metal: Metal }) {
  const market = UNIVERSE[metal].cotMarket as CotMarket
  const q = useCot(market)
  return (
    <section aria-label={`${UNIVERSE[metal].label} positioning`}>
      <h2 className="mb-3 text-[15px] font-medium text-foreground">{UNIVERSE[metal].label} · COMEX</h2>
      {q.isLoading ? (
        <PanelSkeleton rows={6} />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.latest ? (
        <Panel>
          <EmptyState title="No COT reports yet">Run a data refresh; the CFTC API needs no key.</EmptyState>
        </Panel>
      ) : (
        <MarketBody data={q.data} metal={metal} />
      )}
    </section>
  )
}

function MarketBody({ data, metal }: { data: CotResponse; metal: Metal }) {
  const l = data.latest!
  const mm = l.categories.find((c) => c.name === 'Managed money')
  const stance = cotStanceLabel(l.mmPercentile3y)
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel
        density="dense"
        title={
          <HelpTip term="Managed-money net, % of open interest">
            (Managed-money longs − shorts) ÷ total open interest. Shaded zones are this market’s 3-year 15th and 85th percentiles.
          </HelpTip>
        }
        provenance={data.provenance}
        actions={<Chip tone={stance.tone}>{stance.label}</Chip>}
      >
        <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat size="sm" label="MM net % OI" value={fmtPct(l.mmNetPctOi, 1)} />
          <Stat size="sm" label="3y percentile" value={l.mmPercentile3y != null ? fmtNum(l.mmPercentile3y * 100, 0) : '—'} />
          <Stat size="sm" label="3y z-score" value={fmtNum(l.mmZ3y, 2)} />
          <Stat size="sm" label="MM net Δ week" value={fmtSigned(mm?.changeNet, 0)} deltaValue={mm?.changeNet} />
        </div>
        <CotChart data={data} metal={metal} />
      </Panel>
      <Panel
        density="dense"
        title="Positions by trader category"
        eyebrow={`Report ${fmtDate(l.reportDate)} · released ${fmtDate(l.publishedAt)} (15:30 ET)`}
        provenance={{ source: data.provenance.source, asOf: l.reportDate }}
      >
        <CategoryTable rows={l.categories} />
        <p className="mt-2 text-2xs text-muted">
          Open interest <span className="num text-foreground">{fmtNum(l.openInterest, 0)}</span> contracts (
          <span className={`num ${signColor(l.changeOpenInterest)}`}>{fmtSigned(l.changeOpenInterest, 0)}</span> w/w).
        </p>
      </Panel>
    </div>
  )
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function CotChart({ data, metal }: { data: CotResponse; metal: Metal }) {
  const c = useChartColors()
  const [range, setRange] = useState<'156' | '260' | '9999'>('260')
  const hist = data.history.filter((h) => h.mmNetPctOi != null)
  const shown = useMemo(() => hist.slice(-Number(range)).map((h) => ({ date: h.reportDate, v: h.mmNetPctOi! * 100, pct: h.mmPercentile3y })), [hist, range])
  const band = useMemo(() => {
    const last3y = hist.slice(-156).map((h) => h.mmNetPctOi! * 100).sort((a, b) => a - b)
    return { p15: quantile(last3y, 0.15), p85: quantile(last3y, 0.85) }
  }, [hist])
  const lo = Math.min(...shown.map((s) => s.v), band.p15)
  const hi = Math.max(...shown.map((s) => s.v), band.p85)
  const pad = (hi - lo) * 0.08
  const axis = { stroke: c.axis, tick: { fill: c.text, fontSize: 10 }, tickLine: false, axisLine: false } as const
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-2xs text-muted">
        <span>
          Crowded ≥ <span className="num">{fmtNum(band.p85, 1)}%</span> · washed out ≤ <span className="num">{fmtNum(band.p15, 1)}%</span> (last 3y)
        </span>
        <Segmented ariaLabel="COT chart range" value={range} options={RANGES} onChange={setRange} />
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
          <LineChart data={shown} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <ReferenceArea y1={band.p85} y2={hi + pad} fill={c.bandCrowded} fillOpacity={0.08} ifOverflow="extendDomain" />
            <ReferenceArea y1={lo - pad} y2={band.p15} fill={c.bandWashed} fillOpacity={0.08} ifOverflow="extendDomain" />
            <ReferenceLine y={0} stroke={c.axis} />
            <XAxis dataKey="date" {...axis} tickFormatter={tickMonth} minTickGap={48} />
            <YAxis {...axis} width={40} domain={[lo - pad, hi + pad]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
            <Tooltip
              cursor={{ stroke: c.axis }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as { date: string; v: number; pct: number | null }
                return (
                  <div className="rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-2xs shadow-lg">
                    <div className="text-muted">{fmtDate(p.date)}</div>
                    <div className="num text-foreground">MM net {fmtNum(p.v, 1)}% of OI</div>
                    <div className="num text-muted">{p.pct != null ? `${fmtNum(p.pct * 100, 0)}th pct (3y)` : 'percentile n/a'}</div>
                  </div>
                )
              }}
            />
            <Line type="monotone" dataKey="v" stroke={metal === 'gold' ? c.gold : c.silver} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CategoryTable({ rows }: { rows: CotCategoryRow[] }) {
  const cols: Column<CotCategoryRow>[] = [
    { key: 'name', header: 'Category', cell: (r) => r.name },
    { key: 'long', header: 'Long', numeric: true, cell: (r) => fmtCompact(r.long) },
    { key: 'short', header: 'Short', numeric: true, cell: (r) => fmtCompact(r.short) },
    { key: 'net', header: 'Net', numeric: true, cell: (r) => <span className={signColor(r.net)}>{fmtSigned(r.net, 0)}</span> },
    { key: 'dnet', header: 'Δ net w/w', numeric: true, cell: (r) => <span className={signColor(r.changeNet)}>{fmtSigned(r.changeNet, 0)}</span> },
    { key: 'pct', header: '% OI', numeric: true, cell: (r) => fmtPctSigned(r.netPctOi, 1) },
  ]
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.name} dense caption="COT positions by trader category" />
}

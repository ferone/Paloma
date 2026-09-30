import { useMemo } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import clsx from 'clsx'
import type { CurveContract, CurveResponse, CurveShape } from '@shared/markets'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Chip, DataTable, EmptyState, ErrorBoundary, ErrorNote, Explainer, HelpTip, Panel, PanelSkeleton, Stat, type Column, type ChipTone } from '../../../ui'
import { fmtAge, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPctSigned, fmtSigned } from '../../../design/format'
import { signColor, CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useCurve, useCurveHistory } from '../hooks'
import { useChartTheme } from '../charts/chartTheme'
import { dateTick, rechartsStyle } from '../charts/recharts'

const SHAPE: Record<CurveShape, { label: string; tone: ChipTone }> = {
  contango: { label: 'Contango', tone: 'watch' },
  backwardation: { label: 'Backwardation', tone: 'avoid' },
  flat: { label: 'Flat', tone: 'neutral' },
  mixed: { label: 'Mixed', tone: 'moderate' },
  insufficient: { label: 'Insufficient data', tone: 'neutral' },
}

export default function CurvePage() {
  const { metal } = useSettings()
  const q = useCurve(metal)
  const product = UNIVERSE[metal].futures[0]

  if (q.isLoading) return <Panel><PanelSkeleton rows={8} /></Panel>
  if (q.error || !q.data) return <Panel><ErrorNote error={q.error ?? new Error('No curve')} onRetry={() => q.refetch()} /></Panel>
  const c = q.data

  if (c.contracts.length === 0) {
    return (
      <Panel provenance={c.provenance}>
        <EmptyState title="No listed contracts returned">Yahoo returned no quotes for the {product.name} contract months. Try again shortly.</EmptyState>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <CurveSummary curve={c} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ErrorBoundary>
          <CurveChart curve={c} />
        </ErrorBoundary>
        <ErrorBoundary>
          <CarryChart curve={c} />
        </ErrorBoundary>
      </div>
      <ContractsTable curve={c} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <ErrorBoundary>
          <CarryHistory />
        </ErrorBoundary>
        <CurveExplainer />
      </div>
    </div>
  )
}

function CurveSummary({ curve: c }: { curve: CurveResponse }) {
  const ref = c.contracts.find((x) => x.isReference)
  const shape = SHAPE[c.shape]
  return (
    <Panel density="dense" provenance={c.provenance}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
        <div>
          <div className="label">Curve shape</div>
          <div className="mt-1.5">
            <Chip tone={shape.tone}>{shape.label}</Chip>
          </div>
        </div>
        <Stat label="Reference contract" value={ref ? `${c.root} ${ref.label}` : '—'} hint={ref ? `Highest open interest · ${fmtNum(ref.price)}` : undefined} size="sm" />
        <Stat
          label={<HelpTip term="12M carry">Annualized (ACT/360) spread from the reference contract to the live contract nearest one year later.</HelpTip>}
          value={fmtPct(c.termCarry)}
          size="sm"
        />
        <Stat label="13-week T-bill" value={fmtPct(c.rate.value)} hint="^IRX discount yield" size="sm" />
        <Stat
          label={
            <HelpTip term="Carry − rate">
              Implied financing minus the T-bill rate. Negative means the curve pays less than cash: holders of physical metal earn the difference by
              lending it (an implied lease rate of roughly the same size, sign flipped).
            </HelpTip>
          }
          value={<span className={signColor(c.carryMinusRate)}>{fmtPctSigned(c.carryMinusRate)}</span>}
          size="sm"
        />
        <Stat label="Contracts" value={`${c.contracts.filter((x) => !x.stale).length} live`} hint={`${c.contracts.filter((x) => x.stale).length} stale (no trade in 4 days)`} size="sm" />
      </div>
    </Panel>
  )
}

function CurveChart({ curve: c }: { curve: CurveResponse }) {
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const color = c.metal === 'gold' ? t.gold : t.silver
  const data = c.contracts.filter((x) => x.daysToExpiry != null)
  const live = data.filter((x) => !x.stale)
  const stale = data.filter((x) => x.stale)
  const labelOf = useMemo(() => new Map(data.map((x) => [x.daysToExpiry, x.label])), [data])

  return (
    <Panel density="dense" title="Price by expiry" eyebrow={`COMEX ${c.root} · USD/oz`} provenance={{ source: 'Yahoo Finance listed contract months', asOf: c.provenance.asOf, note: 'Hollow points: stale (no recent trade)' }}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
          <ComposedChart margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid {...s.grid} />
            <XAxis
              type="number"
              dataKey="daysToExpiry"
              domain={['dataMin', 'dataMax']}
              ticks={data.map((x) => x.daysToExpiry as number)}
              tickFormatter={(d: number) => labelOf.get(d) ?? ''}
              tick={s.tick}
              axisLine={s.axisLine}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis dataKey="price" tick={s.tick} axisLine={false} tickLine={false} width={52} domain={['auto', 'auto']} tickFormatter={(v: number) => fmtNum(v, v >= 1000 ? 0 : 2)} />
            <Tooltip
              {...s.tooltip}
              labelFormatter={(d) => labelOf.get(Number(d)) ?? ''}
              formatter={(v, _n, item) => {
                const p = item?.payload as CurveContract | undefined
                return [`${fmtNum(Number(v))}${p?.stale ? ' (stale)' : ''}`, p ? `${c.root} ${p.label}` : 'Price']
              }}
            />
            <Line data={live} dataKey="price" type="linear" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color, stroke: color }} isAnimationActive={false} />
            <Scatter data={stale} dataKey="price" fill={t.surface} stroke={t.faint} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

function CarryChart({ curve: c }: { curve: CurveResponse }) {
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const data = c.contracts.filter((x) => x.carry != null).map((x) => ({ ...x, carryPct: (x.carry as number) * 100 }))
  const rate = c.rate.value != null ? c.rate.value * 100 : null

  return (
    <Panel
      density="dense"
      title="Annualized carry vs reference"
      eyebrow="Implied financing rate · ACT/360"
      provenance={{ source: 'Derived from Yahoo contract prices · rate: ^IRX', asOf: c.provenance.asOf }}
    >
      {data.length === 0 ? (
        <EmptyState compact title="Not enough live contracts">Carry needs at least two traded contract months.</EmptyState>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
            <ComposedChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid {...s.grid} />
              <XAxis dataKey="label" tick={s.tick} axisLine={s.axisLine} tickLine={false} interval={0} />
              <YAxis tick={s.tick} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${fmtNum(v, 1)}%`} />
              <Tooltip
                {...s.tooltip}
                cursor={{ fill: t.alpha(t.faint, 0.12) }}
                formatter={(v, _n, item) => {
                  const p = item?.payload as CurveContract | undefined
                  return [`${fmtNum(Number(v), 2)}%${p?.stale ? ' (stale)' : ''}`, 'Carry']
                }}
              />
              {rate != null && (
                <ReferenceLine y={rate} stroke={t.brand} strokeDasharray="4 3" label={{ value: `T-bill ${fmtNum(rate, 2)}%`, position: 'insideTopRight', fill: t.muted, fontSize: 10 }} />
              )}
              <ReferenceLine y={0} stroke={t.border} />
              <Bar dataKey="carryPct" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {data.map((x) => (
                  // Neutral ink bars; the T-bill line is the only accent. Stale months are outlines.
                  <Cell key={x.symbol} fill={x.stale ? 'transparent' : t.alpha(t.muted, 0.5)} stroke={x.stale ? t.faint : 'none'} strokeDasharray={x.stale ? '3 2' : undefined} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

function ContractsTable({ curve: c }: { curve: CurveResponse }) {
  const cols: Column<CurveContract>[] = [
    {
      key: 'label',
      header: 'Contract',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="num font-medium text-foreground">{c.root} {r.label}</span>
          {r.isReference && <Chip tone="brand">Ref</Chip>}
          {r.stale && <Chip tone="neutral" title="No trade in the last 4 days">Stale</Chip>}
        </span>
      ),
      sortValue: (r) => r.daysToExpiry ?? 0,
    },
    { key: 'expiry', header: 'Expiry', cell: (r) => <span className="num text-muted">{fmtDate(r.expiry)}</span>, sortValue: (r) => r.expiry ?? '' },
    { key: 'days', header: 'Days', numeric: true, cell: (r) => fmtNum(r.daysToExpiry, 0), sortValue: (r) => r.daysToExpiry },
    { key: 'price', header: 'Last', numeric: true, cell: (r) => fmtNum(r.price), sortValue: (r) => r.price },
    { key: 'chg', header: 'Chg', numeric: true, cell: (r) => <span className={signColor(r.change)}>{fmtSigned(r.change)}</span>, sortValue: (r) => r.change },
    { key: 'spread', header: 'Spread vs ref', numeric: true, cell: (r) => (r.isReference ? '—' : fmtSigned(r.spread)), sortValue: (r) => r.spread },
    { key: 'carry', header: 'Carry (ann.)', numeric: true, cell: (r) => <span className={clsx(r.stale && 'text-muted')}>{fmtPct(r.carry)}</span>, sortValue: (r) => r.carry },
    { key: 'oi', header: 'Open int.', numeric: true, cell: (r) => fmtCompact(r.openInterest), sortValue: (r) => r.openInterest },
    { key: 'vol', header: 'Volume', numeric: true, cell: (r) => fmtCompact(r.volume), sortValue: (r) => r.volume },
    { key: 'trade', header: 'Last trade', numeric: true, cell: (r) => <span className="text-muted">{fmtAge(r.lastTrade)}</span>, sortValue: (r) => r.lastTrade },
  ]
  return (
    <Panel density="dense" title="Listed contract months" provenance={c.provenance}>
      <DataTable columns={cols} rows={c.contracts} rowKey={(r) => r.symbol} dense initialSort={{ key: 'label', dir: 'asc' }} caption="Futures curve contracts" />
    </Panel>
  )
}

function CarryHistory() {
  const { metal } = useSettings()
  const q = useCurveHistory(metal)
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const pts = (q.data?.points ?? []).map((p) => ({
    date: p.date,
    carry: p.termCarry != null ? p.termCarry * 100 : null,
    rate: p.rate != null ? p.rate * 100 : null,
  }))

  return (
    <Panel density="dense" title="12M carry vs T-bill, recorded" provenance={q.data?.provenance ?? { source: 'Local curve snapshots' }}>
      {q.isLoading ? (
        <PanelSkeleton rows={3} />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : pts.length < 2 ? (
        <EmptyState compact title="History is still being recorded">
          One snapshot is stored per day the curve is loaded{pts[0] ? ` (first: ${fmtDate(pts[0].date)})` : ''}. The chart appears from the second day.
        </EmptyState>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
            <LineChart data={pts} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid {...s.grid} />
              <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(false)} minTickGap={30} />
              <YAxis tick={s.tick} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => `${fmtNum(v, 1)}%`} />
              <Tooltip {...s.tooltip} labelFormatter={(d) => fmtDate(String(d))} formatter={(v, n) => [`${fmtNum(Number(v), 2)}%`, n === 'carry' ? '12M carry' : 'T-bill']} />
              <Line dataKey="carry" stroke={t.series[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="rate" stroke={t.brand} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

function CurveExplainer() {
  return (
    <Explainer title="How to read the term structure">
      <p>
        Each point is a listed COMEX contract month. The <strong>reference</strong> is the month with the highest open interest (the one the market
        actually trades); spreads and carry are measured from it. The delivery month just before it is thin and often distorted by delivery flows.
      </p>
      <p>
        <strong>Carry</strong> is the simple annualized premium of a later month over the reference, (F<sub>far</sub> / F<sub>ref</sub> − 1) × 360 /
        days — the financing rate the curve implies. In normal <strong>contango</strong> it tracks short-term interest rates; when carry falls well
        below T-bills, metal is scarce to borrow (positive lease rates), and <strong>backwardation</strong> signals an acute physical squeeze.
      </p>
      <p>
        Deferred months trade rarely. A contract with no trade in four days is marked <strong>stale</strong>: its last price may be far from where it
        would trade today, so it is excluded from the shape and 12M-carry calculations.
      </p>
    </Explainer>
  )
}

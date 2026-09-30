import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useMemo, useState, type CSSProperties } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BetaRow, CorrelationFactor, CorrelationResponse } from '@shared/macro'
import { UNIVERSE, isAssetId } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { DataTable, EmptyState, ErrorNote, Explainer, Panel, PanelSkeleton, Segmented, type Column } from '../../../ui'
import { fmtDate, fmtNum, fmtSigned } from '../../../design/format'
import { useCorrelations } from '../api'
import { thin, tickMonth, useChartColors } from '../lib'

const WINDOWS = [
  { value: '63', label: '63d (3m)' },
  { value: '252', label: '252d (1y)' },
] as const

/** Fixed colour per factor (colour follows the entity, never its rank): assets use their own colour. */
function factorColor(c: ReturnType<typeof useChartColors>, f: CorrelationFactor): string {
  if (isAssetId(f)) return c.asset[f]
  return { realYield: c.series[1], dxy: c.series[3], vix: c.series[4], spy: c.series[2] }[f]
}

export default function CorrelationsPage() {
  const { asset } = useSettings()
  const [win, setWin] = useState<'63' | '252'>('63')
  const q = useCorrelations(asset, Number(win))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Correlation of {UNIVERSE[asset].label.toLowerCase()}’s daily returns with each driver’s daily change, over a rolling window. Negative
          values mean they tend to move in opposite directions (the textbook sign for real yields and the dollar).
        </p>
        <Segmented ariaLabel="Correlation window" value={win} options={WINDOWS} onChange={setWin} size="md" />
      </div>
      {q.isLoading ? (
        <PanelSkeleton rows={8} />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.rolling.length === 0 ? (
        <Panel>
          <EmptyState title="Not enough overlapping history">
            Correlations need Yahoo prices ({UNIVERSE[asset].spot}, its peers, DX-Y.NYB, SPY) and FRED DFII10/VIXCLS. Run a data refresh.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <RollingPanel data={q.data} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <MatrixPanel data={q.data} />
            <BetaPanel data={q.data} />
          </div>
          <Explainer title="Method">
            <p>
              Series are aligned on dates common to all of them before differencing, so every observation spans the same interval. Asset prices,
              the dollar and SPY use daily log returns; the real yield uses the daily change in percentage points and VIX the daily change in index points.
            </p>
            <p>
              Beta is the least-squares slope of the asset’s daily return on the driver’s daily change: e.g. a real-yield beta of −0.10 means a
              +0.10pp day in real yields has come with about a −1% day in the asset over the window. Correlations are unstable; treat a single
              window as a description of the recent past, not a forecast.
            </p>
          </Explainer>
        </>
      )}
    </div>
  )
}

function RollingPanel({ data }: { data: CorrelationResponse }) {
  const c = useChartColors()
  const others = data.factors.filter((f) => f.id !== data.asset)
  const rows = useMemo(() => thin(data.rolling.map((r) => ({ date: r.date, ...r.values })), 400), [data.rolling])
  const axis = { stroke: c.axis, tick: { fill: c.text, fontSize: 10 }, tickLine: false, axisLine: false } as const
  return (
    <Panel title={`Rolling ${data.window}-day correlation with ${UNIVERSE[data.asset].label.toLowerCase()}`} density="dense" provenance={data.provenance}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <ReferenceLine y={0} stroke={c.axis} />
            <XAxis dataKey="date" {...axis} tickFormatter={tickMonth} minTickGap={48} />
            <YAxis {...axis} width={36} domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} tickFormatter={(v: number) => v.toFixed(1)} />
            <Tooltip
              cursor={{ stroke: c.axis }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-2xs shadow-lg">
                    <div className="mb-1 text-muted">{fmtDate(String(label))}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-muted">
                          <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: p.color }} />
                          {others.find((o) => o.id === p.dataKey)?.label}
                        </span>
                        <span className="num text-foreground">{fmtSigned(p.value as number, 2)}</span>
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            <Legend
              verticalAlign="top"
              height={24}
              iconType="plainline"
              formatter={(value: string) => <span style={{ color: c.text, fontSize: 11 }}>{others.find((o) => o.id === value)?.label ?? value}</span>}
            />
            {others.map((f) => (
              <Line key={f.id} type="monotone" dataKey={f.id} stroke={factorColor(c, f.id)} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  )
}

/** Diverging fill: blue for positive, warm for negative, transparent (neutral) at zero. */
function cellStyle(v: number | null): CSSProperties {
  if (v == null) return {}
  const pct = Math.round(Math.min(1, Math.abs(v)) * 60)
  return { background: `color-mix(in oklch, var(${v >= 0 ? '--series-2' : '--series-4'}) ${pct}%, transparent)` }
}

function MatrixPanel({ data }: { data: CorrelationResponse }) {
  const label = (id: CorrelationFactor) => data.factors.find((f) => f.id === id)?.label ?? id
  return (
    <Panel title={`Correlation matrix · last ${data.window} days`} density="dense" provenance={{ source: data.provenance.source, asOf: data.asOf }}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">Pairwise correlations of daily changes</caption>
          <thead>
            <tr>
              <th scope="col" />
              {data.matrix.factors.map((f) => (
                <th key={f} scope="col" className="label px-1 pb-1 text-center font-medium">
                  {label(f)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.factors.map((row, i) => (
              <tr key={row}>
                <th scope="row" className="label whitespace-nowrap pr-2 text-left font-medium">
                  {label(row)}
                </th>
                {data.matrix.values[i].map((v, j) => (
                  <td
                    key={j}
                    className="num rounded-[3px] px-1 py-2 text-center text-foreground"
                    style={i === j ? undefined : cellStyle(v)}
                    title={`${label(row)} × ${label(data.matrix.factors[j])}: ${fmtNum(v, 2)}`}
                  >
                    {i === j ? <span className="text-faint">—</span> : fmtNum(v, 2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-2xs text-muted" aria-hidden>
        <span>−1</span>
        <span className="h-2 flex-1 rounded" style={{ background: 'linear-gradient(90deg, color-mix(in oklch, var(--series-4) 60%, transparent), transparent, color-mix(in oklch, var(--series-2) 60%, transparent))' }} />
        <span>+1</span>
      </div>
    </Panel>
  )
}

function BetaPanel({ data }: { data: CorrelationResponse }) {
  const label = (id: CorrelationFactor) => data.factors.find((f) => f.id === id)
  const cols: Column<BetaRow>[] = [
    {
      key: 'f',
      header: 'Driver',
      cell: (r) => (
        <div>
          <div>{label(r.factor)?.label}</div>
          <div className="text-2xs text-muted">{label(r.factor)?.transform}</div>
        </div>
      ),
    },
    { key: 'corr', header: 'Corr', numeric: true, cell: (r) => fmtSigned(r.correlation, 2), sortValue: (r) => r.correlation },
    { key: 'beta', header: 'Beta', numeric: true, cell: (r) => fmtSigned(r.beta, 3), sortValue: (r) => r.beta },
    { key: 'n', header: 'Obs', numeric: true, cell: (r) => fmtNum(r.n, 0) },
  ]
  return (
    <Panel title={`Betas of ${UNIVERSE[data.asset].label.toLowerCase()} · last ${data.window} days`} density="dense" provenance={{ source: 'OLS on daily changes', asOf: data.asOf }}>
      <DataTable columns={cols} rows={data.betas} rowKey={(r) => r.factor} dense caption="Betas and correlations" />
    </Panel>
  )
}

import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesPoint, SeriesUnit } from '@shared/macro'
import { fmtDate } from '../../../design/format'
import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { fmtLevel, thin, tickMonth, useChartColors } from '../lib'

/** Shared sync group: every chart in the drivers section follows one crosshair, matched by date. */
const SYNC_ID = 'macro-drivers'

const axisTick = (c: ReturnType<typeof useChartColors>) =>
  ({ stroke: c.axis, tick: { fill: c.text, fontSize: 10 }, tickLine: false, axisLine: false }) as const

function SingleTooltip({ label, unit }: { label: string; unit: SeriesUnit }) {
  return (
    <Tooltip
      cursor={{ strokeWidth: 1 }}
      content={({ active, payload }) => {
        if (!active || !payload?.length) return null
        const p = payload[0].payload as { date: string; v: number }
        return (
          <div className="rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-2xs shadow-lg">
            <div className="mb-1 text-muted">{fmtDate(p.date)}</div>
            <div className="num text-foreground">
              {label} {fmtLevel(p.v, unit)}
            </div>
          </div>
        )
      }}
    />
  )
}

/** The metal's price, drawn once at the top of the drivers section. */
export function MetalPriceChart({ label, color, points }: { label: string; color: 'gold' | 'silver'; points: SeriesPoint[] }) {
  const c = useChartColors()
  const data = useMemo(() => thin(points, 480).map((p) => ({ date: p.date, v: p.value })), [points])
  if (data.length < 2) return <p className="py-10 text-center text-xs text-muted">Not enough price history.</p>
  const stroke = color === 'gold' ? c.gold : c.silver
  return (
    <div className="h-[168px]">
      <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
        <LineChart data={data} syncId={SYNC_ID} syncMethod="value" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" {...axisTick(c)} tickFormatter={tickMonth} minTickGap={60} />
          <YAxis {...axisTick(c)} width={48} domain={['auto', 'auto']} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))} />
          <SingleTooltip label={`${label} $/oz`} unit="usd" />
          <Line type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** One macro driver on its own honest scale, crosshair-synced with the price chart. */
export function DriverChart({ label, unit, points }: { label: string; unit: SeriesUnit; points: SeriesPoint[] }) {
  const c = useChartColors()
  const data = useMemo(() => thin(points, 320).map((p) => ({ date: p.date, v: p.value })), [points])
  if (data.length < 2) return <p className="py-10 text-center text-xs text-muted">Not enough data.</p>
  return (
    <div className="h-[120px]">
      <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
        <LineChart data={data} syncId={SYNC_ID} syncMethod="value" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" {...axisTick(c)} tickFormatter={tickMonth} minTickGap={48} />
          <YAxis {...axisTick(c)} width={40} domain={['auto', 'auto']} tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} />
          <SingleTooltip label={label} unit={unit} />
          <Line type="monotone" dataKey="v" stroke={c.series[1]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

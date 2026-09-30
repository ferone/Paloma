import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesPoint, SeriesUnit } from '@shared/macro'
import { fmtDate } from '../../../design/format'
import { fmtLevel, joinForwardFill, thin, tickMonth, useChartColors } from '../lib'

interface PairChartProps {
  id: string
  metalLabel: string
  metalColor: 'gold' | 'silver'
  metal: SeriesPoint[]
  driverLabel: string
  driverUnit: SeriesUnit
  driver: SeriesPoint[]
}

/**
 * Metal price and one macro driver as two stacked single-axis panels sharing
 * the time axis and a synced crosshair (no dual y-axis: each scale is honest).
 */
export function PairChart({ id, metalLabel, metalColor, metal, driverLabel, driverUnit, driver }: PairChartProps) {
  const c = useChartColors()
  const data = useMemo(() => thin(joinForwardFill(metal, driver), 320), [metal, driver])
  if (data.length < 2) return <p className="py-10 text-center text-xs text-muted">Not enough overlapping data.</p>

  const axisProps = {
    stroke: c.axis,
    tick: { fill: c.text, fontSize: 10 },
    tickLine: false,
    axisLine: false,
  } as const
  const tooltip = (
    <Tooltip
      cursor={{ stroke: c.axis, strokeWidth: 1 }}
      content={({ active, payload }) => {
        if (!active || !payload?.length) return null
        const p = payload[0].payload as { date: string; a: number; b: number }
        return (
          <div className="rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-2xs shadow-lg">
            <div className="mb-1 text-muted">{fmtDate(p.date)}</div>
            <div className="num text-foreground">
              {metalLabel} {fmtLevel(p.a, 'usd')}
            </div>
            <div className="num text-foreground">
              {driverLabel} {fmtLevel(p.b, driverUnit)}
            </div>
          </div>
        )
      }}
    />
  )

  return (
    <div>
      <div className="label mb-0.5 flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: metalColor === 'gold' ? c.gold : c.silver }} />
        {metalLabel}, $/oz
      </div>
      <div className="h-[104px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId={id} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))} />
            {tooltip}
            <Line type="monotone" dataKey="a" stroke={metalColor === 'gold' ? c.gold : c.silver} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="label mb-0.5 mt-2 flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: c.series[1] }} />
        {driverLabel}
      </div>
      <div className="h-[92px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId={id} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={tickMonth} minTickGap={40} />
            <YAxis {...axisProps} width={44} domain={['auto', 'auto']} tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} />
            {tooltip}
            <Line type="monotone" dataKey="b" stroke={c.series[1]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

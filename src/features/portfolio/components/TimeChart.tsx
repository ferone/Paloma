import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate } from '../../../design/format'
import { useChartColors } from './useChartColors'

export interface Series {
  key: string
  label: string
  /** Key into useChartColors(). */
  color: 'brand' | 'muted' | 'series2' | 'series3' | 'neg'
  dashed?: boolean
}

interface TimeChartProps<T extends { date: string }> {
  data: T[]
  series: Series[]
  format: (v: number) => string
  height?: number
  kind?: 'line' | 'area'
  /** Horizontal reference value (e.g. 100 for a rebased index, 0 for drawdown). */
  reference?: number
  ariaLabel: string
}

function yearTick(d: string) {
  return d.slice(0, 7) === `${d.slice(0, 4)}-01` ? d.slice(0, 4) : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`
}

/**
 * Single-axis daily time series (recharts) with crosshair tooltip. Colours are
 * resolved CSS tokens (re-resolved on theme change); lines are 2px, grid recessive.
 */
export function TimeChart<T extends { date: string }>({ data, series, format, height = 280, kind = 'line', reference, ariaLabel }: TimeChartProps<T>) {
  const c = useChartColors()
  const axis = { stroke: c.border, tick: { fill: c.muted, fontSize: 11 }, tickLine: false }
  const tooltip = (
    <Tooltip
      cursor={{ stroke: c.faint, strokeWidth: 1 }}
      contentStyle={{ background: c.surface3, border: `1px solid ${c.border}`, borderRadius: 6, fontSize: 12, color: c.foreground }}
      labelStyle={{ color: c.muted, marginBottom: 4 }}
      labelFormatter={(d) => fmtDate(String(d))}
      formatter={(v, name) => [typeof v === 'number' ? format(v) : '—', series.find((s) => s.key === name)?.label ?? String(name)]}
    />
  )
  const common = (
    <>
      <CartesianGrid vertical={false} stroke={c.border} strokeOpacity={0.6} />
      <XAxis dataKey="date" {...axis} minTickGap={48} tickFormatter={yearTick} />
      <YAxis {...axis} width={64} axisLine={false} tickFormatter={(v: number) => format(v)} domain={['auto', 'auto']} />
      {reference != null && <ReferenceLine y={reference} stroke={c.faint} strokeDasharray="3 3" />}
      {tooltip}
    </>
  )
  return (
    <div role="img" aria-label={ariaLabel}>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="0" y1="3" x2="16" y2="3" style={{ stroke: c[s.color], strokeWidth: 2, strokeDasharray: s.dashed ? '4 3' : undefined }} />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <ResponsiveContainer width="100%" height={height} initialDimension={CHART_INITIAL_SIZE}>
        {kind === 'area' ? (
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {common}
            {series.map((s) => (
              <Area key={s.key} type="monotone" dataKey={s.key} stroke={c[s.color]} strokeWidth={1.5} fill={c[s.color]} fillOpacity={0.18} isAnimationActive={false} dot={false} />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {common}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={c[s.color]}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '4 3' : undefined}
                dot={false}
                activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

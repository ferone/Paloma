import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useId, useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { UNIVERSE } from '@shared/universe'
import { ErrorNote, HelpTip, Panel, Skeleton, Stat } from '../../../ui'
import { fmtDate, fmtNum, fmtPct } from '../../../design/format'
import { useHistory, useQuote } from '../hooks'
import { percentileRank, ratioSeries } from '../lib/series'
import { useChartTheme } from '../charts/chartTheme'
import { dateTick, rechartsStyle } from '../charts/recharts'

/** Gold/silver ratio: live value, 5Y weekly history, percentile and range. */
export function RatioPanel() {
  const gold = useQuote(UNIVERSE.gold.spot)
  const silver = useQuote(UNIVERSE.silver.spot)
  const gh = useHistory(UNIVERSE.gold.spot, '5Y')
  const sh = useHistory(UNIVERSE.silver.spot, '5Y')
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const gid = useId().replace(/:/g, '')

  const series = useMemo(() => (gh.data && sh.data ? ratioSeries(gh.data, sh.data) : []), [gh.data, sh.data])
  const live = gold.data && silver.data && silver.data.price > 0 ? gold.data.price / silver.data.price : null
  const current = live ?? series.at(-1)?.value ?? null
  const values = series.map((p) => p.value)
  const pct = current != null ? percentileRank(values, current) : null
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  const lo = values.length ? Math.min(...values) : null
  const hi = values.length ? Math.max(...values) : null
  const loading = gh.isLoading || sh.isLoading
  const error = gh.error ?? sh.error

  return (
    <Panel
      density="dense"
      title={
        <HelpTip term="Gold/silver ratio">
          Ounces of silver one ounce of gold buys (GC=F ÷ SI=F). A high ratio means silver is cheap relative to gold; the fund uses it for relative-value
          switches between the metals.
        </HelpTip>
      }
      provenance={{ source: 'Yahoo Finance · GC=F ÷ SI=F, weekly closes (5Y); live value from front futures', asOf: series.at(-1)?.date ?? null }}
    >
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Now" value={fmtNum(current, 1)} size="md" />
        <Stat label="5Y average" value={fmtNum(avg, 1)} size="sm" />
        <Stat label="5Y percentile" value={fmtPct(pct, 0)} size="sm" hint="Share of weeks below today" />
        <Stat label="5Y range" value={`${fmtNum(lo, 1)}–${fmtNum(hi, 1)}`} size="sm" />
      </div>
      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
            <AreaChart data={series} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.silver} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={t.silver} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...s.grid} />
              <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(true)} minTickGap={40} />
              <YAxis tick={s.tick} axisLine={false} tickLine={false} width={32} domain={['auto', 'auto']} tickFormatter={(v: number) => fmtNum(v, 0)} />
              {avg != null && <ReferenceLine y={avg} stroke={t.faint} strokeDasharray="3 3" />}
              <Tooltip
                {...s.tooltip}
                labelFormatter={(d) => fmtDate(String(d))}
                formatter={(v) => [fmtNum(Number(v), 1), 'Ratio']}
              />
              <Area type="monotone" dataKey="value" stroke={t.silver} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

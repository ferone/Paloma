import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useId, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { UNIVERSE, type PriceUnit, type RelativeValuePair } from '@shared/universe'
import { ErrorNote, HelpTip, Panel, Segmented, Skeleton, Stat } from '../../../ui'
import { fmtDate, fmtPct, fmtRatio } from '../../../design/format'
import { useHistory, useQuote } from '../hooks'
import { percentileRank, ratioSeries } from '../lib/series'
import { useChartTheme } from '../charts/chartTheme'
import { dateTick, rechartsStyle } from '../charts/recharts'

const UNIT_WORD: Record<PriceUnit, string> = { oz: 'Ounce', lb: 'Pound', BTC: 'Bitcoin' }

/** Relative-value ratio (numerator ÷ denominator reference prices): live value, full daily history (or 5Y weekly), percentile and range. */
export function RatioPanel({ pair }: { pair: RelativeValuePair }) {
  const num = UNIVERSE[pair.numerator]
  const den = UNIVERSE[pair.denominator]
  const numQ = useQuote(num.spot)
  const denQ = useQuote(den.spot)
  const [range, setRange] = useState<'5Y' | 'MAX'>('MAX')
  const gh = useHistory(num.spot, range)
  const sh = useHistory(den.spot, range)
  const t = useChartTheme()
  // The numerator names the ratio (gold/silver, bitcoin/gold), so it carries the colour.
  const color = t.asset[pair.numerator]
  const s = rechartsStyle(t)
  const gid = useId().replace(/:/g, '')

  const series = useMemo(() => (gh.data && sh.data ? ratioSeries(gh.data, sh.data) : []), [gh.data, sh.data])
  // Statistics use every day; the chart thins long daily history to about weekly points.
  const plotted = useMemo(() => (series.length > 1500 ? series.filter((_, i) => i % 5 === 0 || i === series.length - 1) : series), [series])
  const span = range === 'MAX' && series.length ? `since ${series[0].date.slice(0, 4)}` : '5Y'
  const spanLabel = range === 'MAX' ? 'Full-history' : '5Y'
  const live = numQ.data && denQ.data && denQ.data.price > 0 ? numQ.data.price / denQ.data.price : null
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
        <HelpTip term={`${num.label}/${den.label.toLowerCase()} ratio`}>
          {num.priceUnit === den.priceUnit
            ? `${UNIT_WORD[den.priceUnit]}s of ${den.label.toLowerCase()} one ${UNIT_WORD[num.priceUnit].toLowerCase()} of ${num.label.toLowerCase()} buys`
            : `${num.label} price (${num.unitLabel}) divided by ${den.label.toLowerCase()} price (${den.unitLabel})`}{' '}
          ({num.spot} ÷ {den.spot}). A high ratio means {den.label.toLowerCase()} is cheap relative to {num.label.toLowerCase()}; the fund uses it for
          relative-value switches between the two.
        </HelpTip>
      }
      actions={
        <Segmented<'5Y' | 'MAX'> ariaLabel="Ratio history" value={range} onChange={setRange} options={[{ value: '5Y', label: '5Y' }, { value: 'MAX', label: 'Max' }]} />
      }
      provenance={{
        source: `Yahoo Finance · ${num.spot} ÷ ${den.spot}, ${range === 'MAX' ? `daily closes ${span}` : 'weekly closes (5Y)'}; live value from the reference quotes`,
        asOf: series.at(-1)?.date ?? null,
      }}
    >
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Now" value={fmtRatio(current)} size="md" />
        <Stat label={`${spanLabel} average`} value={fmtRatio(avg)} size="sm" />
        <Stat label={`${spanLabel} percentile`} value={fmtPct(pct, 0)} size="sm" hint={range === 'MAX' ? `Share of days ${span} below today` : 'Share of weeks below today'} />
        <Stat label={`${spanLabel} range`} value={`${fmtRatio(lo)}–${fmtRatio(hi)}`} size="sm" />
      </div>
      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
            <AreaChart data={plotted} margin={{ left: 0, right: 22, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...s.grid} />
              <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(true)} minTickGap={40} />
              <YAxis tick={s.tick} axisLine={false} tickLine={false} width={yAxisWidth(lo, hi)} domain={['auto', 'auto']} tickFormatter={(v: number) => fmtRatio(v, 0)} />
              {avg != null && <ReferenceLine y={avg} stroke={t.faint} strokeDasharray="3 3" />}
              <Tooltip
                {...s.tooltip}
                labelFormatter={(d) => fmtDate(String(d))}
                formatter={(v) => [fmtRatio(Number(v)), 'Ratio']}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

/** Y-axis width that fits the longest tick label (small ratios like 0.00135 need more room). */
function yAxisWidth(lo: number | null | undefined, hi: number | null | undefined): number {
  const longest = Math.max(fmtRatio(lo ?? 0, 0).length, fmtRatio(hi ?? 0, 0).length)
  return Math.min(68, Math.max(36, longest * 7 + 10))
}

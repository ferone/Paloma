import { useMemo } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { OHLCV } from '@shared/markets'
import { ASSETS, UNIVERSE, type AssetId } from '@shared/universe'
import { ErrorNote, Panel, PanelSkeleton } from '../../../ui'
import { fmtNum } from '../../../design/format'
import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useHistories } from '../../markets/hooks'
import { useChartTheme } from '../../markets/charts/chartTheme'
import { dateTick, rechartsStyle } from '../../markets/charts/recharts'

const FROM = '2010-06-01'

/** Each asset's long-history reference: its benchmark ETF, or the spot for assets whose ETFs are recent (bitcoin). */
function referenceSymbol(a: AssetId): string {
  return UNIVERSE[a].assetClass === 'crypto' ? (UNIVERSE[a].displaySpot ?? UNIVERSE[a].benchmarkEtf) : UNIVERSE[a].benchmarkEtf
}

type Row = { date: string } & Record<string, number | string>

/**
 * Growth of $1 since mid-2010 (or each series' own start) for every asset's
 * reference and the S&P 500 — long-run context for the fund's own record, which
 * starts at inception. Log scale, so bitcoin's multiples don't flatten the rest.
 */
export function LongRunPanel() {
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const series = useMemo(() => [...ASSETS.map((a) => ({ key: referenceSymbol(a), label: `${UNIVERSE[a].label} (${referenceSymbol(a)})`, color: t.asset[a] })), { key: 'SPY', label: 'S&P 500 (SPY)', color: t.muted }], [t])
  const qs = useHistories(
    series.map((x) => x.key),
    'MAX',
  )
  const loading = qs.some((q) => q.isLoading)
  const error = qs.find((q) => q.error)?.error
  const dataKey = qs.map((q) => q.dataUpdatedAt).join(',')

  const { rows, starts } = useMemo(() => {
    const byDate = new Map<string, Row>()
    const starts: Record<string, string> = {}
    series.forEach((x, i) => {
      const bars = ((qs[i]?.data ?? []) as OHLCV[]).filter((b) => b.close > 0 && b.date.slice(0, 10) >= FROM)
      if (!bars.length) return
      const base = bars[0].close
      starts[x.key] = bars[0].date.slice(0, 10)
      // About weekly points: every 5th bar plus the last.
      bars.forEach((b, j) => {
        if (j % 5 !== 0 && j !== bars.length - 1) return
        const d = b.date.slice(0, 10)
        const row = byDate.get(d) ?? ({ date: d } as Row)
        row[x.key] = b.close / base
        byDate.set(d, row)
      })
    })
    return { rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), starts }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when any series updates
  }, [series, dataKey])

  const last = (key: string) => {
    for (let i = rows.length - 1; i >= 0; i--) if (typeof rows[i][key] === 'number') return rows[i][key] as number
    return null
  }

  return (
    <Panel
      title="Long-run context"
      eyebrow="Growth of $1 since 2010 (or each series' first close), log scale"
      provenance={{ source: 'Yahoo Finance daily closes stored locally', asOf: rows.at(-1)?.date ?? null, note: 'Reference instruments, not the fund — the fund’s record starts at inception' }}
    >
      {loading ? (
        <PanelSkeleton rows={6} />
      ) : error ? (
        <ErrorNote error={error} />
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
              <LineChart data={rows} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
                <CartesianGrid {...s.grid} />
                <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(true)} minTickGap={48} />
                <YAxis scale="log" domain={['auto', 'auto']} allowDataOverflow tick={s.tick} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${fmtNum(v, v < 10 ? 1 : 0)}×`} />
                <Tooltip {...s.tooltip} formatter={(v, name) => [`${fmtNum(Number(v), 2)}×`, String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {series.map((x) => (
                  <Line key={x.key} dataKey={x.key} name={x.label} stroke={x.color} dot={false} strokeWidth={1.4} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-2xs text-muted sm:grid-cols-2 xl:grid-cols-4">
            {series.map((x) => (
              <li key={x.key} className="flex justify-between gap-2">
                <span>{x.label}</span>
                <span className="num text-foreground">
                  {last(x.key) != null ? `${fmtNum(last(x.key), 2)}×` : '—'}
                  {starts[x.key] && starts[x.key] > FROM ? <span className="text-faint"> since {starts[x.key].slice(0, 4)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

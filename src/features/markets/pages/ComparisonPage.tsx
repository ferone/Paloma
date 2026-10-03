import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import clsx from 'clsx'
import type { OHLCV, TimeRange } from '@shared/markets'
import { ASSETS, MACRO_SYMBOLS, RELATIVE_VALUE_PAIRS, UNIVERSE } from '@shared/universe'
import { DataTable, EmptyState, ErrorBoundary, Explainer, Panel, Segmented, Skeleton, type Column } from '../../../ui'
import { fmtDate, fmtNum, fmtPctSigned } from '../../../design/format'
import { signColor, CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useHistories } from '../hooks'
import { PERIODS, periodReturns, rebase, returnCorrelation, type Period } from '../lib/series'
import { MACRO_COMPARISON, assetInstruments, seriesColor, shortSymbol, symbolLabel } from '../lib/symbols'
import { useChartTheme } from '../charts/chartTheme'
import { dateTick, rechartsStyle } from '../charts/recharts'

// Default: the first relative-value pair's reference quotes and benchmark ETFs, plus SPY and the dollar
// (gold/silver: GC=F, SI=F, GLD, SLV, SPY, DXY).
const DEFAULT_PAIR = RELATIVE_VALUE_PAIRS[0]
const DEFAULT_ASSETS = DEFAULT_PAIR ? [UNIVERSE[DEFAULT_PAIR.numerator], UNIVERSE[DEFAULT_PAIR.denominator]] : [UNIVERSE[ASSETS[0]]]
const DEFAULT = [...DEFAULT_ASSETS.map((u) => u.spot), ...DEFAULT_ASSETS.map((u) => u.benchmarkEtf), 'SPY', MACRO_SYMBOLS.dxy]
const RANGES = ['1M', '3M', '6M', '1Y', '5Y', 'MAX'] as const satisfies readonly TimeRange[]
const GROUPS = [
  ...ASSETS.map((a) => ({ label: UNIVERSE[a].label, symbols: assetInstruments(a) })),
  { label: 'Macro', symbols: [...MACRO_COMPARISON] },
]
// Assets whose reference series is a front future (their returns include the roll).
const FUTURE_SPOTS = ASSETS.filter((a) => UNIVERSE[a].futures.some((f) => f.yahoo === UNIVERSE[a].spot))

export default function ComparisonPage() {
  const [selected, setSelected] = useState<string[]>(DEFAULT)
  const toggle = (s: string) => setSelected((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))

  return (
    <div className="space-y-4">
      <Panel density="dense" title="Instruments" provenance={{ source: 'Yahoo Finance · spot proxies are front futures where the asset has them' }}>
        <div className="grid gap-3 md:grid-cols-3 2xl:grid-cols-4">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="label mb-1.5">{g.label}</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${g.label} instruments`}>
                {g.symbols.map((s) => {
                  const on = selected.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      title={symbolLabel(s)}
                      onClick={() => toggle(s)}
                      className={clsx(
                        'num rounded border px-2 py-0.5 text-xs transition-colors pointer-coarse:px-3 pointer-coarse:py-2',
                        on ? 'border-brand/50 bg-brand-soft text-foreground' : 'border-border text-muted hover:border-border-strong hover:text-foreground',
                      )}
                    >
                      {shortSymbol(s)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {selected.length === 0 ? (
        <Panel>
          <EmptyState title="Pick at least one instrument">Choose instruments above to compare their performance.</EmptyState>
        </Panel>
      ) : (
        <>
          <ErrorBoundary>
            <PerformanceChart symbols={selected} />
          </ErrorBoundary>
          <ErrorBoundary>
            <ReturnsAndCorrelation symbols={selected} />
          </ErrorBoundary>
        </>
      )}
    </div>
  )
}

function PerformanceChart({ symbols }: { symbols: string[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>('6M')
  const qs = useHistories(symbols, range)
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const loading = qs.some((q) => q.isLoading)
  const dataKey = qs.map((q) => q.dataUpdatedAt).join(',')
  const rows = useMemo(
    () => {
      const all = rebase(symbols.map((symbol, i) => ({ symbol, bars: qs[i]?.data ?? [] })))
      // Long daily history: plot about weekly points (the last row is always kept).
      return all.length > 1500 ? all.filter((_, i) => i % 5 === 0 || i === all.length - 1) : all
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when any series updates
    [symbols, dataKey],
  )
  const failed = symbols.filter((_, i) => qs[i]?.error)

  return (
    <Panel
      density="dense"
      title="Normalized performance"
      eyebrow="Rebased to 0% at the first common date"
      actions={<Segmented ariaLabel="Range" value={range} onChange={setRange} options={RANGES} />}
      provenance={{
        source: `Yahoo Finance ${range === '5Y' ? 'weekly' : range === 'MAX' ? 'daily (full stored history)' : 'daily'} closes`,
        asOf: rows.at(-1)?.date ?? null,
        note: failed.length ? `no data: ${failed.map(shortSymbol).join(', ')}` : undefined,
      }}
    >
      {loading ? (
        <Skeleton className="h-80 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No overlapping history">The selected instruments have no common dates in this range.</EmptyState>
      ) : (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
            <LineChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid {...s.grid} />
              <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(range === '5Y' || range === '1Y' || range === 'MAX')} minTickGap={40} />
              <YAxis tick={s.tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => fmtPctSigned(v, 0)} />
              <ReferenceLine y={0} stroke={t.border} />
              <Tooltip
                {...s.tooltip}
                labelFormatter={(d) => fmtDate(String(d))}
                formatter={(v, n) => [fmtPctSigned(Number(v)), shortSymbol(String(n))]}
                itemSorter={(item) => -Number(item.value ?? 0)}
              />
              {symbols.map((sym, i) => (
                <Line key={sym} dataKey={sym} name={sym} stroke={seriesColor(sym, i, t)} strokeWidth={sym.endsWith('=F') ? 2 : 1.5} dot={false} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        {symbols.map((sym, i) => (
          <li key={sym} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: seriesColor(sym, i, t) }} aria-hidden />
            <span className="num">{shortSymbol(sym)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ReturnsAndCorrelation({ symbols }: { symbols: string[] }) {
  const qs = useHistories(symbols, '1Y')
  const loading = qs.some((q) => q.isLoading)
  const dataKey = qs.map((q) => q.dataUpdatedAt).join(',')
  const series: { symbol: string; bars: OHLCV[] }[] = useMemo(
    () => symbols.map((symbol, i) => ({ symbol, bars: (qs[i]?.data ?? []).filter((b) => b.close > 0) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when any series updates
    [symbols, dataKey],
  )
  const rows = useMemo(() => series.map((s) => ({ symbol: s.symbol, r: periodReturns(s.bars) })), [series])
  const matrix = useMemo(() => series.map((a) => series.map((b) => (a === b ? 1 : returnCorrelation(a.bars, b.bars)))), [series])
  const asOf = series.map((s) => s.bars.at(-1)?.date.slice(0, 10)).filter(Boolean).sort().at(-1) ?? null

  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'symbol', header: 'Instrument', cell: (r) => <span className="num font-medium text-foreground" title={symbolLabel(r.symbol)}>{shortSymbol(r.symbol)}</span>, sortValue: (r) => r.symbol },
    ...PERIODS.map((p: Period) => ({
      key: p,
      header: p,
      numeric: true,
      cell: (r: (typeof rows)[number]) => <span className={signColor(r.r[p])}>{fmtPctSigned(r.r[p], 1)}</span>,
      sortValue: (r: (typeof rows)[number]) => r.r[p],
    })),
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel density="dense" title="Returns" provenance={{ source: 'Yahoo Finance daily closes (1Y)', asOf }}>
        {loading ? <Skeleton className="h-40 w-full" /> : <DataTable columns={cols} rows={rows} rowKey={(r) => r.symbol} dense caption="Period returns" />}
      </Panel>
      <Panel density="dense" title="Correlation of daily returns (1Y)" provenance={{ source: 'Yahoo Finance daily closes, shared dates only', asOf }}>
        {symbols.length < 2 ? (
          <EmptyState compact title="Pick two or more instruments" />
        ) : loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0.5 text-xs">
              <thead>
                <tr>
                  <th />
                  {symbols.map((s) => (
                    <th key={s} scope="col" className="label px-1.5 py-1 text-center font-medium">{shortSymbol(s)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbols.map((a, i) => (
                  <tr key={a}>
                    <th scope="row" className="label whitespace-nowrap pr-2 text-left font-medium">{shortSymbol(a)}</th>
                    {symbols.map((b, j) => {
                      const c = matrix[i]?.[j] ?? null
                      const strength = c == null ? 0 : Math.round(Math.abs(c) * 40)
                      return (
                        <td
                          key={b}
                          className={clsx('num rounded px-1.5 py-1.5 text-center', i === j ? 'text-faint' : 'text-foreground')}
                          style={{ background: c == null || i === j ? undefined : `color-mix(in oklch, var(${c >= 0 ? '--pos' : '--neg'}) ${strength}%, transparent)` }}
                          title={`${shortSymbol(a)} vs ${shortSymbol(b)}`}
                        >
                          {fmtNum(c, 2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="xl:col-span-2">
        <Explainer title="Notes on the comparison">
          <p>
            {FUTURE_SPOTS.length > 0 && (
              <>
                {FUTURE_SPOTS.map((a) => `${UNIVERSE[a].label} (${UNIVERSE[a].spot})`).join(', ')} use the front future as the spot proxy; their returns
                include the monthly roll.{' '}
              </>
            )}
            DXY is the ICE US Dollar Index. Correlations use only dates on which both instruments traded, so futures and US-listed funds line up on US sessions.
          </p>
        </Explainer>
      </div>
    </div>
  )
}

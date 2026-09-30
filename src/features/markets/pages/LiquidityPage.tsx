import { CHART_INITIAL_SIZE } from '../../../design/tokens'
import { useId, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { LiquidityHistoryResponse, LiquiditySnapshot, ModeledSplit } from '@shared/markets'
import { UNIVERSE } from '@shared/universe'
import { useSettings } from '../../../store/settings-context'
import { Chip, EmptyState, ErrorBoundary, ErrorNote, Explainer, Panel, PanelSkeleton, Segmented, Skeleton, Stat } from '../../../ui'
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtUsdCompact } from '../../../design/format'
import { useLiquidity, useLiquidityHistory } from '../hooks'
import { useChartTheme, type ChartTheme } from '../charts/chartTheme'
import { dateTick, rechartsStyle } from '../charts/recharts'

const PROVENANCE_LINE = 'Yahoo Finance volumes · source split modeled from World Gold Council shares'
const RANGES = ['1M', '3M', '6M', '1Y', '5Y', 'ALL'] as const
type Range = (typeof RANGES)[number]

export default function LiquidityPage() {
  const { metal } = useSettings()
  const snap = useLiquidity(metal)
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {metal === 'gold' ? PROVENANCE_LINE : 'Yahoo Finance volumes · silver shows observed instrument volumes only (no modeled source split)'}
      </p>
      {snap.isLoading ? (
        <Panel><PanelSkeleton rows={6} /></Panel>
      ) : snap.error || !snap.data ? (
        <Panel><ErrorNote error={snap.error ?? new Error('No data')} onRetry={() => snap.refetch()} /></Panel>
      ) : (
        <ErrorBoundary>
          <Snapshot data={snap.data} />
        </ErrorBoundary>
      )}
      <ErrorBoundary>
        <History />
      </ErrorBoundary>
      <LiquidityExplainer />
    </div>
  )
}

function Snapshot({ data: d }: { data: LiquiditySnapshot }) {
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const max = Math.max(...d.instruments.map((i) => i.dollarVolume), 1)
  const color = d.metal === 'gold' ? t.gold : t.silver
  const futureShare = d.totalDollarVolume > 0 ? d.instruments.filter((i) => i.kind === 'future').reduce((a, i) => a + i.dollarVolume, 0) / d.totalDollarVolume : null

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel density="dense" title="Today's dollar volume by instrument" provenance={d.provenance}>
        <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="Total, session to date" value={fmtUsdCompact(d.totalDollarVolume)} size="lg" />
          <Stat label="Futures share" value={fmtPct(futureShare, 1)} size="sm" hint={`COMEX ${d.futuresSymbol} front month vs ETFs`} />
        </div>
        <table className="w-full text-xs">
          <caption className="sr-only">Dollar volume by instrument</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="label py-1.5 text-left font-medium">Instrument</th>
              <th scope="col" className="label py-1.5 text-right font-medium">Volume</th>
              <th scope="col" className="label py-1.5 text-right font-medium">$ volume</th>
              <th scope="col" className="label hidden w-2/5 py-1.5 pl-4 text-left font-medium sm:table-cell">Share</th>
            </tr>
          </thead>
          <tbody>
            {d.instruments.map((i) => (
              <tr key={i.symbol} className="border-b border-border/60 last:border-0">
                <td className="py-1.5">
                  <span className="num font-medium text-foreground">{i.symbol}</span>
                  <span className="ml-2 text-muted">{i.name}</span>
                </td>
                <td className="num py-1.5 text-right text-muted">
                  {fmtCompact(i.volume)} {i.kind === 'future' ? 'lots' : 'sh'}
                </td>
                <td className="num py-1.5 text-right text-foreground">{fmtUsdCompact(i.dollarVolume)}</td>
                <td className="hidden py-1.5 pl-4 sm:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${(i.dollarVolume / max) * 100}%`, background: i.kind === 'future' ? color : t.alpha(color, 0.55) }} />
                    </div>
                    <span className="num w-12 text-right text-muted">{fmtPct(d.totalDollarVolume ? i.dollarVolume / d.totalDollarVolume : null, 1)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        density="dense"
        title={`COMEX ${d.futuresSymbol} contracts traded, last 30 sessions`}
        provenance={{ source: `Yahoo Finance daily volume summed over listed ${d.futuresSymbol} active months`, asOf: d.futuresVolume.at(-1)?.date ?? null, note: 'Months that expired in the window are not included' }}
      >
        {d.futuresVolume.length === 0 ? (
          <EmptyState compact title="No futures volume history returned" />
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
              <BarChart data={d.futuresVolume} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                <CartesianGrid {...s.grid} />
                <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(false)} minTickGap={24} />
                <YAxis tick={s.tick} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => fmtCompact(v)} />
                <Tooltip {...s.tooltip} cursor={{ fill: t.alpha(t.faint, 0.12) }} labelFormatter={(x) => fmtDate(String(x))} formatter={(v) => [fmtNum(Number(v), 0), 'Contracts']} />
                <Bar dataKey="volume" fill={t.alpha(color, 0.8)} isAnimationActive={false} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      {d.split ? (
        <div className="xl:col-span-2">
          <SourceSplit split={d.split} total={d.totalDollarVolume} t={t} />
        </div>
      ) : (
        <Panel density="dense" className="xl:col-span-2" provenance={{ source: 'No modeled split for silver' }}>
          <EmptyState compact title="No source or country breakdown for silver">
            There is no silver dataset comparable to the World Gold Council demand shares used for gold, so no split is estimated. Only the observed
            instrument volumes above are shown.
          </EmptyState>
        </Panel>
      )}
    </div>
  )
}

function SourceSplit({ split, total, t }: { split: ModeledSplit; total: number; t: ChartTheme }) {
  const colors = [t.series[1], t.series[2], t.series[3], t.series[4], t.series[5]]
  return (
    <Panel
      density="dense"
      title={
        <span className="flex items-center gap-2">
          Estimated split of today's volume <Chip tone="modeled">Modeled</Chip>
        </span>
      }
      provenance={{ ...split.provenance, asOf: undefined }}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="label mb-2">By participant type</div>
          <div className="flex h-2 overflow-hidden rounded-full" aria-hidden>
            {split.sources.map((src, i) => (
              <span key={src.key} style={{ width: `${src.share * 100}%`, background: colors[i % colors.length] }} />
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-xs">
            {split.sources.map((src, i) => (
              <li key={src.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-muted">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: colors[i % colors.length] }} aria-hidden />
                  {src.label}
                </span>
                <span className="flex items-center gap-2">
                  <Chip tone="modeled">Modeled</Chip>
                  <span className="num w-12 text-right text-muted">{fmtPct(src.share, 0)}</span>
                  <span className="num w-16 text-right text-foreground">{fmtUsdCompact(total * src.share)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Regions split={split} total={total} />
      </div>
    </Panel>
  )
}

function Regions({ split, total, scaleLabel = "today's volume" }: { split: ModeledSplit; total: number; scaleLabel?: string }) {
  return (
    <div>
      <div className="label mb-2">By region and country · scaled to {scaleLabel}</div>
      <div className="space-y-1">
        {split.regions.map((r) => (
          <details key={r.region} className="group rounded-md border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-surface-2">
              <span className="flex items-center gap-1.5 text-foreground">
                <span className="text-faint transition-transform group-open:rotate-90" aria-hidden>›</span>
                {r.region}
                <span className="text-muted">({r.countries.length})</span>
              </span>
              <span className="flex items-center gap-2">
                <Chip tone="modeled">Modeled</Chip>
                <span className="num w-10 text-right text-muted">{fmtPct(r.share, 0)}</span>
                <span className="num w-16 text-right text-foreground">{fmtUsdCompact(total * r.share)}</span>
              </span>
            </summary>
            <ul className="border-t border-border px-2.5 py-1.5 text-xs">
              {r.countries.map((c) => (
                <li key={c.country} className="py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground">{c.country}</span>
                    <span className="flex items-center gap-2">
                      <Chip tone="modeled">Modeled</Chip>
                      <span className="num w-10 text-right text-muted">{fmtPct(c.share, 1)}</span>
                      <span className="num w-16 text-right text-foreground">{fmtUsdCompact(total * c.share)}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-2xs text-muted">{c.breakdown.map((b) => `${b.type} ${fmtPct(b.share, 0)}`).join(' · ')}</div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  )
}

type View = 'instrument' | 'source'

function History() {
  const { metal } = useSettings()
  const [range, setRange] = useState<Range>('1Y')
  const [view, setView] = useState<View>('instrument')
  const q = useLiquidityHistory(metal, range)
  const activeView: View = metal === 'gold' ? view : 'instrument'

  return (
    <Panel
      density="dense"
      title={
        <span className="flex items-center gap-2">
          {UNIVERSE[metal].label} dollar volume over time {activeView === 'source' && <Chip tone="modeled">Modeled</Chip>}
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {metal === 'gold' && (
            <Segmented
              ariaLabel="Breakdown"
              value={view}
              onChange={setView}
              options={[
                { value: 'instrument', label: 'By instrument' },
                { value: 'source', label: 'By source (modeled)' },
              ]}
            />
          )}
          <Segmented ariaLabel="Range" value={range} onChange={setRange} options={RANGES} />
        </div>
      }
      provenance={q.data ? { ...q.data.provenance, modeled: activeView === 'source' } : { source: 'Yahoo Finance volumes' }}
    >
      {q.isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : q.error || !q.data ? (
        <ErrorNote error={q.error ?? new Error('No data')} onRetry={() => q.refetch()} />
      ) : q.data.history.length === 0 ? (
        <EmptyState title="No volume history returned">Yahoo returned no bars for this range.</EmptyState>
      ) : (
        <HistoryBody data={q.data} view={activeView} />
      )}
    </Panel>
  )
}

function HistoryBody({ data: d, view }: { data: LiquidityHistoryResponse; view: View }) {
  const t = useChartTheme()
  const s = rechartsStyle(t)
  const gid = useId().replace(/:/g, '')
  const perBar = d.interval === '1d' ? 'session' : d.interval === '1wk' ? 'week' : 'month'

  const layers = useMemo(() => {
    if (view === 'source' && d.split) return d.split.sources.map((src, i) => ({ key: src.key, label: src.label, color: t.series[i % t.series.length] }))
    return d.symbols.map((sym, i) => ({ key: sym.symbol, label: sym.symbol, color: i === 0 ? (d.metal === 'gold' ? t.gold : t.silver) : t.series[(i % 5) + 1] }))
  }, [view, d, t])

  const rows = useMemo(
    () =>
      d.history.map((h) => {
        const row: Record<string, number | string> = { date: h.date, total: h.total }
        if (view === 'source' && d.split) for (const src of d.split.sources) row[src.key] = h.total * src.share
        else for (const sym of d.symbols) row[sym.symbol] = h.bySymbol[sym.symbol] ?? 0
        return row
      }),
    [d, view],
  )

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
        <Stat label={`Total, ${d.range}`} value={fmtUsdCompact(d.summary.total)} size="md" />
        <Stat label={`Average per ${perBar}`} value={fmtUsdCompact(d.summary.avgDaily)} size="md" />
        <Stat label={`${perBar[0].toUpperCase()}${perBar.slice(1)}s`} value={fmtNum(d.summary.sessions, 0)} size="md" />
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%" initialDimension={CHART_INITIAL_SIZE}>
          <AreaChart data={rows} margin={{ left: 0, right: 8, top: 16, bottom: 0 }}>
            <defs>
              {layers.map((l) => (
                <linearGradient key={l.key} id={`${gid}-${l.key.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={l.color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={l.color} stopOpacity={0.2} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...s.grid} />
            <XAxis dataKey="date" tick={s.tick} axisLine={s.axisLine} tickLine={false} tickFormatter={dateTick(d.interval !== '1d' || d.range === '1Y')} minTickGap={40} />
            <YAxis tick={s.tick} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => fmtUsdCompact(v)} />
            <Tooltip
              {...s.tooltip}
              labelFormatter={(x) => fmtDate(String(x))}
              formatter={(v, n) => [fmtUsdCompact(Number(v)), layers.find((l) => l.key === n)?.label ?? String(n)]}
              itemSorter={(item) => layers.findIndex((l) => l.key === item.dataKey)}
            />
            {layers.map((l) => (
              <Area
                key={l.key}
                dataKey={l.key}
                stackId="1"
                type="monotone"
                stroke={l.color}
                strokeWidth={1}
                fill={`url(#${gid}-${l.key.replace(/[^a-z0-9]/gi, '')})`}
                isAnimationActive={false}
              />
            ))}
            {d.spikes.map((sp, i) => (
              <ReferenceLine
                key={sp.date}
                x={sp.date}
                stroke={t.brand}
                strokeDasharray="3 3"
                label={{ value: String(i + 1), position: 'top', fill: t.brand, fontSize: 10, fontFamily: t.font }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        {layers.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: l.color }} aria-hidden />
            {l.label}
            {view === 'source' && <Chip tone="modeled">Modeled</Chip>}
          </li>
        ))}
      </ul>

      {d.spikes.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="label mb-2">Volume spikes (more than 1.2 standard deviations above the range mean)</div>
          <ol className="space-y-1">
            {d.spikes.map((sp, i) => (
              <li key={sp.date}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 text-xs hover:text-foreground">
                    <span className="num inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-soft text-2xs text-brand-strong">{i + 1}</span>
                    <span className="num w-24 shrink-0 text-muted">{fmtDate(sp.date)}</span>
                    <span className="num w-16 shrink-0 text-right text-foreground">{fmtUsdCompact(sp.total)}</span>
                    <span className="num w-12 shrink-0 text-right text-muted">{fmtNum(sp.z, 1)}σ</span>
                    <span className="truncate text-foreground">{sp.title ?? 'Unusual volume — no catalogued event within 3 days'}</span>
                  </summary>
                  {sp.description && (
                    <p className="ml-7 mt-1 max-w-3xl text-xs leading-relaxed text-muted">
                      {sp.description}
                      {d.metal === 'silver' && ' (Event from the gold-market catalogue; silver usually reacts to the same macro news.)'}
                    </p>
                  )}
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}

      {view === 'source' && d.split && (
        <div className="mt-4 border-t border-border pt-3">
          <Regions split={d.split} total={d.summary.total} scaleLabel={`${d.range} total`} />
        </div>
      )}
    </>
  )
}

function LiquidityExplainer() {
  return (
    <Explainer title="What is measured and what is modeled">
      <p>
        <strong>Observed:</strong> share and contract volumes from Yahoo Finance for the front COMEX future and the physically backed ETFs. Dollar
        volume is shares × price, or contracts × ounces per contract (100 oz gold, 5,000 oz silver) × price. OTC London trading, which is most of the
        physical market, is not visible here.
      </p>
      <p>
        <strong>Modeled (gold only):</strong> the participant and country splits apply fixed percentages derived from World Gold Council demand
        shares to the observed total. They do not change day to day and are not observed flows — treat them as a sense of scale, not a signal.
      </p>
      <p>
        Silver history excludes the SI=F continuous contract because Yahoo's history for it follows thin delivery months; today's snapshot and the
        30-session chart use the actual listed contracts instead.
      </p>
    </Explainer>
  )
}

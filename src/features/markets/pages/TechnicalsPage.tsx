import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { useSettings } from '../../../store/settings-context'
import { Chip, EmptyState, ErrorBoundary, ErrorNote, Explainer, Panel, PanelSkeleton, type ChipTone } from '../../../ui'
import { fmtNum, fmtPctSigned, fmtDate } from '../../../design/format'
import { PALETTE, signColor } from '../../../design/tokens'
import { useHistory } from '../hooks'
import { metalInstruments, shortSymbol, symbolLabel } from '../lib/symbols'
import {
  SIGNAL_LABEL,
  aggregateSignals,
  detectCrosses,
  ema,
  last,
  rsi as rsiOf,
  signalFromMa,
  signalFromRsi,
  sma,
  type Signal,
} from '../lib/indicators'
import { IndicatorChart, type MaLine } from '../charts/IndicatorChart'
import { useChartTheme } from '../charts/chartTheme'

const SIGNAL_TONE: Record<Signal, ChipTone> = { strong_buy: 'strong', buy: 'strong', neutral: 'neutral', sell: 'avoid', strong_sell: 'avoid' }
const LEVELS: Signal[] = ['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy']

export default function TechnicalsPage() {
  const { metal } = useSettings()
  const { symbol: param } = useParams<{ symbol: string }>()
  const navigate = useNavigate()
  const symbols = metalInstruments(metal)
  const symbol = param ? decodeURIComponent(param) : symbols[0]
  const pickList = symbols.includes(symbol) ? symbols : [...symbols, symbol]
  const q = useHistory(symbol, '1Y')
  const t = useChartTheme()

  const ind = useMemo(() => {
    const bars = (q.data ?? []).filter((b) => b.close > 0)
    if (bars.length < 30) return null
    const closes = bars.map((b) => b.close)
    const out = {
      bars,
      price: closes[closes.length - 1],
      asOf: bars[bars.length - 1].date,
      rsi: rsiOf(closes, 14),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      ema12: ema(closes, 12),
      ema26: ema(closes, 26),
    }
    const cross = detectCrosses(out.sma50, out.sma200).at(-1) ?? null
    const signals: { name: string; value: number | null; signal: Signal | null }[] = [
      { name: 'RSI (14)', value: last(out.rsi), signal: last(out.rsi) != null ? signalFromRsi(last(out.rsi) as number) : null },
      ...(['sma50', 'sma200', 'ema12', 'ema26'] as const).map((k) => {
        const v = last(out[k])
        return { name: k.toUpperCase().replace(/(\d+)/, '-$1'), value: v, signal: v != null ? signalFromMa(out.price, v) : null }
      }),
    ]
    const valid = signals.map((s) => s.signal).filter((s): s is Signal => s != null)
    return { ...out, cross: cross ? { ...cross, date: bars[cross.index].date } : null, signals, aggregate: aggregateSignals(valid) }
  }, [q.data])

  const mas: MaLine[] = useMemo(
    () =>
      ind
        ? [
            { key: 'sma50', label: 'SMA-50', values: ind.sma50, color: t.series[1] },
            { key: 'sma200', label: 'SMA-200', values: ind.sma200, color: t.series[3] },
            { key: 'ema12', label: 'EMA-12', values: ind.ema12, color: t.series[2] },
            { key: 'ema26', label: 'EMA-26', values: ind.ema26, color: t.series[4] },
          ]
        : [],
    [ind, t],
  )

  const provenance = { source: `Yahoo Finance · ${symbol} daily closes (1Y)`, asOf: ind?.asOf ?? null }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Instrument">
        {pickList.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === symbol}
            onClick={() => navigate(`/markets/signals/${encodeURIComponent(s)}`)}
            className={clsx(
              'num rounded border px-2.5 py-1 text-xs transition-colors',
              s === symbol ? 'border-brand/50 bg-brand-soft text-foreground' : 'border-border text-muted hover:border-border-strong hover:text-foreground',
            )}
            title={symbolLabel(s)}
          >
            {shortSymbol(s)}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <Panel><PanelSkeleton rows={6} /></Panel>
      ) : q.error ? (
        <Panel><ErrorNote error={q.error} onRetry={() => q.refetch()} /></Panel>
      ) : !ind ? (
        <Panel provenance={provenance}>
          <EmptyState title={`Not enough history for ${symbol}`}>Indicators need at least 30 daily closes.</EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Panel density="dense" title="RSI (14)" provenance={provenance}>
              <RsiGauge value={last(ind.rsi)} />
            </Panel>
            <Panel density="dense" title="Moving averages" provenance={provenance}>
              <dl className="divide-y divide-border/60 text-sm">
                {ind.signals.slice(1).map((s) => {
                  const diff = s.value != null ? ind.price / s.value - 1 : null
                  return (
                    <div key={s.name} className="flex items-center justify-between gap-3 py-1.5">
                      <dt className="text-muted">{s.name}</dt>
                      <dd className="flex items-center gap-3">
                        <span className="num text-foreground">{fmtNum(s.value)}</span>
                        <span className={clsx('num w-16 text-right text-xs', signColor(diff))}>{fmtPctSigned(diff)}</span>
                        {s.signal ? <Chip tone={SIGNAL_TONE[s.signal]}>{diff != null && diff > 0 ? 'Above' : 'Below'}</Chip> : <Chip>n/a</Chip>}
                      </dd>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-muted">Last</dt>
                  <dd className="num font-medium text-foreground">{fmtNum(ind.price)}</dd>
                </div>
              </dl>
            </Panel>
            <Panel density="dense" title="Signal summary" provenance={provenance}>
              <div className="flex items-baseline justify-between">
                <span className="display text-2xl text-foreground">{SIGNAL_LABEL[ind.aggregate]}</span>
                <Chip tone={SIGNAL_TONE[ind.aggregate]}>{ind.signals.filter((s) => s.signal).length} inputs</Chip>
              </div>
              <div className="mt-3 flex gap-1" aria-hidden>
                {LEVELS.map((l) => (
                  <span
                    key={l}
                    className={clsx('h-1.5 flex-1 rounded-full', l === ind.aggregate ? 'opacity-100' : 'opacity-20')}
                    style={{ background: l.includes('buy') ? PALETTE.pos : l.includes('sell') ? PALETTE.neg : PALETTE.muted }}
                  />
                ))}
              </div>
              <ul className="mt-3 space-y-1 text-xs">
                {ind.signals.map((s) => (
                  <li key={s.name} className="flex justify-between">
                    <span className="text-muted">{s.name}</span>
                    <span className={clsx(s.signal?.includes('buy') ? 'text-pos-text' : s.signal?.includes('sell') ? 'text-neg-text' : 'text-muted')}>
                      {s.signal ? SIGNAL_LABEL[s.signal] : 'n/a'}
                    </span>
                  </li>
                ))}
              </ul>
              {ind.cross && (
                <p className="mt-3 text-xs text-muted">
                  Last {ind.cross.type === 'golden_cross' ? 'golden cross (SMA-50 above SMA-200)' : 'death cross (SMA-50 below SMA-200)'} on{' '}
                  <span className="num text-foreground">{fmtDate(ind.cross.date)}</span>.
                </p>
              )}
            </Panel>
          </div>

          <ErrorBoundary>
            <Panel
              density="dense"
              title={`${shortSymbol(symbol)} · price, moving averages, RSI`}
              actions={
                <ul className="flex flex-wrap gap-3 text-2xs text-muted">
                  {mas.map((m) => (
                    <li key={m.key} className="flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3" style={{ background: m.color }} aria-hidden />
                      {m.label}
                    </li>
                  ))}
                </ul>
              }
              provenance={provenance}
            >
              <IndicatorChart symbol={symbol} bars={ind.bars} mas={mas} rsi={ind.rsi} />
            </Panel>
          </ErrorBoundary>

          <Explainer title="How to read these signals">
            <p>
              RSI uses Wilder's smoothing: readings under 30 are oversold, over 70 overbought (20/80 for the strong bands). Moving-average reads are
              trend-following: price above an average counts as a buy, more than 5% above as a strong buy.
            </p>
            <p>
              The summary averages the five reads (strong ±2, normal ±1). It is descriptive, not a validated trading rule — for backtested signals use
              the Quant Lab. SMA-200 needs 200 sessions, so it only appears for the last part of this one-year window.
            </p>
          </Explainer>
        </>
      )}
    </div>
  )
}

function RsiGauge({ value }: { value: number | null }) {
  const v = value ?? 50
  const band = v >= 70 ? 'Overbought' : v <= 30 ? 'Oversold' : 'Neutral'
  const color = v >= 70 ? PALETTE.neg : v <= 30 ? PALETTE.pos : PALETTE.brand
  // Semicircle from 180° (0) to 0° (100).
  const angle = Math.PI * (1 - Math.min(100, Math.max(0, v)) / 100)
  const r = 70
  const cx = 90
  const cy = 86
  const pt = (a: number) => `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`
  const arc = (from: number, to: number) => `M ${pt(Math.PI * (1 - from / 100))} A ${r} ${r} 0 0 1 ${pt(Math.PI * (1 - to / 100))}`
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 96" className="w-full max-w-[220px]" role="img" aria-label={`RSI ${fmtNum(value, 1)}: ${band}`}>
        <path d={arc(0, 100)} fill="none" strokeWidth={10} style={{ stroke: PALETTE.surface2 }} strokeLinecap="butt" />
        <path d={arc(0, 30)} fill="none" strokeWidth={10} style={{ stroke: PALETTE.pos, opacity: 0.35 }} />
        <path d={arc(70, 100)} fill="none" strokeWidth={10} style={{ stroke: PALETTE.neg, opacity: 0.35 }} />
        <line x1={cx} y1={cy} x2={cx + (r - 4) * Math.cos(angle)} y2={cy - (r - 4) * Math.sin(angle)} strokeWidth={2} style={{ stroke: color }} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} style={{ fill: color }} />
      </svg>
      <div className="num -mt-1 text-2xl text-foreground">{fmtNum(value, 1)}</div>
      <div className="mt-0.5 text-xs text-muted">{band}</div>
      <div className="num mt-2 flex w-full max-w-[220px] justify-between text-2xs text-faint">
        <span>0</span>
        <span>30</span>
        <span>70</span>
        <span>100</span>
      </div>
    </div>
  )
}

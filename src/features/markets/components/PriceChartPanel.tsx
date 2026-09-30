import { useMemo, useState } from 'react'
import { TIME_RANGES, type TimeRange } from '@shared/markets'
import { EmptyState, ErrorNote, Panel, Segmented, Skeleton } from '../../../ui'
import { fmtNum, fmtPctSigned } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { useHistory } from '../hooks'
import { PriceChart, type PriceChartType } from '../charts/PriceChart'
import { shortSymbol } from '../lib/symbols'

interface Props {
  symbols: string[]
  defaultSymbol?: string
}

/** Instrument picker + range + chart type around the lightweight-charts price chart. */
export function PriceChartPanel({ symbols, defaultSymbol }: Props) {
  const [picked, setSymbol] = useState<string | null>(null)
  // Follow the metal switch: an out-of-universe pick falls back to the default.
  const symbol = picked && symbols.includes(picked) ? picked : (defaultSymbol ?? symbols[0])
  const [range, setRange] = useState<TimeRange>('6M')
  const [type, setType] = useState<PriceChartType>('area')
  const q = useHistory(symbol, range)
  const intraday = range === '1D' || range === '1W'

  const stats = useMemo(() => {
    const bars = (q.data ?? []).filter((b) => b.close > 0)
    if (bars.length < 2) return null
    const first = bars[0].close
    const last = bars[bars.length - 1].close
    return {
      change: last / first - 1,
      high: Math.max(...bars.map((b) => b.high || b.close)),
      low: Math.min(...bars.map((b) => b.low || b.close)),
      asOf: bars[bars.length - 1].date,
    }
  }, [q.data])

  return (
    <Panel
      density="dense"
      title={
        <span className="flex flex-wrap items-baseline gap-x-3">
          Price
          {stats && (
            <span className="num text-xs font-normal text-muted">
              {range} <span className={signColor(stats.change)}>{fmtPctSigned(stats.change)}</span> · H {fmtNum(stats.high)} · L {fmtNum(stats.low)}
            </span>
          )}
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented ariaLabel="Chart type" value={type} onChange={setType} options={[{ value: 'area', label: 'Area' }, { value: 'candle', label: 'Candles' }]} />
          <Segmented ariaLabel="Range" value={range} onChange={setRange} options={TIME_RANGES} />
        </div>
      }
      provenance={{
        source: `Yahoo Finance · ${symbol} · ${intraday ? 'intraday' : range === '5Y' ? 'weekly' : range === 'ALL' ? 'monthly' : 'daily'} bars`,
        asOf: stats?.asOf ?? null,
      }}
    >
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Instrument">
        {symbols.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === symbol}
            onClick={() => setSymbol(s)}
            className={
              s === symbol
                ? 'num rounded border border-brand/50 bg-brand-soft px-2 py-0.5 text-xs text-foreground'
                : 'num rounded border border-border px-2 py-0.5 text-xs text-muted hover:border-border-strong hover:text-foreground'
            }
          >
            {shortSymbol(s)}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-[340px] w-full" />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.filter((b) => b.close > 0).length === 0 ? (
        <EmptyState title="No bars for this range">Yahoo returned no data for {symbol} over {range}. Try a longer range.</EmptyState>
      ) : (
        <PriceChart symbol={symbol} bars={q.data} intraday={intraday} type={type} />
      )}
    </Panel>
  )
}

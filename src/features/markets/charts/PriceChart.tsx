import { useEffect, useRef } from 'react'
import { AreaSeries, CandlestickSeries, HistogramSeries, createChart } from 'lightweight-charts'
import type { OHLCV } from '@shared/markets'
import { useChartTheme } from './chartTheme'
import { baseChartOptions, toTimedBars } from './lwc'
import { assetColor } from '../lib/symbols'

export type PriceChartType = 'area' | 'candle'

interface PriceChartProps {
  symbol: string
  bars: OHLCV[]
  intraday: boolean
  type: PriceChartType
  showVolume?: boolean
  height?: number
}

/** lightweight-charts price chart (area or candles) with a volume pane, themed from tokens. */
export function PriceChart({ symbol, bars, intraday, type, showVolume = true, height = 340 }: PriceChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const t = useChartTheme()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const data = toTimedBars(bars, intraday)
    if (data.length === 0) return
    const chart = createChart(el, baseChartOptions(t, intraday))
    const line = assetColor(symbol, t)

    if (type === 'candle') {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: t.pos,
        downColor: t.neg,
        borderUpColor: t.pos,
        borderDownColor: t.neg,
        wickUpColor: t.pos,
        wickDownColor: t.neg,
      })
      s.setData(data.map((d) => ({ time: d.time, open: d.open || d.close, high: d.high || d.close, low: d.low || d.close, close: d.close })))
    } else {
      const s = chart.addSeries(AreaSeries, {
        lineColor: line,
        topColor: t.alpha(line, 0.22),
        bottomColor: t.alpha(line, 0),
        lineWidth: 2,
        priceLineColor: t.faint,
      })
      s.setData(data.map((d) => ({ time: d.time, value: d.close })))
    }

    if (showVolume && data.some((d) => d.volume > 0)) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(
        data.map((d) => ({ time: d.time, value: d.volume, color: t.alpha(d.close >= d.open ? t.pos : t.neg, 0.35) })),
      )
    }
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [bars, intraday, type, showVolume, symbol, t])

  return <div ref={ref} style={{ height }} className="w-full" role="img" aria-label={`${symbol} price chart`} />
}

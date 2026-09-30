import { useEffect, useRef } from 'react'
import { AreaSeries, LineSeries, LineStyle, createChart, type Time } from 'lightweight-charts'
import type { OHLCV } from '@shared/markets'
import { useChartTheme } from './chartTheme'
import { baseChartOptions, toTimedBars } from './lwc'
import { metalColor } from '../lib/symbols'

export interface MaLine {
  key: string
  label: string
  values: (number | null)[]
  color: string
}

interface Props {
  symbol: string
  bars: OHLCV[]
  mas: MaLine[]
  rsi: (number | null)[]
}

/** Price with moving averages (top pane) and RSI(14) with 30/70 bands (bottom pane). */
export function IndicatorChart({ symbol, bars, mas, rsi }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const t = useChartTheme()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Keep indices aligned with the indicator arrays: only drop empty bars at the same positions.
    const timed = toTimedBars(bars, false)
    if (timed.length === 0) return
    const index = new Map(bars.map((b, i) => [b.date.slice(0, 10), i]))
    const chart = createChart(el, baseChartOptions(t, false))
    const color = metalColor(symbol, t)

    const price = chart.addSeries(AreaSeries, { lineColor: color, topColor: t.alpha(color, 0.16), bottomColor: t.alpha(color, 0), lineWidth: 2, priceLineColor: t.faint })
    price.setData(timed.map((d) => ({ time: d.time, value: d.close })))

    const line = (values: (number | null)[]) =>
      timed
        .map((d) => ({ time: d.time, value: values[index.get(d.time as string) ?? -1] }))
        .filter((p): p is { time: Time; value: number } => p.value != null)

    for (const ma of mas) {
      const s = chart.addSeries(LineSeries, { color: ma.color, lineWidth: 1, title: ma.label, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
      s.setData(line(ma.values))
    }

    const r = chart.addSeries(LineSeries, { color: t.brand, lineWidth: 1, title: 'RSI', priceLineVisible: false }, 1)
    r.setData(line(rsi))
    r.createPriceLine({ price: 70, color: t.neg, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '' })
    r.createPriceLine({ price: 30, color: t.pos, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '' })
    chart.panes()[1]?.setHeight(110)
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [bars, mas, rsi, symbol, t])

  return <div ref={ref} className="h-[440px] w-full" role="img" aria-label={`${symbol} price, moving averages and RSI`} />
}

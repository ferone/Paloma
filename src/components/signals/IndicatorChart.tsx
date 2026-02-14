import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  LineSeries,
  AreaSeries,
} from 'lightweight-charts'
import type { OHLCV } from '../../types'
import { CHART_COLORS } from '../../lib/constants'
import { Card } from '../shared/Card'

interface IndicatorChartProps {
  ohlcv: OHLCV[]
  sma50: (number | null)[]
  sma200: (number | null)[]
  ema12: (number | null)[]
  ema26: (number | null)[]
  rsi: (number | null)[]
}

export function IndicatorChart({ ohlcv, sma50, sma200, ema12, ema26, rsi }: IndicatorChartProps) {
  const priceRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!priceRef.current || !rsiRef.current || ohlcv.length === 0) return

    const chartOpts = {
      layout: {
        background: { type: ColorType.Solid as const, color: 'transparent' },
        textColor: CHART_COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: CHART_COLORS.gridLine },
        horzLines: { color: CHART_COLORS.gridLine },
      },
      rightPriceScale: { borderColor: CHART_COLORS.gridLine },
      timeScale: { borderColor: CHART_COLORS.gridLine },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: false },
    }

    // Price chart
    const priceChart = createChart(priceRef.current, chartOpts)

    const dates = ohlcv.map((d) => d.date.split('T')[0])

    const priceSeries = priceChart.addSeries(AreaSeries, {
      lineColor: CHART_COLORS.gold,
      topColor: 'rgba(234, 179, 8, 0.2)',
      bottomColor: 'rgba(234, 179, 8, 0.01)',
      lineWidth: 2,
    })
    priceSeries.setData(ohlcv.map((d, i) => ({ time: dates[i] as string, value: d.close })))

    const maConfigs = [
      { data: sma50, color: '#3b82f6', label: 'SMA-50' },
      { data: sma200, color: '#ef4444', label: 'SMA-200' },
      { data: ema12, color: '#10b981', label: 'EMA-12' },
      { data: ema26, color: '#8b5cf6', label: 'EMA-26' },
    ]

    for (const ma of maConfigs) {
      const series = priceChart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        title: ma.label,
      })
      const d = ma.data
        .map((v, i) => (v != null ? { time: dates[i] as string, value: v } : null))
        .filter((v): v is { time: string; value: number } => v !== null)
      series.setData(d)
    }

    priceChart.timeScale().fitContent()

    // RSI chart
    const rsiChart = createChart(rsiRef.current, {
      ...chartOpts,
      height: 150,
    })

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: '#eab308',
      lineWidth: 2,
      title: 'RSI',
    })
    const rsiData = rsi
      .map((v, i) => (v != null ? { time: dates[i] as string, value: v } : null))
      .filter((v): v is { time: string; value: number } => v !== null)
    rsiSeries.setData(rsiData)

    rsiChart.timeScale().fitContent()

    // Sync scrolling
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) rsiChart.timeScale().setVisibleLogicalRange(range)
    })
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) priceChart.timeScale().setVisibleLogicalRange(range)
    })

    const resizeObserver = new ResizeObserver(() => {
      if (priceRef.current) priceChart.applyOptions({ width: priceRef.current.clientWidth })
      if (rsiRef.current) rsiChart.applyOptions({ width: rsiRef.current.clientWidth })
    })
    if (priceRef.current) resizeObserver.observe(priceRef.current)

    return () => {
      resizeObserver.disconnect()
      priceChart.remove()
      rsiChart.remove()
    }
  }, [ohlcv, sma50, sma200, ema12, ema26, rsi])

  return (
    <Card className="p-4 space-y-2">
      <h3 className="text-sm font-medium text-white">Price + Moving Averages</h3>
      <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-gold-500 inline-block" /> Price</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> SMA-50</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" /> SMA-200</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block" /> EMA-12</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-500 inline-block" /> EMA-26</span>
      </div>
      <div ref={priceRef} className="h-64" />
      <h3 className="text-sm font-medium text-white pt-2">RSI (14)</h3>
      <div ref={rsiRef} className="h-36" />
    </Card>
  )
}

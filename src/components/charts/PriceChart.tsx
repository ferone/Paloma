import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  CandlestickSeries,
  AreaSeries,
  HistogramSeries,
} from 'lightweight-charts'
import { useHistorical } from '../../hooks/useHistorical'
import { TimeRangeSelector } from './TimeRangeSelector'
import { type TimeRange, CHART_COLORS } from '../../lib/constants'
import { Card } from '../shared/Card'
import { ChartSkeleton } from '../shared/SkeletonLoader'
import clsx from 'clsx'

interface PriceChartProps {
  symbol?: string
  className?: string
}

type ChartType = 'area' | 'candlestick'

export function PriceChart({ symbol = 'GLD', className }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<TimeRange>('1M')
  const [chartType, setChartType] = useState<ChartType>('area')
  const { data, isLoading } = useHistorical(symbol, range)

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: CHART_COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: CHART_COLORS.gridLine },
        horzLines: { color: CHART_COLORS.gridLine },
      },
      crosshair: {
        vertLine: { color: '#4b5563', width: 1, style: 3 },
        horzLine: { color: '#4b5563', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: CHART_COLORS.gridLine,
      },
      timeScale: {
        borderColor: CHART_COLORS.gridLine,
        timeVisible: range === '1D' || range === '1W',
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: false },
    })

    if (chartType === 'candlestick') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: CHART_COLORS.up,
        downColor: CHART_COLORS.down,
        borderUpColor: CHART_COLORS.up,
        borderDownColor: CHART_COLORS.down,
        wickUpColor: CHART_COLORS.up,
        wickDownColor: CHART_COLORS.down,
      })
      series.setData(
        data.map((d) => ({
          time: d.date.split('T')[0] as string,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
      )
    } else {
      const series = chart.addSeries(AreaSeries, {
        lineColor: CHART_COLORS.gold,
        topColor: 'rgba(234, 179, 8, 0.3)',
        bottomColor: 'rgba(234, 179, 8, 0.02)',
        lineWidth: 2,
      })
      series.setData(
        data.map((d) => ({
          time: d.date.split('T')[0] as string,
          value: d.close,
        }))
      )
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeSeries.setData(
      data.map((d) => ({
        time: d.date.split('T')[0] as string,
        value: d.volume,
        color: d.close >= d.open ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
      }))
    )

    chart.timeScale().fitContent()

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
    }
  }, [data, range, chartType])

  if (isLoading) return <ChartSkeleton />

  return (
    <Card className={clsx('p-4', className)}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium text-white">{symbol} Price</h3>
          <div className="flex gap-1 bg-gray-800/50 rounded-lg p-0.5">
            <button
              onClick={() => setChartType('area')}
              className={clsx(
                'px-2 py-1 text-xs rounded-md transition-colors',
                chartType === 'area' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              )}
            >
              Area
            </button>
            <button
              onClick={() => setChartType('candlestick')}
              className={clsx(
                'px-2 py-1 text-xs rounded-md transition-colors',
                chartType === 'candlestick' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              )}
            >
              Candle
            </button>
          </div>
        </div>
        <TimeRangeSelector selected={range} onChange={setRange} />
      </div>
      <div ref={chartContainerRef} className="h-80" />
    </Card>
  )
}

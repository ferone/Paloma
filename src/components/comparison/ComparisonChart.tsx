import { useQueries } from '@tanstack/react-query'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine } from 'recharts'
import { fetchHistorical } from '../../api/historical.api'
import { queryKeys } from '../../api/query-keys'
import { normalizeMultiple } from '../../lib/normalize'
import { ETF_COLORS, type TimeRange } from '../../lib/constants'
import { Card } from '../shared/Card'
import { ChartSkeleton } from '../shared/SkeletonLoader'
import { TimeRangeSelector } from '../charts/TimeRangeSelector'
import { useState } from 'react'

interface ComparisonChartProps {
  symbols: string[]
}

export function ComparisonChart({ symbols }: ComparisonChartProps) {
  const [range, setRange] = useState<TimeRange>('6M')

  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: queryKeys.historical.symbol(symbol, range),
      queryFn: () => fetchHistorical(symbol, range),
      enabled: symbols.length > 0,
      staleTime: 30 * 60_000,
    })),
  })

  const isLoading = queries.some((q) => q.isLoading)

  if (isLoading) return <ChartSkeleton />

  const datasets = symbols
    .map((symbol, i) => ({
      symbol,
      data: queries[i]?.data ?? [],
    }))
    .filter((d) => d.data.length > 0)

  const chartData = normalizeMultiple(datasets)

  if (chartData.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-gray-500 text-center">Select ETFs to compare</p>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-white">Normalized % Change</h3>
        <TimeRangeSelector selected={range} onChange={setRange} />
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            stroke="#6b7280"
            fontSize={11}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis
            stroke="#6b7280"
            fontSize={11}
            tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(value?: number, name?: string) => {
              const v = value ?? 0
              return [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, name ?? '']
            }}
          />
          <Legend />
          <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
          {symbols.map((symbol) => (
            <Line
              key={symbol}
              type="monotone"
              dataKey={symbol}
              stroke={ETF_COLORS[symbol] || '#9ca3af'}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

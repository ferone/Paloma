import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import type { SimulationResult } from '../../types'
import { Card } from '../shared/Card'
import { formatCurrency } from '../../lib/format'

interface GrowthChartProps {
  result: SimulationResult
}

export function GrowthChart({ result }: GrowthChartProps) {
  const chartData = result.data.map((d) => ({
    date: d.date.split('T')[0],
    value: Math.round(d.value * 100) / 100,
  }))

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-white mb-4">Portfolio Growth</h3>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData}>
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
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(value?: number) => [formatCurrency(value ?? 0), 'Portfolio Value']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#eab308"
            fill="rgba(234, 179, 8, 0.15)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}

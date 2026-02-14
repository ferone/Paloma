import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatDollarVolume, formatCompactVolume } from '../../lib/format'
import type { LiquidityHistoryDay } from '../../types'

const SOURCE_CONFIG = [
  { key: 'institutional', label: 'Institutional', color: '#3b82f6' },
  { key: 'centralBanks', label: 'Central Banks', color: '#eab308' },
  { key: 'privateRetail', label: 'Private / Retail', color: '#10b981' },
  { key: 'jewelry', label: 'Jewelry & Industrial', color: '#f59e0b' },
  { key: 'mining', label: 'Mining & Supply', color: '#8b5cf6' },
] as const

interface LiquidityStackedChartProps {
  data: LiquidityHistoryDay[]
  range: string
}

function formatDateLabel(dateStr: string, range: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (range === '5Y' || range === 'ALL') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })
}

export function LiquidityStackedChart({ data, range }: LiquidityStackedChartProps) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
          <defs>
            {SOURCE_CONFIG.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.4} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickFormatter={(d: string) => formatDateLabel(d, range)}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 10 }}
            tickFormatter={formatCompactVolume}
            width={55}
          />
          <Tooltip
            contentStyle={{
              background: '#1f2937',
              border: '1px solid #374151',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#9ca3af', marginBottom: 4 }}
            labelFormatter={(label: string) => {
              const d = new Date(label + 'T00:00:00')
              return d.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            }}
            formatter={(value: number, name: string) => {
              const config = SOURCE_CONFIG.find((s) => s.key === name)
              return [formatDollarVolume(value), config?.label ?? name]
            }}
            itemSorter={(item) => {
              const idx = SOURCE_CONFIG.findIndex((s) => s.key === item.dataKey)
              return idx === -1 ? 99 : idx
            }}
          />
          {SOURCE_CONFIG.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stackId="1"
              stroke={s.color}
              strokeWidth={1.5}
              fill={`url(#grad-${s.key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

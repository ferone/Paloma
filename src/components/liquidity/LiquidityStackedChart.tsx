import { useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { formatDollarVolume, formatCompactVolume } from '../../lib/format'
import type { LiquidityHistoryDay, VolumeSpike } from '../../types'

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
  spikes?: VolumeSpike[]
}

function formatDateLabel(dateStr: string, range: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (range === '5Y' || range === 'ALL') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function LiquidityStackedChart({ data, range, spikes = [] }: LiquidityStackedChartProps) {
  const [selectedSpike, setSelectedSpike] = useState<number | null>(null)

  // Sort spikes chronologically for display
  const sortedSpikes = [...spikes].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  return (
    <div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 10, right: 10, top: 15, bottom: 5 }}>
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
            {sortedSpikes.map((spike, i) => (
              <ReferenceLine
                key={spike.date}
                x={spike.date}
                stroke="#f59e0b"
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                label={{
                  value: String(i + 1),
                  position: 'top',
                  fill: '#111827',
                  fontSize: 10,
                  fontWeight: 700,
                  offset: 0,
                  // Background circle effect via custom content
                  content: ({ viewBox }: { viewBox?: { x?: number; y?: number } }) => {
                    const x = viewBox?.x ?? 0
                    return (
                      <g>
                        <circle cx={x} cy={4} r={8} fill="#f59e0b" />
                        <text
                          x={x}
                          y={4}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#111827"
                          fontSize={10}
                          fontWeight={700}
                        >
                          {i + 1}
                        </text>
                      </g>
                    )
                  },
                }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Spike annotations */}
      {sortedSpikes.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {sortedSpikes.map((spike, i) => (
            <div key={spike.date}>
              <button
                onClick={() => setSelectedSpike(selectedSpike === i ? null : i)}
                className="flex items-center gap-2 w-full text-left group"
              >
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-gray-900 text-[10px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-xs text-gray-500 flex-shrink-0 w-20">
                  {formatShortDate(spike.date)}
                </span>
                <span className="text-xs text-gray-300 group-hover:text-white transition-colors truncate">
                  {spike.title}
                </span>
                <svg
                  className={`w-3.5 h-3.5 text-gray-600 flex-shrink-0 transition-transform ${selectedSpike === i ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {selectedSpike === i && (
                <div className="ml-7 mt-1.5 mb-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
                  <p className="text-xs text-gray-300 leading-relaxed">{spike.description}</p>
                  <p className="text-[10px] text-gray-500 mt-2">
                    Volume: {formatDollarVolume(spike.totalVolume)}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

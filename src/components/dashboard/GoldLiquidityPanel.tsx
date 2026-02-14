import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area } from 'recharts'
import { useGoldLiquidity } from '../../hooks/useGoldLiquidity'
import { Card } from '../shared/Card'
import { Skeleton } from '../shared/SkeletonLoader'
import type { RegionData, CountryDemand } from '../../types'
import clsx from 'clsx'

function formatDollarVolume(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  return `$${(value / 1e3).toFixed(0)}K`
}

function formatCompactVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`
  return value.toString()
}

function CountryRow({ country }: { country: CountryDemand }) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-800/50 transition-colors">
      <span className="text-lg leading-none">{country.flag}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm text-gray-200">{country.country}</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{country.percent}%</span>
            <span className="text-xs font-mono text-gray-300">{formatDollarVolume(country.volume)}</span>
          </div>
        </div>
        {/* Stacked demand bar */}
        <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-800">
          {country.breakdown.map((b) => (
            <div
              key={b.type}
              className="h-full"
              style={{ width: `${b.percent}%`, backgroundColor: b.color }}
              title={`${b.type}: ${b.percent}%`}
            />
          ))}
        </div>
        <div className="flex gap-2 mt-1 flex-wrap">
          {country.breakdown.map((b) => (
            <span key={b.type} className="text-[10px] text-gray-500 flex items-center gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: b.color }} />
              {b.type} {b.percent}%
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function RegionSection({ region }: { region: RegionData }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: region.color }} />
          <span className="text-sm font-medium text-white">{region.region}</span>
          <span className="text-xs text-gray-500">({region.countries.length} countries)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-300">{region.percent}%</span>
          <svg
            className={clsx('w-4 h-4 text-gray-500 transition-transform', expanded && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-800 px-1 py-1 space-y-0.5">
          {region.countries.map((c) => (
            <CountryRow key={c.country} country={c} />
          ))}
        </div>
      )}
    </div>
  )
}

export function GoldLiquidityPanel() {
  const { data, isLoading } = useGoldLiquidity()
  const [showCountries, setShowCountries] = useState(false)

  if (isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-5 w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </Card>
    )
  }

  if (!data) return null

  const { totalDollarVolume, sources, instruments, regions, history } = data

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-medium text-white">Gold Market Liquidity</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Daily volume across futures & ETFs, estimated source breakdown (World Gold Council)
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gold-300">{formatDollarVolume(totalDollarVolume)}</p>
          <p className="text-xs text-gray-500">Total Daily Volume</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Source breakdown donut */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Source Breakdown</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sources}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  dataKey="percent"
                  nameKey="name"
                >
                  {sources.map((s) => (
                    <Cell key={s.name} fill={s.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  itemStyle={{ color: '#d1d5db' }}
                  formatter={(value?: number, name?: string) => [
                    `${value ?? 0}%`,
                    name ?? '',
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {sources.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-gray-400">{s.name}</span>
                </span>
                <span className="text-gray-300 font-medium">{s.percent}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Volume by instrument */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Volume by Instrument</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={instruments}
                layout="vertical"
                margin={{ left: 0, right: 10, top: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickFormatter={formatCompactVolume}
                />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  width={50}
                />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  itemStyle={{ color: '#d1d5db' }}
                  formatter={(value?: number) => [
                    formatDollarVolume(value ?? 0),
                    'Dollar Volume',
                  ]}
                  labelFormatter={(label?: string) => {
                    const inst = instruments.find((i) => i.symbol === label)
                    return inst?.name ?? label ?? ''
                  }}
                />
                <Bar dataKey="dollarVolume" radius={[0, 4, 4, 0]}>
                  {instruments.map((inst) => (
                    <Cell
                      key={inst.symbol}
                      fill={inst.symbol === 'GC=F' ? '#eab308' : inst.symbol === 'GDX' ? '#8b5cf6' : '#3b82f6'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5">
            {instruments.map((inst) => (
              <div key={inst.symbol} className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{inst.symbol}</span>
                <span className="text-gray-300 font-mono">{formatDollarVolume(inst.dollarVolume)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 30-day volume trend */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">30-Day Futures Volume</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 10 }}
                  tickFormatter={formatCompactVolume}
                  width={45}
                />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  itemStyle={{ color: '#d1d5db' }}
                  formatter={(value?: number) => [
                    formatCompactVolume(value ?? 0),
                    'Contracts',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#eab308"
                  strokeWidth={2}
                  fill="url(#volumeGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-500">
            COMEX GC=F daily contract volume
          </p>
        </div>
      </div>

      {/* Country drill-down toggle */}
      <button
        onClick={() => setShowCountries(!showCountries)}
        className="flex items-center gap-2 text-sm text-gold-400 hover:text-gold-300 transition-colors pt-1"
      >
        <svg
          className={clsx('w-4 h-4 transition-transform', showCountries && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {showCountries ? 'Hide' : 'Show'} Country Breakdown
      </button>

      {showCountries && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              Demand by Country & Region
            </h4>
            <p className="text-[10px] text-gray-600">
              Estimates based on World Gold Council demand data
            </p>
          </div>

          {/* Region bar summary */}
          <div className="flex h-3 rounded-full overflow-hidden">
            {regions.map((r) => (
              <div
                key={r.region}
                className="h-full relative group"
                style={{ width: `${r.percent}%`, backgroundColor: r.color }}
                title={`${r.region}: ${r.percent}%`}
              />
            ))}
          </div>
          <div className="flex gap-4 flex-wrap">
            {regions.map((r) => (
              <span key={r.region} className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                {r.region} {r.percent}%
              </span>
            ))}
          </div>

          {/* Expandable regions */}
          <div className="space-y-2">
            {regions.map((r) => (
              <RegionSection key={r.region} region={r} />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

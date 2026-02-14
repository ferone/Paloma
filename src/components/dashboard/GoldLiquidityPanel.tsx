import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area } from 'recharts'
import { useGoldLiquidity } from '../../hooks/useGoldLiquidity'
import { Card } from '../shared/Card'
import { Skeleton } from '../shared/SkeletonLoader'

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

export function GoldLiquidityPanel() {
  const { data, isLoading } = useGoldLiquidity()

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

  const { totalDollarVolume, sources, instruments, history } = data

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
    </Card>
  )
}

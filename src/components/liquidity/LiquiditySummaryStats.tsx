import { Card } from '../shared/Card'
import { formatDollarVolume } from '../../lib/format'
import type { LiquiditySummary } from '../../types'

const SOURCE_LABELS: { key: keyof LiquiditySummary['perSource']; label: string; color: string }[] = [
  { key: 'institutional', label: 'Institutional', color: '#3b82f6' },
  { key: 'centralBanks', label: 'Central Banks', color: '#eab308' },
  { key: 'privateRetail', label: 'Private / Retail', color: '#10b981' },
  { key: 'jewelry', label: 'Jewelry & Industrial', color: '#f59e0b' },
  { key: 'mining', label: 'Mining & Supply', color: '#8b5cf6' },
]

interface LiquiditySummaryStatsProps {
  summary: LiquiditySummary
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
    </Card>
  )
}

export function LiquiditySummaryStats({ summary }: LiquiditySummaryStatsProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total Volume" value={formatDollarVolume(summary.totalVolume)} />
        <StatCard label="Avg Daily" value={formatDollarVolume(summary.avgDailyVolume)} />
        <StatCard label="Trading Days" value={summary.tradingDays.toLocaleString()} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {SOURCE_LABELS.map((s) => (
          <Card key={s.key} className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <p className="text-[10px] text-gray-500 truncate">{s.label}</p>
            </div>
            <p className="text-sm font-semibold text-white">
              {formatDollarVolume(summary.perSource[s.key])}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}

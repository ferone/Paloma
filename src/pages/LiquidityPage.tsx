import { useState } from 'react'
import { useLiquidityHistory } from '../hooks/useLiquidityHistory'
import { TimeRangeSelector } from '../components/charts/TimeRangeSelector'
import { LiquidityStackedChart } from '../components/liquidity/LiquidityStackedChart'
import { LiquiditySummaryStats } from '../components/liquidity/LiquiditySummaryStats'
import { RegionSection } from '../components/liquidity/RegionSection'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { Skeleton } from '../components/shared/SkeletonLoader'
import { Card } from '../components/shared/Card'
import type { TimeRange } from '../lib/constants'
import clsx from 'clsx'

export default function LiquidityPage() {
  const [range, setRange] = useState<TimeRange>('1Y')
  const { data, isLoading } = useLiquidityHistory(range)
  const [showCountries, setShowCountries] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Gold Liquidity</h1>
          <p className="text-sm text-gray-500 mt-1">
            Historical gold market volume by source, with regional demand breakdown
          </p>
        </div>
        <TimeRangeSelector selected={range} onChange={setRange} />
      </div>

      {/* Summary stats */}
      <ErrorBoundary>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : data ? (
          <LiquiditySummaryStats summary={data.summary} />
        ) : null}
      </ErrorBoundary>

      {/* Stacked area chart */}
      <ErrorBoundary>
        <Card className="p-4">
          <h3 className="text-sm font-medium text-white mb-3">Volume by Source Over Time</h3>
          {isLoading ? (
            <Skeleton className="h-80" />
          ) : data ? (
            <LiquidityStackedChart data={data.history} range={range} />
          ) : null}
        </Card>
      </ErrorBoundary>

      {/* Country drill-down */}
      <ErrorBoundary>
        {data && (
          <Card className="p-4 space-y-3">
            <button
              onClick={() => setShowCountries(!showCountries)}
              className="flex items-center gap-2 text-sm text-gold-400 hover:text-gold-300 transition-colors"
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
                    Scaled to {range} total volume
                  </p>
                </div>

                {/* Region bar summary */}
                <div className="flex h-3 rounded-full overflow-hidden">
                  {data.regions.map((r) => (
                    <div
                      key={r.region}
                      className="h-full"
                      style={{ width: `${r.percent}%`, backgroundColor: r.color }}
                      title={`${r.region}: ${r.percent}%`}
                    />
                  ))}
                </div>
                <div className="flex gap-4 flex-wrap">
                  {data.regions.map((r) => (
                    <span key={r.region} className="flex items-center gap-1.5 text-xs text-gray-400">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                      {r.region} {r.percent}%
                    </span>
                  ))}
                </div>

                {/* Expandable regions */}
                <div className="space-y-2">
                  {data.regions.map((r) => (
                    <RegionSection key={r.region} region={r} />
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </ErrorBoundary>
    </div>
  )
}

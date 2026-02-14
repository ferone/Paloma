import { useState } from 'react'
import { ETFSelector } from '../components/comparison/ETFSelector'
import { ComparisonChart } from '../components/comparison/ComparisonChart'
import { ComparisonTable } from '../components/comparison/ComparisonTable'
import { CorrelationMatrix } from '../components/comparison/CorrelationMatrix'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'

export default function ComparisonPage() {
  const [selected, setSelected] = useState<string[]>(['GLD', 'SPY'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">ETF Comparison</h1>
        <p className="text-sm text-gray-400">Compare gold ETFs against broad market performance</p>
      </div>

      <ETFSelector selected={selected} onChange={setSelected} />

      <ErrorBoundary>
        <ComparisonChart symbols={selected} />
      </ErrorBoundary>

      <ErrorBoundary>
        <ComparisonTable symbols={selected} />
      </ErrorBoundary>

      <ErrorBoundary>
        <CorrelationMatrix symbols={selected} />
      </ErrorBoundary>
    </div>
  )
}

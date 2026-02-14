import { GoldPriceTicker } from '../components/dashboard/GoldPriceTicker'
import { PriceCardGrid } from '../components/dashboard/PriceCardGrid'
import { GoldLiquidityPanel } from '../components/dashboard/GoldLiquidityPanel'
import { PriceChart } from '../components/charts/PriceChart'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <ErrorBoundary>
        <GoldPriceTicker />
      </ErrorBoundary>

      <ErrorBoundary>
        <PriceCardGrid />
      </ErrorBoundary>

      <ErrorBoundary>
        <GoldLiquidityPanel />
      </ErrorBoundary>

      <ErrorBoundary>
        <PriceChart symbol="GLD" />
      </ErrorBoundary>
    </div>
  )
}

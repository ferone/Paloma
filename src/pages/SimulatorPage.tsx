import { useState } from 'react'
import { InvestmentForm } from '../components/simulator/InvestmentForm'
import { SimulationResults } from '../components/simulator/SimulationResults'
import { GrowthChart } from '../components/simulator/GrowthChart'
import { usePortfolioSimulator } from '../hooks/usePortfolioSimulator'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import type { PortfolioAllocation } from '../types'

interface SimInput {
  amount: number
  startDate: string
  endDate: string
  allocations: PortfolioAllocation[]
}

export default function SimulatorPage() {
  const [input, setInput] = useState<SimInput | null>(null)
  const { result, isLoading } = usePortfolioSimulator(input)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Portfolio Simulator</h1>
        <p className="text-sm text-gray-400">Backtest ETF portfolios with historical data</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div>
          <InvestmentForm onSubmit={setInput} isLoading={isLoading} />
        </div>

        <div className="lg:col-span-2 space-y-6">
          {result && (
            <ErrorBoundary>
              <SimulationResults result={result} initialAmount={input?.amount ?? 10000} />
              <GrowthChart result={result} />
            </ErrorBoundary>
          )}
          {!result && !isLoading && (
            <div className="flex items-center justify-center h-64 text-gray-500">
              <p>Configure your portfolio and run a simulation to see results</p>
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

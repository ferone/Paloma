import type { SimulationResult } from '../../types'
import { Card } from '../shared/Card'
import { formatCurrency, formatPercent } from '../../lib/format'
import clsx from 'clsx'

interface SimulationResultsProps {
  result: SimulationResult
  initialAmount: number
}

export function SimulationResults({ result, initialAmount }: SimulationResultsProps) {
  const finalValue = result.data[result.data.length - 1]?.value ?? initialAmount
  const metrics = [
    { label: 'Final Value', value: formatCurrency(finalValue), color: 'text-white' },
    {
      label: 'Total Return',
      value: formatPercent(result.totalReturn),
      color: result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'CAGR',
      value: formatPercent(result.cagr),
      color: result.cagr >= 0 ? 'text-green-400' : 'text-red-400',
    },
    { label: 'Max Drawdown', value: `-${result.maxDrawdown.toFixed(2)}%`, color: 'text-red-400' },
    { label: 'Volatility', value: `${result.volatility.toFixed(2)}%`, color: 'text-yellow-400' },
    { label: 'Sharpe Ratio', value: result.sharpeRatio.toFixed(2), color: result.sharpeRatio >= 1 ? 'text-green-400' : 'text-yellow-400' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {metrics.map((m) => (
        <Card key={m.label} className="p-4">
          <p className="text-xs text-gray-400 mb-1">{m.label}</p>
          <p className={clsx('text-lg font-bold font-mono', m.color)}>{m.value}</p>
        </Card>
      ))}
    </div>
  )
}

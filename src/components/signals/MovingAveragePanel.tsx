import { Card } from '../shared/Card'
import { formatCurrency } from '../../lib/format'
import clsx from 'clsx'

interface MAData {
  name: string
  value: number | null
  price: number
}

interface MovingAveragePanelProps {
  price: number
  sma50: number | null
  sma200: number | null
  ema12: number | null
  ema26: number | null
}

export function MovingAveragePanel({ price, sma50, sma200, ema12, ema26 }: MovingAveragePanelProps) {
  const indicators: MAData[] = [
    { name: 'SMA-50', value: sma50, price },
    { name: 'SMA-200', value: sma200, price },
    { name: 'EMA-12', value: ema12, price },
    { name: 'EMA-26', value: ema26, price },
  ]

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-white mb-3">Moving Averages</h3>
      <div className="space-y-2">
        {indicators.map((ind) => {
          if (ind.value == null) return null
          const diff = ((ind.price - ind.value) / ind.value) * 100
          const isAbove = diff > 0

          return (
            <div key={ind.name} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0">
              <span className="text-sm text-gray-400">{ind.name}</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-white font-mono">{formatCurrency(ind.value)}</span>
                <span
                  className={clsx(
                    'text-xs font-medium px-2 py-0.5 rounded',
                    isAbove ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                  )}
                >
                  {isAbove ? 'Buy' : 'Sell'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-gray-800">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Current Price</span>
          <span className="text-white font-mono font-medium">{formatCurrency(price)}</span>
        </div>
      </div>
    </Card>
  )
}

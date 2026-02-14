import { useGoldPrice } from '../../hooks/useGoldPrice'
import { formatCurrency } from '../../lib/format'
import { PercentChange } from '../shared/PercentChange'
import { Skeleton } from '../shared/SkeletonLoader'
import { Badge } from '../shared/Badge'

export function GoldPriceTicker() {
  const { data: gold, isLoading } = useGoldPrice()

  if (isLoading) {
    return (
      <div className="bg-gradient-to-r from-gold-900/30 to-gold-800/10 border border-gold-700/30 rounded-xl p-6">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-12 w-48 mb-2" />
        <Skeleton className="h-5 w-24" />
      </div>
    )
  }

  if (!gold) return null

  const isOpen = gold.marketState === 'REGULAR'

  return (
    <div className="bg-gradient-to-r from-gold-900/30 to-gold-800/10 border border-gold-700/30 rounded-xl p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gold-300/70 font-medium">Gold Spot (GC=F)</span>
        <Badge variant={isOpen ? 'success' : 'neutral'}>
          {isOpen ? 'Market Open' : 'Market Closed'}
        </Badge>
      </div>
      <div className="flex items-baseline gap-4">
        <span className="text-4xl font-bold text-gold-300">{formatCurrency(gold.price)}</span>
        <div className="flex items-center gap-2">
          <span className={gold.change >= 0 ? 'text-green-400' : 'text-red-400'}>
            {gold.change >= 0 ? '+' : ''}{formatCurrency(gold.change)}
          </span>
          <PercentChange value={gold.changePercent} />
        </div>
      </div>
      <div className="flex gap-6 mt-3 text-sm text-gray-400">
        <span>High: {formatCurrency(gold.dayHigh)}</span>
        <span>Low: {formatCurrency(gold.dayLow)}</span>
      </div>
    </div>
  )
}

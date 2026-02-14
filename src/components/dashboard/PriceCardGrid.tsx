import { useBatchQuotes } from '../../hooks/useBatchQuotes'
import { ALL_ETFS } from '../../lib/constants'
import { PriceCard } from './PriceCard'
import { CardSkeleton } from '../shared/SkeletonLoader'

export function PriceCardGrid() {
  const { data: quotes, isLoading } = useBatchQuotes([...ALL_ETFS])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 9 }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (!quotes) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {quotes.map((q) => (
        <PriceCard key={q.symbol} quote={q} />
      ))}
    </div>
  )
}

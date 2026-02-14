import type { Quote } from '../../types'
import { formatCurrency, formatVolume } from '../../lib/format'
import { PercentChange } from '../shared/PercentChange'
import { Card } from '../shared/Card'
import { ETF_COLORS, GOLD_ETFS } from '../../lib/constants'
import clsx from 'clsx'

interface PriceCardProps {
  quote: Quote
}

export function PriceCard({ quote }: PriceCardProps) {
  const isGold = (GOLD_ETFS as readonly string[]).includes(quote.symbol)
  const color = ETF_COLORS[quote.symbol] || '#9ca3af'

  return (
    <Card className="p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="font-semibold text-white">{quote.symbol}</span>
          </div>
          <span className={clsx('text-xs', isGold ? 'text-gold-400/60' : 'text-blue-400/60')}>
            {quote.shortName}
          </span>
        </div>
        <PercentChange value={quote.changePercent} className="text-sm" />
      </div>
      <div className="text-2xl font-bold text-white mb-1">
        {formatCurrency(quote.price)}
      </div>
      <div className="text-xs text-gray-500">
        Vol: {formatVolume(quote.volume)}
      </div>
    </Card>
  )
}

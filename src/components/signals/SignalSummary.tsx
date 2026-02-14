import { Card } from '../shared/Card'
import type { SignalStrength } from '../../lib/technical-indicators'
import clsx from 'clsx'

interface SignalSummaryProps {
  signal: SignalStrength
  crossType?: 'golden_cross' | 'death_cross' | null
}

const signalConfig: Record<SignalStrength, { label: string; color: string; bg: string }> = {
  strong_buy: { label: 'Strong Buy', color: 'text-green-300', bg: 'bg-green-500/20 border-green-500/30' },
  buy: { label: 'Buy', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
  neutral: { label: 'Neutral', color: 'text-gray-300', bg: 'bg-gray-500/10 border-gray-500/20' },
  sell: { label: 'Sell', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  strong_sell: { label: 'Strong Sell', color: 'text-red-300', bg: 'bg-red-500/20 border-red-500/30' },
}

const levels: SignalStrength[] = ['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy']

export function SignalSummary({ signal, crossType }: SignalSummaryProps) {
  const config = signalConfig[signal]

  return (
    <Card className={clsx('p-4 border', config.bg)}>
      <h3 className="text-sm font-medium text-white mb-3">Aggregated Signal</h3>
      <div className="text-center mb-4">
        <span className={clsx('text-3xl font-bold', config.color)}>{config.label}</span>
      </div>
      <div className="flex items-center gap-1 mb-4">
        {levels.map((level) => (
          <div
            key={level}
            className={clsx(
              'h-2 flex-1 rounded-full transition-colors',
              level === signal ? 'opacity-100' : 'opacity-20',
              level === 'strong_buy' || level === 'buy' ? 'bg-green-500' :
              level === 'neutral' ? 'bg-gray-500' : 'bg-red-500'
            )}
          />
        ))}
      </div>
      {crossType && (
        <div className={clsx(
          'text-xs font-medium text-center px-3 py-1.5 rounded-lg',
          crossType === 'golden_cross'
            ? 'bg-gold-500/10 text-gold-400'
            : 'bg-red-500/10 text-red-400'
        )}>
          {crossType === 'golden_cross' ? 'Golden Cross detected (SMA-50 > SMA-200)' : 'Death Cross detected (SMA-50 < SMA-200)'}
        </div>
      )}
    </Card>
  )
}

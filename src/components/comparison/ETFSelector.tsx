import clsx from 'clsx'
import { GOLD_ETFS, MARKET_ETFS, ETF_COLORS } from '../../lib/constants'

interface ETFSelectorProps {
  selected: string[]
  onChange: (symbols: string[]) => void
}

export function ETFSelector({ selected, onChange }: ETFSelectorProps) {
  const toggle = (symbol: string) => {
    if (selected.includes(symbol)) {
      onChange(selected.filter((s) => s !== symbol))
    } else {
      onChange([...selected, symbol])
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs text-gold-400/60 font-medium uppercase tracking-wider">Gold ETFs</span>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {GOLD_ETFS.map((symbol) => (
            <button
              key={symbol}
              onClick={() => toggle(symbol)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                selected.includes(symbol)
                  ? 'border-gold-500/40 bg-gold-500/10 text-gold-300'
                  : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:border-gray-600'
              )}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-2"
                style={{ backgroundColor: ETF_COLORS[symbol] }}
              />
              {symbol}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="text-xs text-blue-400/60 font-medium uppercase tracking-wider">Broad Market</span>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {MARKET_ETFS.map((symbol) => (
            <button
              key={symbol}
              onClick={() => toggle(symbol)}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                selected.includes(symbol)
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                  : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:border-gray-600'
              )}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-2"
                style={{ backgroundColor: ETF_COLORS[symbol] }}
              />
              {symbol}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

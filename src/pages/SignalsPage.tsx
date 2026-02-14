import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useTechnicalIndicators } from '../hooks/useTechnicalIndicators'
import { RSIGauge } from '../components/signals/RSIGauge'
import { MovingAveragePanel } from '../components/signals/MovingAveragePanel'
import { SignalSummary } from '../components/signals/SignalSummary'
import { IndicatorChart } from '../components/signals/IndicatorChart'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { LoadingState } from '../components/shared/Spinner'
import { ALL_ETFS, ETF_COLORS } from '../lib/constants'
import clsx from 'clsx'

export default function SignalsPage() {
  const { symbol: urlSymbol } = useParams<{ symbol: string }>()
  const [selected, setSelected] = useState(urlSymbol || 'GLD')
  const { indicators, isLoading } = useTechnicalIndicators(selected)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Technical Signals</h1>
        <p className="text-sm text-gray-400">RSI, moving averages, and signal analysis</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ALL_ETFS.map((sym) => (
          <button
            key={sym}
            onClick={() => setSelected(sym)}
            className={clsx(
              'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
              selected === sym
                ? 'border-gold-500/40 bg-gold-500/10 text-gold-300'
                : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white hover:border-gray-600'
            )}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: ETF_COLORS[sym] }}
            />
            {sym}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : indicators ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ErrorBoundary>
              <RSIGauge value={indicators.latestRSI} />
            </ErrorBoundary>
            <ErrorBoundary>
              <MovingAveragePanel
                price={indicators.latestPrice}
                sma50={indicators.latestSMA50}
                sma200={indicators.latestSMA200}
                ema12={indicators.latestEMA12}
                ema26={indicators.latestEMA26}
              />
            </ErrorBoundary>
            <ErrorBoundary>
              <SignalSummary
                signal={indicators.aggregatedSignal}
                crossType={indicators.recentCross?.type}
              />
            </ErrorBoundary>
          </div>

          <ErrorBoundary>
            <IndicatorChart
              ohlcv={indicators.ohlcv}
              sma50={indicators.sma50}
              sma200={indicators.sma200}
              ema12={indicators.ema12}
              ema26={indicators.ema26}
              rsi={indicators.rsi}
            />
          </ErrorBoundary>
        </>
      ) : (
        <p className="text-gray-500 text-center py-12">No data available for {selected}</p>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { useHistorical } from './useHistorical'
import {
  calculateRSI,
  calculateSMA,
  calculateEMA,
  detectCrosses,
  getSignalFromRSI,
  getSignalFromMA,
  aggregateSignals,
  type SignalStrength,
} from '../lib/technical-indicators'

export function useTechnicalIndicators(symbol: string) {
  const { data: ohlcv, isLoading, error } = useHistorical(symbol, '1Y')

  const indicators = useMemo(() => {
    if (!ohlcv || ohlcv.length === 0) return null

    const closes = ohlcv.map((d) => d.close)
    const rsi = calculateRSI(closes, 14)
    const sma50 = calculateSMA(closes, 50)
    const sma200 = calculateSMA(closes, 200)
    const ema12 = calculateEMA(closes, 12)
    const ema26 = calculateEMA(closes, 26)

    const latestRSI = rsi[rsi.length - 1]
    const latestSMA50 = sma50[sma50.length - 1]
    const latestSMA200 = sma200[sma200.length - 1]
    const latestEMA12 = ema12[ema12.length - 1]
    const latestEMA26 = ema26[ema26.length - 1]
    const latestPrice = closes[closes.length - 1]

    const crosses = detectCrosses(sma50, sma200)
    const recentCross = crosses.length > 0 ? crosses[crosses.length - 1] : null

    const signals: SignalStrength[] = []
    if (latestRSI != null) signals.push(getSignalFromRSI(latestRSI))
    if (latestSMA50 != null) signals.push(getSignalFromMA(latestPrice, latestSMA50))
    if (latestSMA200 != null) signals.push(getSignalFromMA(latestPrice, latestSMA200))
    if (latestEMA12 != null) signals.push(getSignalFromMA(latestPrice, latestEMA12))
    if (latestEMA26 != null) signals.push(getSignalFromMA(latestPrice, latestEMA26))

    return {
      rsi,
      sma50,
      sma200,
      ema12,
      ema26,
      latestRSI,
      latestSMA50,
      latestSMA200,
      latestEMA12,
      latestEMA26,
      latestPrice,
      recentCross,
      aggregatedSignal: signals.length > 0 ? aggregateSignals(signals) : ('neutral' as SignalStrength),
      ohlcv,
    }
  }, [ohlcv])

  return { indicators, isLoading, error }
}

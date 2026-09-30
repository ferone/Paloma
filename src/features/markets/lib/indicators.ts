// Technical indicators on close series. Outputs are aligned with the input
// (null until enough history exists).

export function sma(data: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i]
    if (i >= period) sum -= data[i - period]
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(data: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) out.push(null)
    else if (i === period - 1) {
      prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period
      out.push(prev)
    } else {
      prev = (data[i] - (prev as number)) * k + (prev as number)
      out.push(prev)
    }
  }
  return out
}

/** Wilder's RSI (the standard definition): smoothed average gain/loss. */
export function rsi(data: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = data.map(() => null)
  if (data.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = data[i] - data[i - 1]
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss))
  out[period] = value()
  for (let i = period + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = value()
  }
  return out
}

export type Signal = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell'

export const SIGNAL_LABEL: Record<Signal, string> = {
  strong_buy: 'Strong buy',
  buy: 'Buy',
  neutral: 'Neutral',
  sell: 'Sell',
  strong_sell: 'Strong sell',
}

/** RSI ≤ 30 oversold (buy), ≥ 70 overbought (sell); 20/80 are the strong bands. */
export function signalFromRsi(value: number): Signal {
  if (value <= 20) return 'strong_buy'
  if (value <= 30) return 'buy'
  if (value >= 80) return 'strong_sell'
  if (value >= 70) return 'sell'
  return 'neutral'
}

/** Trend-following read of price vs a moving average; ±5% are the strong bands. */
export function signalFromMa(price: number, ma: number): Signal {
  const diff = (price - ma) / ma
  if (diff > 0.05) return 'strong_buy'
  if (diff > 0) return 'buy'
  if (diff < -0.05) return 'strong_sell'
  if (diff < 0) return 'sell'
  return 'neutral'
}

export const SIGNAL_SCORE: Record<Signal, number> = { strong_buy: 2, buy: 1, neutral: 0, sell: -1, strong_sell: -2 }

export function aggregateSignals(signals: Signal[]): Signal {
  if (signals.length === 0) return 'neutral'
  const avg = signals.reduce((s, x) => s + SIGNAL_SCORE[x], 0) / signals.length
  if (avg >= 1.5) return 'strong_buy'
  if (avg >= 0.5) return 'buy'
  if (avg <= -1.5) return 'strong_sell'
  if (avg <= -0.5) return 'sell'
  return 'neutral'
}

export type Cross = { index: number; type: 'golden_cross' | 'death_cross' }

/** Indices where the short MA crosses the long MA. */
export function detectCrosses(short: (number | null)[], long: (number | null)[]): Cross[] {
  const out: Cross[] = []
  for (let i = 1; i < short.length; i++) {
    const ps = short[i - 1]
    const cs = short[i]
    const pl = long[i - 1]
    const cl = long[i]
    if (ps == null || cs == null || pl == null || cl == null) continue
    if (ps <= pl && cs > cl) out.push({ index: i, type: 'golden_cross' })
    else if (ps >= pl && cs < cl) out.push({ index: i, type: 'death_cross' })
  }
  return out
}

export function last<T>(xs: (T | null)[]): T | null {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]
  return null
}

export function calculateSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      const slice = data.slice(i - period + 1, i + 1)
      result.push(slice.reduce((a, b) => a + b, 0) / period)
    }
  }
  return result
}

export function calculateEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  const multiplier = 2 / (period + 1)

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else if (i === period - 1) {
      const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period
      result.push(sma)
    } else {
      const prev = result[i - 1]!
      result.push((data[i] - prev) * multiplier + prev)
    }
  }
  return result
}

export function calculateRSI(data: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = []
  const changes: number[] = []

  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1])
  }

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push(null)
      continue
    }

    const recentChanges = changes.slice(i - period, i)
    let avgGain = 0
    let avgLoss = 0

    for (const c of recentChanges) {
      if (c > 0) avgGain += c
      else avgLoss += Math.abs(c)
    }

    avgGain /= period
    avgLoss /= period

    if (avgLoss === 0) {
      result.push(100)
    } else {
      const rs = avgGain / avgLoss
      result.push(100 - 100 / (1 + rs))
    }
  }
  return result
}

export type SignalStrength = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell'

export function getSignalFromRSI(rsi: number): SignalStrength {
  if (rsi <= 20) return 'strong_buy'
  if (rsi <= 30) return 'buy'
  if (rsi >= 80) return 'strong_sell'
  if (rsi >= 70) return 'sell'
  return 'neutral'
}

export function getSignalFromMA(price: number, ma: number): SignalStrength {
  const diff = ((price - ma) / ma) * 100
  if (diff > 5) return 'strong_buy'
  if (diff > 0) return 'buy'
  if (diff < -5) return 'strong_sell'
  if (diff < 0) return 'sell'
  return 'neutral'
}

export function detectCrosses(
  shortMA: (number | null)[],
  longMA: (number | null)[]
): { index: number; type: 'golden_cross' | 'death_cross' }[] {
  const crosses: { index: number; type: 'golden_cross' | 'death_cross' }[] = []
  for (let i = 1; i < shortMA.length; i++) {
    const prev_s = shortMA[i - 1]
    const curr_s = shortMA[i]
    const prev_l = longMA[i - 1]
    const curr_l = longMA[i]
    if (prev_s == null || curr_s == null || prev_l == null || curr_l == null) continue
    if (prev_s <= prev_l && curr_s > curr_l) crosses.push({ index: i, type: 'golden_cross' })
    if (prev_s >= prev_l && curr_s < curr_l) crosses.push({ index: i, type: 'death_cross' })
  }
  return crosses
}

export function aggregateSignals(signals: SignalStrength[]): SignalStrength {
  const scores: Record<SignalStrength, number> = {
    strong_buy: 2,
    buy: 1,
    neutral: 0,
    sell: -1,
    strong_sell: -2,
  }
  const avg = signals.reduce((sum, s) => sum + scores[s], 0) / signals.length
  if (avg >= 1.5) return 'strong_buy'
  if (avg >= 0.5) return 'buy'
  if (avg <= -1.5) return 'strong_sell'
  if (avg <= -0.5) return 'sell'
  return 'neutral'
}

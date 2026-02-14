export function calculateCAGR(startValue: number, endValue: number, years: number): number {
  if (years <= 0 || startValue <= 0) return 0
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100
}

export function calculateMaxDrawdown(values: number[]): number {
  let peak = values[0]
  let maxDD = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = ((peak - v) / peak) * 100
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252) * 100 // annualized
}

export function calculateSharpeRatio(returns: number[], riskFreeRate = 0.05): number {
  const annualReturn = returns.reduce((a, b) => a + b, 0) / returns.length * 252
  const vol = calculateVolatility(returns) / 100
  if (vol === 0) return 0
  return (annualReturn - riskFreeRate) / vol
}

export function calculateDailyReturns(prices: number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
  }
  return returns
}

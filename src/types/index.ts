export interface Quote {
  symbol: string
  shortName: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  dayHigh: number
  dayLow: number
  volume: number
  marketState: string
  timestamp: number
}

export interface OHLCV {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TechnicalSignal {
  name: string
  value: number
  signal: 'buy' | 'sell' | 'neutral'
}

export interface PortfolioAllocation {
  symbol: string
  weight: number
}

export interface SimulationResult {
  totalReturn: number
  cagr: number
  maxDrawdown: number
  sharpeRatio: number
  volatility: number
  data: { date: string; value: number }[]
}

export interface LiquiditySource {
  name: string
  value: number
  percent: number
  color: string
}

export interface InstrumentVolume {
  symbol: string
  name: string
  volume: number
  dollarVolume: number
  price: number
}

export interface CountryDemand {
  country: string
  flag: string
  volume: number
  percent: number
  breakdown: { type: string; percent: number; color: string }[]
}

export interface RegionData {
  region: string
  percent: number
  color: string
  countries: CountryDemand[]
}

export interface GoldLiquidity {
  totalDollarVolume: number
  sources: LiquiditySource[]
  instruments: InstrumentVolume[]
  regions: RegionData[]
  history: { date: string; volume: number }[]
  timestamp: number
}

export interface ComparisonReturn {
  symbol: string
  '1D': number
  '1W': number
  '1M': number
  '3M': number
  '6M': number
  YTD: number
  '1Y': number
}

// Liquidity History types

export interface LiquidityHistoryDay {
  date: string
  totalVolume: number
  institutional: number
  centralBanks: number
  privateRetail: number
  jewelry: number
  mining: number
}

export interface LiquiditySummary {
  totalVolume: number
  avgDailyVolume: number
  tradingDays: number
  perSource: {
    institutional: number
    centralBanks: number
    privateRetail: number
    jewelry: number
    mining: number
  }
}

export interface LiquidityHistoryResponse {
  history: LiquidityHistoryDay[]
  summary: LiquiditySummary
  regions: RegionData[]
  range: string
  timestamp: number
}

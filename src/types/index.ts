// @deprecated Kept only for the pre-redesign simulator (src/pages/SimulatorPage,
// src/components/simulator), which the portfolio workstream is replacing.
// Market types live in shared/markets.ts. Delete once the simulator is gone.
export type { OHLCV, Quote } from '@shared/markets'

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

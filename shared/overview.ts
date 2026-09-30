import type { MacroDashboardLite, MlPredictionsLite, PortfolioSummaryLite, QuantSnapshotLite } from './artifacts.js'

export interface Published<T> {
  data: T
  generatedAt: string
}

export interface MarketTick {
  symbol: string
  label: string
  price: number
  change: number
  changePercent: number
  marketState: string
}

/** GET /api/overview — everything the landing page needs in one request. */
export interface OverviewResponse {
  asOf: string
  markets: MarketTick[]
  portfolio: Published<PortfolioSummaryLite> | null
  quant: Published<QuantSnapshotLite> | null
  ml: Published<MlPredictionsLite> | null
  macro: Published<MacroDashboardLite> | null
}

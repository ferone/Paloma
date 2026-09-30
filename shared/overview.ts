import type { MacroDashboardLite, MlPredictionsLite, PortfolioSummaryLite, QuantSnapshotLite } from './artifacts.js'
import { ASSETS, UNIVERSE, type AssetId, type RelativeValuePair } from './universe.js'

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

/** Symbol an asset is quoted by on the market strip: its 24/7 display quote when it has one, else its reference series. */
export function stripSymbol(asset: AssetId): string {
  return UNIVERSE[asset].displaySpot ?? UNIVERSE[asset].spot
}

/** Market-strip entries for every asset in the universe, in universe order. */
export function assetTicks(): { symbol: string; label: string }[] {
  return ASSETS.map((a) => ({ symbol: stripSymbol(a), label: UNIVERSE[a].label }))
}

/** Relative-value tile: num/den from the strip quotes, with its unit caption ("oz silver per oz gold"). */
export function pairRatio(pair: RelativeValuePair, markets: Pick<MarketTick, 'symbol' | 'price'>[]): { ratio: number | null; caption: string } {
  const num = markets.find((m) => m.symbol === stripSymbol(pair.numerator))
  const den = markets.find((m) => m.symbol === stripSymbol(pair.denominator))
  const n = UNIVERSE[pair.numerator]
  const d = UNIVERSE[pair.denominator]
  return {
    ratio: num && den && den.price > 0 ? num.price / den.price : null,
    caption: `${d.priceUnit} ${d.label.toLowerCase()} per ${n.priceUnit} ${n.label.toLowerCase()}`,
  }
}

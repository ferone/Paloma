import { Router } from 'express'
import { ARTIFACTS, type MacroDashboardLite, type MlPredictionsLite, type PortfolioSummaryLite, type QuantSnapshotLite } from '../../shared/artifacts.js'
import { assetTicks, type MarketTick, type OverviewResponse } from '../../shared/overview.js'
import { MACRO_SYMBOLS } from '../../shared/universe.js'
import { readArtifact } from '../db/repo.js'
import { getBatchQuotes } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'

// Landing-page aggregate: live market strip + the summaries each domain publishes
// as artifacts. Reads only — never recomputes another domain's state.
export const router = Router()

// Every universe asset, then the macro references.
const STRIP: { symbol: string; label: string }[] = [
  ...assetTicks(),
  { symbol: MACRO_SYMBOLS.dxy, label: 'Dollar index' },
  { symbol: MACRO_SYMBOLS.us10y, label: 'US 10y yield' },
  { symbol: MACRO_SYMBOLS.vix, label: 'VIX' },
  { symbol: MACRO_SYMBOLS.spx, label: 'S&P 500 (SPY)' },
]

router.get('/', cacheMiddleware('quote'), async (_req, res) => {
  const quotes = await getBatchQuotes(STRIP.map((s) => s.symbol)).catch(() => [])
  const markets: MarketTick[] = STRIP.flatMap((s) => {
    const q = quotes.find((x) => x.symbol === s.symbol)
    return q
      ? [{ symbol: s.symbol, label: s.label, price: q.price, change: q.change, changePercent: q.changePercent, marketState: q.marketState }]
      : []
  })

  const body: OverviewResponse = {
    asOf: new Date().toISOString(),
    markets,
    portfolio: readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary),
    quant: readArtifact<QuantSnapshotLite>(ARTIFACTS.quantSnapshot),
    ml: readArtifact<MlPredictionsLite>(ARTIFACTS.mlPredictions),
    macro: readArtifact<MacroDashboardLite>(ARTIFACTS.macroDashboard),
  }
  res.json(body)
})

import type { Express } from 'express'
import { quotesRouter } from './quotes.js'
import { batchRouter } from './batch.js'
import { historicalRouter } from './historical.js'
import { goldPriceRouter } from './gold-price.js'
import { goldLiquidityRouter } from './gold-liquidity.js'
import { goldLiquidityHistoryRouter } from './gold-liquidity-history.js'
import { router as portfolioRouter } from '../portfolio/router.js'
import { router as quantRouter } from '../quant/router.js'
import { router as marketdataRouter } from '../marketdata/router.js'
import { router as macroRouter } from '../macro/router.js'
import { router as aiRouter } from '../ai/router.js'
import { router as mlRouter } from '../ml/router.js'
import { router as jobsRouter } from '../jobs/router.js'
import { integrationStatus } from '../lib/env.js'

// Single place where every API surface is mounted. Each domain owns its router
// file; adding a domain = one import + one line here.
export function mountRoutes(app: Express): void {
  // Live market proxies (Yahoo Finance)
  app.use('/api/quotes', quotesRouter)
  app.use('/api/batch', batchRouter)
  app.use('/api/historical', historicalRouter)
  app.use('/api/gold-price', goldPriceRouter)
  app.use('/api/gold-liquidity/history', goldLiquidityHistoryRouter)
  app.use('/api/gold-liquidity', goldLiquidityRouter)

  // Domains
  app.use('/api/portfolio', portfolioRouter)
  app.use('/api/quant', quantRouter)
  app.use('/api/marketdata', marketdataRouter)
  app.use('/api/macro', macroRouter)
  app.use('/api/ai', aiRouter)
  app.use('/api/ml', mlRouter)
  app.use('/api/jobs', jobsRouter)

  app.get('/api/status', (_req, res) => {
    res.json(integrationStatus())
  })

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })
}

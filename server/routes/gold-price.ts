import { Router } from 'express'
import { getQuote } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'

export const goldPriceRouter = Router()

goldPriceRouter.get('/', cacheMiddleware('gold'), async (_req, res) => {
  try {
    const data = await getQuote('GC=F')
    res.json(data)
  } catch (err) {
    console.error('Gold price error:', err)
    res.status(500).json({ error: 'Failed to fetch gold price' })
  }
})

import { Router } from 'express'
import { getBatchQuotes } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'

export const batchRouter = Router()

batchRouter.get('/', cacheMiddleware('quote'), async (req, res) => {
  try {
    const symbols = (req.query.symbols as string || '').split(',').filter(Boolean)
    if (symbols.length === 0) {
      res.status(400).json({ error: 'symbols query param required' })
      return
    }
    const data = await getBatchQuotes(symbols)
    res.json(data)
  } catch (err) {
    console.error('Batch error:', err)
    res.status(500).json({ error: 'Failed to fetch batch quotes' })
  }
})

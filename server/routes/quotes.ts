import { Router } from 'express'
import { getQuote } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'

export const quotesRouter = Router()

quotesRouter.get('/:symbol', cacheMiddleware('quote'), async (req, res) => {
  try {
    const symbol = req.params.symbol as string
    const data = await getQuote(symbol)
    res.json(data)
  } catch (err) {
    console.error('Quote error:', err)
    res.status(500).json({ error: 'Failed to fetch quote' })
  }
})

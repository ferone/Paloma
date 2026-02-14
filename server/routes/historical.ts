import { Router } from 'express'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'

export const historicalRouter = Router()

const INTERVAL_MAP: Record<string, '1m' | '5m' | '15m' | '1d' | '1wk' | '1mo'> = {
  '1D': '5m',
  '1W': '15m',
  '1M': '1d',
  '3M': '1d',
  '6M': '1d',
  '1Y': '1d',
  '5Y': '1wk',
  ALL: '1mo',
}

historicalRouter.get('/:symbol', cacheMiddleware('daily'), async (req, res) => {
  try {
    const symbol = req.params.symbol as string
    const range = (req.query.range as string) || '1M'
    const interval = (req.query.interval as string) || INTERVAL_MAP[range] || '1d'
    const data = await getHistorical(symbol, {
      range,
      interval: interval as '1m' | '5m' | '15m' | '1d' | '1wk' | '1mo',
    })
    res.json(data)
  } catch (err) {
    console.error('Historical error:', err)
    res.status(500).json({ error: 'Failed to fetch historical data' })
  }
})

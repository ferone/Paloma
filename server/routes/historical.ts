import { Router } from 'express'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'
import { readDailyBars } from '../db/repo.js'

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
    if (range === 'MAX') {
      // Full daily history from the local DB (Yahoo closes stored by the history job);
      // fall back to Yahoo daily when the symbol has little stored history.
      const stored = readDailyBars(symbol, { source: 'yahoo' }).filter((b) => b.close > 0)
      if (stored.length >= 500) {
        return void res.json(
          stored.map((b) => ({ date: `${b.date}T00:00:00.000Z`, open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close, volume: b.volume ?? 0 })),
        )
      }
      return void res.json(await getHistorical(symbol, { range: 'ALL', interval: '1d' }))
    }
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

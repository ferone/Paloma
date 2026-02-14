import { Router } from 'express'
import { getBatchQuotes, getHistorical } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'
import {
  GOLD_INSTRUMENTS,
  INSTRUMENT_NAMES,
  SOURCE_BREAKDOWN,
  REGION_DATA,
} from '../data/gold-constants.js'

export const goldLiquidityRouter = Router()

goldLiquidityRouter.get('/', cacheMiddleware('gold'), async (_req, res) => {
  try {
    const quotes = await getBatchQuotes([...GOLD_INSTRUMENTS])

    const goldPrice = quotes.find((q) => q.symbol === 'GC=F')?.price ?? 0

    // Build instrument volumes
    const instruments = quotes.map((q) => {
      const multiplier = q.symbol === 'GC=F' ? 100 * goldPrice : q.price
      return {
        symbol: q.symbol,
        name: INSTRUMENT_NAMES[q.symbol] ?? q.shortName,
        volume: q.volume,
        dollarVolume: q.volume * multiplier,
        price: q.price,
      }
    })

    const totalDollarVolume = instruments.reduce((sum, i) => sum + i.dollarVolume, 0)

    // Source breakdown scaled to total dollar volume
    const sources = SOURCE_BREAKDOWN.map((s) => ({
      name: s.name,
      value: totalDollarVolume * (s.percent / 100),
      percent: s.percent,
      color: s.color,
    }))

    // Country-level data scaled to total dollar volume
    const regions = REGION_DATA.map((r) => ({
      region: r.region,
      percent: r.percent,
      color: r.color,
      countries: r.countries.map((c) => ({
        country: c.country,
        flag: c.flag,
        volume: totalDollarVolume * (c.percent / 100),
        percent: c.percent,
        breakdown: c.breakdown,
      })),
    }))

    // 30-day historical volume for GC=F
    const history = await getHistorical('GC=F', { range: '1M', interval: '1d' })
    const volumeHistory = history.map((d: { date: string; volume: number }) => ({
      date: d.date.split('T')[0],
      volume: d.volume,
    }))

    res.json({
      totalDollarVolume,
      sources,
      instruments,
      regions,
      history: volumeHistory,
      timestamp: Date.now(),
    })
  } catch (err) {
    console.error('Gold liquidity error:', err)
    res.status(500).json({ error: 'Failed to fetch gold liquidity data' })
  }
})

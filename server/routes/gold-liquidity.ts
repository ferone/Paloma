import { Router } from 'express'
import { getQuote, getBatchQuotes, getHistorical } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'

export const goldLiquidityRouter = Router()

const GOLD_INSTRUMENTS = ['GC=F', 'GLD', 'IAU', 'SGOL', 'GDX'] as const

const INSTRUMENT_NAMES: Record<string, string> = {
  'GC=F': 'COMEX Gold Futures',
  GLD: 'SPDR Gold Shares',
  IAU: 'iShares Gold Trust',
  SGOL: 'Aberdeen Gold ETF',
  GDX: 'VanEck Gold Miners',
}

// Source breakdown percentages based on World Gold Council demand data
// Central banks: ~1037t/yr (2023), Jewelry: ~2168t, Technology: ~298t,
// Investment (bars/coins + ETFs): ~945t, Mining supply: ~3644t
const SOURCE_BREAKDOWN = [
  { name: 'Institutional Investors', percent: 35, color: '#3b82f6' },
  { name: 'Central Banks', percent: 22, color: '#eab308' },
  { name: 'Private / Retail', percent: 18, color: '#10b981' },
  { name: 'Jewelry & Industrial', percent: 15, color: '#f59e0b' },
  { name: 'Mining & Supply', percent: 10, color: '#8b5cf6' },
]

goldLiquidityRouter.get('/', cacheMiddleware('gold'), async (_req, res) => {
  try {
    const quotes = await getBatchQuotes([...GOLD_INSTRUMENTS])

    const goldPrice = quotes.find((q) => q.symbol === 'GC=F')?.price ?? 0

    // Build instrument volumes
    const instruments = quotes.map((q) => {
      // GC=F: each contract = 100 troy oz
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

    // Estimate source breakdown scaled to total dollar volume
    const sources = SOURCE_BREAKDOWN.map((s) => ({
      name: s.name,
      value: totalDollarVolume * (s.percent / 100),
      percent: s.percent,
      color: s.color,
    }))

    // Get 30-day historical volume for GC=F
    const history = await getHistorical('GC=F', { range: '1M', interval: '1d' })
    const volumeHistory = history.map((d: { date: string; volume: number }) => ({
      date: d.date.split('T')[0],
      volume: d.volume,
    }))

    res.json({
      totalDollarVolume,
      sources,
      instruments,
      history: volumeHistory,
      timestamp: Date.now(),
    })
  } catch (err) {
    console.error('Gold liquidity error:', err)
    res.status(500).json({ error: 'Failed to fetch gold liquidity data' })
  }
})

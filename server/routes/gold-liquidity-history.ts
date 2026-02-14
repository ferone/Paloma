import { Router } from 'express'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { cacheMiddleware } from '../middleware/cache.js'
import {
  GOLD_INSTRUMENTS,
  SOURCE_BREAKDOWN,
  REGION_DATA,
} from '../data/gold-constants.js'

export const goldLiquidityHistoryRouter = Router()

type ChartInterval = '1d' | '1wk' | '1mo'

function getInterval(range: string): ChartInterval {
  if (range === '5Y') return '1wk'
  if (range === 'ALL') return '1mo'
  return '1d'
}

goldLiquidityHistoryRouter.get('/', cacheMiddleware('daily'), async (req, res) => {
  try {
    const range = (req.query.range as string) || '1Y'
    const interval = getInterval(range)

    // Fetch historical data for all gold instruments in parallel
    const results = await Promise.allSettled(
      GOLD_INSTRUMENTS.map((symbol) =>
        getHistorical(symbol, { range, interval })
      )
    )

    // Build a date-indexed map accumulating dollar volume
    const dateMap = new Map<string, number>()

    results.forEach((result, idx) => {
      if (result.status !== 'fulfilled') return
      const symbol = GOLD_INSTRUMENTS[idx]
      const rows = result.value as { date: string; close: number; volume: number }[]

      for (const row of rows) {
        const dateKey = row.date.split('T')[0]
        const dollarVolume =
          symbol === 'GC=F'
            ? row.volume * 100 * row.close
            : row.volume * row.close

        dateMap.set(dateKey, (dateMap.get(dateKey) ?? 0) + dollarVolume)
      }
    })

    // Convert to sorted array with source breakdown
    const sortedDates = [...dateMap.keys()].sort()
    const history = sortedDates.map((date) => {
      const totalVolume = dateMap.get(date)!
      return {
        date,
        totalVolume,
        institutional: totalVolume * (SOURCE_BREAKDOWN[0].percent / 100),
        centralBanks: totalVolume * (SOURCE_BREAKDOWN[1].percent / 100),
        privateRetail: totalVolume * (SOURCE_BREAKDOWN[2].percent / 100),
        jewelry: totalVolume * (SOURCE_BREAKDOWN[3].percent / 100),
        mining: totalVolume * (SOURCE_BREAKDOWN[4].percent / 100),
      }
    })

    // Range summary
    const totalVolume = history.reduce((sum, d) => sum + d.totalVolume, 0)
    const tradingDays = history.length
    const avgDailyVolume = tradingDays > 0 ? totalVolume / tradingDays : 0

    const summary = {
      totalVolume,
      avgDailyVolume,
      tradingDays,
      perSource: {
        institutional: totalVolume * (SOURCE_BREAKDOWN[0].percent / 100),
        centralBanks: totalVolume * (SOURCE_BREAKDOWN[1].percent / 100),
        privateRetail: totalVolume * (SOURCE_BREAKDOWN[2].percent / 100),
        jewelry: totalVolume * (SOURCE_BREAKDOWN[3].percent / 100),
        mining: totalVolume * (SOURCE_BREAKDOWN[4].percent / 100),
      },
    }

    // Scale region data to total range volume
    const regions = REGION_DATA.map((r) => ({
      region: r.region,
      percent: r.percent,
      color: r.color,
      countries: r.countries.map((c) => ({
        country: c.country,
        flag: c.flag,
        volume: totalVolume * (c.percent / 100),
        percent: c.percent,
        breakdown: c.breakdown,
      })),
    }))

    res.json({
      history,
      summary,
      regions,
      range,
      timestamp: Date.now(),
    })
  } catch (err) {
    console.error('Gold liquidity history error:', err)
    res.status(500).json({ error: 'Failed to fetch gold liquidity history' })
  }
})

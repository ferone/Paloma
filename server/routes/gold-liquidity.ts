import { Router } from 'express'
import { getBatchQuotes, getHistorical } from '../services/yahoo-finance.service.js'
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
const SOURCE_BREAKDOWN = [
  { name: 'Institutional Investors', percent: 35, color: '#3b82f6' },
  { name: 'Central Banks', percent: 22, color: '#eab308' },
  { name: 'Private / Retail', percent: 18, color: '#10b981' },
  { name: 'Jewelry & Industrial', percent: 15, color: '#f59e0b' },
  { name: 'Mining & Supply', percent: 10, color: '#8b5cf6' },
]

// Demand type colors used in country breakdowns
const DEMAND_COLORS = {
  'Central Bank': '#eab308',
  Investment: '#3b82f6',
  Jewelry: '#f59e0b',
  Technology: '#8b5cf6',
  'Bars & Coins': '#10b981',
  Mining: '#a855f7',
  Refining: '#06b6d4',
  Trading: '#6366f1',
}

// Country-level demand data based on World Gold Council Gold Demand Trends
// Percentages represent share of total global gold demand
const REGION_DATA = [
  {
    region: 'Asia Pacific',
    percent: 52,
    color: '#ef4444',
    countries: [
      {
        country: 'China',
        flag: '🇨🇳',
        percent: 24,
        breakdown: [
          { type: 'Jewelry', percent: 55, color: DEMAND_COLORS.Jewelry },
          { type: 'Central Bank', percent: 20, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Bars & Coins', percent: 18, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Technology', percent: 7, color: DEMAND_COLORS.Technology },
        ],
      },
      {
        country: 'India',
        flag: '🇮🇳',
        percent: 18,
        breakdown: [
          { type: 'Jewelry', percent: 65, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 20, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Central Bank', percent: 10, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Technology', percent: 5, color: DEMAND_COLORS.Technology },
        ],
      },
      {
        country: 'Thailand',
        flag: '🇹🇭',
        percent: 3,
        breakdown: [
          { type: 'Jewelry', percent: 60, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 40, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'Japan',
        flag: '🇯🇵',
        percent: 2.5,
        breakdown: [
          { type: 'Investment', percent: 50, color: DEMAND_COLORS.Investment },
          { type: 'Technology', percent: 35, color: DEMAND_COLORS.Technology },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'South Korea',
        flag: '🇰🇷',
        percent: 1.5,
        breakdown: [
          { type: 'Technology', percent: 45, color: DEMAND_COLORS.Technology },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 20, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Indonesia',
        flag: '🇮🇩',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 70, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 30, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'Vietnam',
        flag: '🇻🇳',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 55, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 45, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
    ],
  },
  {
    region: 'Europe',
    percent: 22,
    color: '#3b82f6',
    countries: [
      {
        country: 'Turkey',
        flag: '🇹🇷',
        percent: 5,
        breakdown: [
          { type: 'Jewelry', percent: 40, color: DEMAND_COLORS.Jewelry },
          { type: 'Central Bank', percent: 35, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Bars & Coins', percent: 25, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'Germany',
        flag: '🇩🇪',
        percent: 4,
        breakdown: [
          { type: 'Bars & Coins', percent: 60, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Investment', percent: 30, color: DEMAND_COLORS.Investment },
          { type: 'Technology', percent: 10, color: DEMAND_COLORS.Technology },
        ],
      },
      {
        country: 'United Kingdom',
        flag: '🇬🇧',
        percent: 4,
        breakdown: [
          { type: 'Trading', percent: 55, color: DEMAND_COLORS.Trading },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 10, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Switzerland',
        flag: '🇨🇭',
        percent: 3.5,
        breakdown: [
          { type: 'Refining', percent: 50, color: DEMAND_COLORS.Refining },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Poland',
        flag: '🇵🇱',
        percent: 2.5,
        breakdown: [
          { type: 'Central Bank', percent: 75, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Bars & Coins', percent: 25, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'France',
        flag: '🇫🇷',
        percent: 1.5,
        breakdown: [
          { type: 'Investment', percent: 50, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 30, color: DEMAND_COLORS.Jewelry },
          { type: 'Technology', percent: 20, color: DEMAND_COLORS.Technology },
        ],
      },
      {
        country: 'Czech Republic',
        flag: '🇨🇿',
        percent: 1.5,
        breakdown: [
          { type: 'Central Bank', percent: 85, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Investment', percent: 15, color: DEMAND_COLORS.Investment },
        ],
      },
    ],
  },
  {
    region: 'Americas',
    percent: 16,
    color: '#10b981',
    countries: [
      {
        country: 'United States',
        flag: '🇺🇸',
        percent: 10,
        breakdown: [
          { type: 'Investment', percent: 55, color: DEMAND_COLORS.Investment },
          { type: 'Technology', percent: 20, color: DEMAND_COLORS.Technology },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
          { type: 'Central Bank', percent: 10, color: DEMAND_COLORS['Central Bank'] },
        ],
      },
      {
        country: 'Canada',
        flag: '🇨🇦',
        percent: 2.5,
        breakdown: [
          { type: 'Mining', percent: 50, color: DEMAND_COLORS.Mining },
          { type: 'Investment', percent: 40, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 10, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Brazil',
        flag: '🇧🇷',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 45, color: DEMAND_COLORS.Jewelry },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Central Bank', percent: 20, color: DEMAND_COLORS['Central Bank'] },
        ],
      },
      {
        country: 'Mexico',
        flag: '🇲🇽',
        percent: 1,
        breakdown: [
          { type: 'Jewelry', percent: 50, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 35, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Mining', percent: 15, color: DEMAND_COLORS.Mining },
        ],
      },
      {
        country: 'Peru',
        flag: '🇵🇪',
        percent: 1,
        breakdown: [
          { type: 'Mining', percent: 80, color: DEMAND_COLORS.Mining },
          { type: 'Jewelry', percent: 20, color: DEMAND_COLORS.Jewelry },
        ],
      },
    ],
  },
  {
    region: 'Middle East & Africa',
    percent: 10,
    color: '#f59e0b',
    countries: [
      {
        country: 'Saudi Arabia',
        flag: '🇸🇦',
        percent: 2.5,
        breakdown: [
          { type: 'Jewelry', percent: 75, color: DEMAND_COLORS.Jewelry },
          { type: 'Investment', percent: 25, color: DEMAND_COLORS.Investment },
        ],
      },
      {
        country: 'UAE',
        flag: '🇦🇪',
        percent: 2,
        breakdown: [
          { type: 'Jewelry', percent: 50, color: DEMAND_COLORS.Jewelry },
          { type: 'Trading', percent: 35, color: DEMAND_COLORS.Trading },
          { type: 'Investment', percent: 15, color: DEMAND_COLORS.Investment },
        ],
      },
      {
        country: 'Egypt',
        flag: '🇪🇬',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 60, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 30, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Central Bank', percent: 10, color: DEMAND_COLORS['Central Bank'] },
        ],
      },
      {
        country: 'South Africa',
        flag: '🇿🇦',
        percent: 1.5,
        breakdown: [
          { type: 'Mining', percent: 70, color: DEMAND_COLORS.Mining },
          { type: 'Jewelry', percent: 20, color: DEMAND_COLORS.Jewelry },
          { type: 'Investment', percent: 10, color: DEMAND_COLORS.Investment },
        ],
      },
      {
        country: 'Ghana',
        flag: '🇬🇭',
        percent: 1,
        breakdown: [
          { type: 'Mining', percent: 85, color: DEMAND_COLORS.Mining },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Iran',
        flag: '🇮🇷',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 55, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 35, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Central Bank', percent: 10, color: DEMAND_COLORS['Central Bank'] },
        ],
      },
    ],
  },
]

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

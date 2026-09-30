// Shared gold market constants used by both liquidity endpoints

export const GOLD_INSTRUMENTS = ['GC=F', 'GLD', 'IAU', 'SGOL', 'GDX'] as const

export const INSTRUMENT_NAMES: Record<string, string> = {
  'GC=F': 'COMEX Gold Futures',
  GLD: 'SPDR Gold Shares',
  IAU: 'iShares Gold Trust',
  SGOL: 'Aberdeen Gold ETF',
  GDX: 'VanEck Gold Miners',
}

// Source breakdown percentages based on World Gold Council demand data
export const SOURCE_BREAKDOWN = [
  { name: 'Institutional Investors', percent: 35, color: '#3b82f6' },
  { name: 'Central Banks', percent: 22, color: '#eab308' },
  { name: 'Private / Retail', percent: 18, color: '#10b981' },
  { name: 'Jewelry & Industrial', percent: 15, color: '#f59e0b' },
  { name: 'Mining & Supply', percent: 10, color: '#8b5cf6' },
]

// Demand type colors used in country breakdowns
export const DEMAND_COLORS: Record<string, string> = {
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
export const REGION_DATA = [
  {
    region: 'Asia Pacific',
    percent: 52,
    color: '#ef4444',
    countries: [
      {
        country: 'China',
        flag: '\u{1F1E8}\u{1F1F3}',
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
        flag: '\u{1F1EE}\u{1F1F3}',
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
        flag: '\u{1F1F9}\u{1F1ED}',
        percent: 3,
        breakdown: [
          { type: 'Jewelry', percent: 60, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 40, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'Japan',
        flag: '\u{1F1EF}\u{1F1F5}',
        percent: 2.5,
        breakdown: [
          { type: 'Investment', percent: 50, color: DEMAND_COLORS.Investment },
          { type: 'Technology', percent: 35, color: DEMAND_COLORS.Technology },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'South Korea',
        flag: '\u{1F1F0}\u{1F1F7}',
        percent: 1.5,
        breakdown: [
          { type: 'Technology', percent: 45, color: DEMAND_COLORS.Technology },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 20, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Indonesia',
        flag: '\u{1F1EE}\u{1F1E9}',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 70, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 30, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'Vietnam',
        flag: '\u{1F1FB}\u{1F1F3}',
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
        flag: '\u{1F1F9}\u{1F1F7}',
        percent: 5,
        breakdown: [
          { type: 'Jewelry', percent: 40, color: DEMAND_COLORS.Jewelry },
          { type: 'Central Bank', percent: 35, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Bars & Coins', percent: 25, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'Germany',
        flag: '\u{1F1E9}\u{1F1EA}',
        percent: 4,
        breakdown: [
          { type: 'Bars & Coins', percent: 60, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Investment', percent: 30, color: DEMAND_COLORS.Investment },
          { type: 'Technology', percent: 10, color: DEMAND_COLORS.Technology },
        ],
      },
      {
        country: 'United Kingdom',
        flag: '\u{1F1EC}\u{1F1E7}',
        percent: 4,
        breakdown: [
          { type: 'Trading', percent: 55, color: DEMAND_COLORS.Trading },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 10, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Switzerland',
        flag: '\u{1F1E8}\u{1F1ED}',
        percent: 3.5,
        breakdown: [
          { type: 'Refining', percent: 50, color: DEMAND_COLORS.Refining },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Poland',
        flag: '\u{1F1F5}\u{1F1F1}',
        percent: 2.5,
        breakdown: [
          { type: 'Central Bank', percent: 75, color: DEMAND_COLORS['Central Bank'] },
          { type: 'Bars & Coins', percent: 25, color: DEMAND_COLORS['Bars & Coins'] },
        ],
      },
      {
        country: 'France',
        flag: '\u{1F1EB}\u{1F1F7}',
        percent: 1.5,
        breakdown: [
          { type: 'Investment', percent: 50, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 30, color: DEMAND_COLORS.Jewelry },
          { type: 'Technology', percent: 20, color: DEMAND_COLORS.Technology },
        ],
      },
      {
        country: 'Czech Republic',
        flag: '\u{1F1E8}\u{1F1FF}',
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
        flag: '\u{1F1FA}\u{1F1F8}',
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
        flag: '\u{1F1E8}\u{1F1E6}',
        percent: 2.5,
        breakdown: [
          { type: 'Mining', percent: 50, color: DEMAND_COLORS.Mining },
          { type: 'Investment', percent: 40, color: DEMAND_COLORS.Investment },
          { type: 'Jewelry', percent: 10, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Brazil',
        flag: '\u{1F1E7}\u{1F1F7}',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 45, color: DEMAND_COLORS.Jewelry },
          { type: 'Investment', percent: 35, color: DEMAND_COLORS.Investment },
          { type: 'Central Bank', percent: 20, color: DEMAND_COLORS['Central Bank'] },
        ],
      },
      {
        country: 'Mexico',
        flag: '\u{1F1F2}\u{1F1FD}',
        percent: 1,
        breakdown: [
          { type: 'Jewelry', percent: 50, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 35, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Mining', percent: 15, color: DEMAND_COLORS.Mining },
        ],
      },
      {
        country: 'Peru',
        flag: '\u{1F1F5}\u{1F1EA}',
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
        flag: '\u{1F1F8}\u{1F1E6}',
        percent: 2.5,
        breakdown: [
          { type: 'Jewelry', percent: 75, color: DEMAND_COLORS.Jewelry },
          { type: 'Investment', percent: 25, color: DEMAND_COLORS.Investment },
        ],
      },
      {
        country: 'UAE',
        flag: '\u{1F1E6}\u{1F1EA}',
        percent: 2,
        breakdown: [
          { type: 'Jewelry', percent: 50, color: DEMAND_COLORS.Jewelry },
          { type: 'Trading', percent: 35, color: DEMAND_COLORS.Trading },
          { type: 'Investment', percent: 15, color: DEMAND_COLORS.Investment },
        ],
      },
      {
        country: 'Egypt',
        flag: '\u{1F1EA}\u{1F1EC}',
        percent: 1.5,
        breakdown: [
          { type: 'Jewelry', percent: 60, color: DEMAND_COLORS.Jewelry },
          { type: 'Bars & Coins', percent: 30, color: DEMAND_COLORS['Bars & Coins'] },
          { type: 'Central Bank', percent: 10, color: DEMAND_COLORS['Central Bank'] },
        ],
      },
      {
        country: 'South Africa',
        flag: '\u{1F1FF}\u{1F1E6}',
        percent: 1.5,
        breakdown: [
          { type: 'Mining', percent: 70, color: DEMAND_COLORS.Mining },
          { type: 'Jewelry', percent: 20, color: DEMAND_COLORS.Jewelry },
          { type: 'Investment', percent: 10, color: DEMAND_COLORS.Investment },
        ],
      },
      {
        country: 'Ghana',
        flag: '\u{1F1EC}\u{1F1ED}',
        percent: 1,
        breakdown: [
          { type: 'Mining', percent: 85, color: DEMAND_COLORS.Mining },
          { type: 'Jewelry', percent: 15, color: DEMAND_COLORS.Jewelry },
        ],
      },
      {
        country: 'Iran',
        flag: '\u{1F1EE}\u{1F1F7}',
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

// ── Metal-aware instrument sets for /api/markets/liquidity ─────────────────
// Real, observable volumes only. The source/region splits above are modeled
// and exist for gold only; silver deliberately has no such split.

export interface LiquidityInstrumentDef {
  symbol: string
  name: string
  kind: 'future' | 'etf'
  /** Troy ounces per contract (futures only) for dollar volume. */
  ozPerContract?: number
  /**
   * false when Yahoo's daily history for this symbol is not usable for volume
   * (SI=F's continuous series follows thin delivery months, e.g. ~100 lots/day
   * while the Dec contract trades ~30k). Such symbols are left out of history.
   */
  historyReliable?: boolean
}

export const LIQUIDITY_INSTRUMENTS: Record<'gold' | 'silver', LiquidityInstrumentDef[]> = {
  gold: [
    { symbol: 'GC=F', name: 'COMEX Gold Futures (front)', kind: 'future', ozPerContract: 100 },
    { symbol: 'GLD', name: 'SPDR Gold Shares', kind: 'etf' },
    { symbol: 'IAU', name: 'iShares Gold Trust', kind: 'etf' },
    { symbol: 'GLDM', name: 'SPDR Gold MiniShares', kind: 'etf' },
    { symbol: 'SGOL', name: 'abrdn Physical Gold Shares', kind: 'etf' },
    { symbol: 'PHYS', name: 'Sprott Physical Gold Trust', kind: 'etf' },
  ],
  silver: [
    { symbol: 'SI=F', name: 'COMEX Silver Futures (front)', kind: 'future', ozPerContract: 5000, historyReliable: false },
    { symbol: 'SLV', name: 'iShares Silver Trust', kind: 'etf' },
    { symbol: 'SIVR', name: 'abrdn Physical Silver Shares', kind: 'etf' },
    { symbol: 'PSLV', name: 'Sprott Physical Silver Trust', kind: 'etf' },
  ],
}

/** Stable keys for SOURCE_BREAKDOWN rows (same order). */
export const SOURCE_KEYS = ['institutional', 'centralBanks', 'privateRetail', 'jewelry', 'mining'] as const

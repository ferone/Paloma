import type { MacroSeriesMeta } from '../../shared/macro.js'

// Every macro series the app stores in macro_series, with display metadata.
// FRED ids are fetched verbatim; derived ids are computed in service.ts.

const fredUrl = (id: string) => `https://fred.stlouisfed.org/series/${id}`

export const FRED_SERIES: MacroSeriesMeta[] = [
  {
    id: 'DFII10',
    label: '10y real yield',
    description:
      'Yield on 10-year inflation-protected Treasuries (TIPS): the return on a safe asset after inflation. Gold pays no yield, so a lower real yield lowers the opportunity cost of holding it.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('DFII10'),
  },
  {
    id: 'T10YIE',
    label: '10y breakeven inflation',
    description:
      'Nominal 10y yield minus the 10y TIPS yield: the inflation rate the bond market expects over the next decade. Rising breakevens usually coincide with demand for inflation hedges.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('T10YIE'),
  },
  {
    id: 'DGS10',
    label: '10y Treasury yield',
    description: 'Nominal 10-year constant-maturity Treasury yield.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('DGS10'),
  },
  {
    id: 'DGS2',
    label: '2y Treasury yield',
    description: 'Nominal 2-year constant-maturity Treasury yield; the most policy-sensitive point of the curve.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('DGS2'),
  },
  {
    id: 'DTWEXBGS',
    label: 'Broad trade-weighted dollar',
    description:
      'Federal Reserve nominal broad dollar index against 26 trading partners. Gold and silver are priced in dollars, so a stronger dollar tends to weigh on them.',
    unit: 'index',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('DTWEXBGS'),
  },
  {
    id: 'DFF',
    label: 'Fed funds (effective)',
    description: 'Effective federal funds rate: the overnight policy rate. Cuts lower cash yields and are typically supportive for precious metals.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('DFF'),
  },
  {
    id: 'CPIAUCSL',
    label: 'CPI (index level)',
    description: 'US consumer price index for all urban consumers, seasonally adjusted (1982–84 = 100).',
    unit: 'index',
    changeKind: 'pct',
    frequency: 'monthly',
    source: 'fred',
    url: fredUrl('CPIAUCSL'),
  },
  {
    id: 'M2SL',
    label: 'M2 money supply',
    description: 'US M2 money stock, seasonally adjusted, billions of dollars.',
    unit: 'usd_bn',
    changeKind: 'pct',
    frequency: 'monthly',
    source: 'fred',
    url: fredUrl('M2SL'),
  },
  {
    id: 'VIXCLS',
    label: 'VIX',
    description: 'CBOE volatility index: the 30-day implied volatility of the S&P 500, a gauge of equity-market stress.',
    unit: 'index',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('VIXCLS'),
  },
  {
    id: 'BAMLH0A0HYM2',
    label: 'High-yield credit spread',
    description:
      'ICE BofA US high-yield option-adjusted spread over Treasuries. Widening spreads signal credit stress and risk aversion.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('BAMLH0A0HYM2'),
  },
  {
    id: 'GVZCLS',
    label: 'Gold volatility (GVZ)',
    description: 'CBOE gold ETF volatility index: 30-day implied volatility of GLD options.',
    unit: 'index',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'fred',
    url: fredUrl('GVZCLS'),
  },
]

export const DERIVED_SERIES: MacroSeriesMeta[] = [
  {
    id: 'CPI_YOY',
    label: 'CPI inflation (YoY)',
    description: 'Year-over-year change in CPIAUCSL, computed from the monthly index level.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'monthly',
    source: 'derived',
    url: fredUrl('CPIAUCSL'),
  },
  {
    id: 'M2_YOY',
    label: 'M2 growth (YoY)',
    description: 'Year-over-year change in M2SL, computed from the monthly level.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'monthly',
    source: 'derived',
    url: fredUrl('M2SL'),
  },
  {
    id: 'CURVE_2S10S',
    label: '2s10s curve',
    description: '10y minus 2y Treasury yield. Negative = inverted curve (historically a recession warning).',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'daily',
    source: 'derived',
    url: null,
  },
  {
    id: 'GSR',
    label: 'Gold/silver ratio',
    description:
      'Ounces of silver needed to buy one ounce of gold (COMEX front-month closes GC=F / SI=F). A high ratio means silver is cheap relative to gold.',
    unit: 'ratio',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: 'https://finance.yahoo.com/quote/GC%3DF',
  },
  {
    id: 'DXY',
    label: 'US dollar index (DXY)',
    description: 'ICE US dollar index against six major currencies (Yahoo DX-Y.NYB).',
    unit: 'index',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: 'https://finance.yahoo.com/quote/DX-Y.NYB',
  },
]

/** Price series read from prices_daily (Yahoo), exposed through /api/macro/series. */
export const PRICE_SERIES: (MacroSeriesMeta & { symbol: string })[] = [
  {
    id: 'GOLD',
    symbol: 'GC=F',
    label: 'Gold (COMEX front)',
    description: 'COMEX gold front-month settlement proxy (Yahoo GC=F), $/oz.',
    unit: 'usd',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: 'https://finance.yahoo.com/quote/GC%3DF',
  },
  {
    id: 'SILVER',
    symbol: 'SI=F',
    label: 'Silver (COMEX front)',
    description: 'COMEX silver front-month settlement proxy (Yahoo SI=F), $/oz.',
    unit: 'usd',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: 'https://finance.yahoo.com/quote/SI%3DF',
  },
  {
    id: 'SPY',
    symbol: 'SPY',
    label: 'S&P 500 ETF (SPY)',
    description: 'SPDR S&P 500 ETF, a proxy for US equity risk appetite.',
    unit: 'usd',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: 'https://finance.yahoo.com/quote/SPY',
  },
]

export const ALL_SERIES: MacroSeriesMeta[] = [...FRED_SERIES, ...DERIVED_SERIES, ...PRICE_SERIES]

export function seriesMeta(id: string): MacroSeriesMeta | undefined {
  return ALL_SERIES.find((s) => s.id === id)
}

export const COT_MARKETS = {
  GOLD: { code: '088691', name: 'GOLD - COMMODITY EXCHANGE INC.' },
  SILVER: { code: '084691', name: 'SILVER - COMMODITY EXCHANGE INC.' },
} as const

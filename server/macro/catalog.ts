import { priceSeriesId, type MacroSeriesMeta } from '../../shared/macro.js'
import { ASSETS, RELATIVE_VALUE_PAIRS, UNIVERSE, type AssetClass, type AssetId, type PriceUnit, type RelativeValuePair } from '../../shared/universe.js'

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
  {
    id: 'INDPRO',
    label: 'Industrial production',
    description: 'US industrial production index (2017 = 100), seasonally adjusted: output of factories, mines and utilities.',
    unit: 'index',
    changeKind: 'pct',
    frequency: 'monthly',
    source: 'fred',
    url: fredUrl('INDPRO'),
  },
]

const yahooUrl = (symbol: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`

const UNIT_WORD: Record<PriceUnit, [string, string]> = { oz: ['ounce', 'Ounces'], lb: ['pound', 'Pounds'], BTC: ['bitcoin', 'Bitcoins'] }

/** Series id of a relative-value pair's price ratio (GS -> GSR). */
export const ratioSeriesId = (p: RelativeValuePair): string => `${p.id}R`

/** Display label of a pair ratio, e.g. "Gold/silver ratio". */
export const ratioLabel = (p: RelativeValuePair): string => `${UNIVERSE[p.numerator].label}/${UNIVERSE[p.denominator].label.toLowerCase()} ratio`

/** Catalog entry for a pair ratio: numerator / denominator reference closes (Yahoo). */
export function ratioSeriesMeta(p: RelativeValuePair): MacroSeriesMeta {
  const num = UNIVERSE[p.numerator]
  const den = UNIVERSE[p.denominator]
  const exNum = num.futures[0]?.exchange
  const venue = exNum && exNum === den.futures[0]?.exchange ? `${exNum} front-month closes` : 'reference closes'
  const numL = num.label.toLowerCase()
  const denL = den.label.toLowerCase()
  // "one ounce of gold", but "one bitcoin" (the unit already names the asset).
  const oneNum = UNIT_WORD[num.priceUnit][0] === numL ? `one ${numL}` : `one ${UNIT_WORD[num.priceUnit][0]} of ${numL}`
  const denQty = UNIT_WORD[den.priceUnit][1] === `${denL}s` || UNIT_WORD[den.priceUnit][1] === denL ? UNIT_WORD[den.priceUnit][1] : `${UNIT_WORD[den.priceUnit][1]} of ${denL}`
  return {
    id: ratioSeriesId(p),
    label: ratioLabel(p),
    description: `${denQty} needed to buy ${oneNum} (${venue} ${num.spot} / ${den.spot}). A high ratio means ${denL} is cheap relative to ${numL}.`,
    unit: 'ratio',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: yahooUrl(num.spot),
  }
}

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
  ...RELATIVE_VALUE_PAIRS.map(ratioSeriesMeta),
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
  {
    id: 'INDPRO_YOY',
    label: 'Industrial production growth (YoY)',
    description: 'Year-over-year change in INDPRO, computed from the monthly index level.',
    unit: 'percent',
    changeKind: 'diff',
    frequency: 'monthly',
    source: 'derived',
    url: fredUrl('INDPRO'),
  },
  {
    id: 'QQQ',
    label: 'Nasdaq-100 (QQQ)',
    description: 'Invesco QQQ, the Nasdaq-100 ETF: a proxy for growth and tech risk appetite, which crypto tends to trade with.',
    unit: 'usd',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: 'https://finance.yahoo.com/quote/QQQ',
  },
]

export { priceSeriesId }

function assetPriceSeries(a: AssetId): MacroSeriesMeta & { symbol: string } {
  const s = UNIVERSE[a]
  const exchange = s.futures[0]?.exchange
  const isFront = !!exchange && s.futures.some((f) => f.yahoo === s.spot)
  return {
    id: priceSeriesId(a),
    symbol: s.spot,
    label: isFront ? `${s.label} (${exchange} front)` : s.label,
    description: isFront
      ? `${exchange} ${s.label.toLowerCase()} front-month settlement proxy (Yahoo ${s.spot}), ${s.unitLabel}.`
      : `${s.label} reference price (Yahoo ${s.spot}), ${s.unitLabel}.`,
    unit: 'usd',
    changeKind: 'pct',
    frequency: 'daily',
    source: 'yahoo',
    url: yahooUrl(s.spot),
  }
}

/** Price series read from prices_daily (Yahoo), exposed through /api/macro/series: every asset in the universe, then SPY. */
export const PRICE_SERIES: (MacroSeriesMeta & { symbol: string })[] = [
  ...ASSETS.map(assetPriceSeries),
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

/**
 * Series only some asset classes need. Anything not listed applies to every
 * class. A class's series are fetched and shown only once an asset of that
 * class exists in the universe.
 */
export const SERIES_CLASSES: Record<string, AssetClass[]> = {
  INDPRO: ['industrial'],
  INDPRO_YOY: ['industrial'],
  QQQ: ['crypto'],
  // GLD implied vol: shown for precious metals only (ML declares its own gold+silver list).
  GVZCLS: ['precious'],
}

/** Asset classes present in the universe. */
export function activeClasses(): Set<AssetClass> {
  return new Set(ASSETS.map((a) => UNIVERSE[a].assetClass))
}

/** Whether a catalog series is relevant to an asset class. */
export function seriesForClass(id: string, cls: AssetClass): boolean {
  const only = SERIES_CLASSES[id]
  return !only || only.includes(cls)
}

/** Whether any asset in the universe needs the series (refresh jobs skip the rest). */
export function seriesActive(id: string): boolean {
  const only = SERIES_CLASSES[id]
  if (!only) return true
  const active = activeClasses()
  return only.some((c) => active.has(c))
}

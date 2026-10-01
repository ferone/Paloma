// Single source of truth for the tradable universe. Every domain (portfolio,
// quant, macro, ML, markets) is parameterized by `AssetId` and reads its
// instruments, units, sessions and data sources from here. Adding an asset is
// a data change: extend `AssetId`, add a `UNIVERSE` entry, done.

export type AssetId = 'gold' | 'silver' | 'platinum' | 'palladium' | 'copper' | 'btc'
export const ASSETS: readonly AssetId[] = ['gold', 'silver', 'platinum', 'palladium', 'copper', 'btc'] as const

/** @deprecated Use `AssetId`. Kept while domains migrate. */
export type Metal = AssetId
/** @deprecated Use `ASSETS`. Kept while domains migrate. */
export const METALS: readonly Metal[] = ASSETS

export type AssetClass = 'precious' | 'industrial' | 'crypto'
export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  precious: 'Precious metals',
  industrial: 'Industrial metals',
  crypto: 'Digital assets',
}

/** Unit the price is quoted per (and the unit exposure is measured in). */
export type PriceUnit = 'oz' | 'lb' | 'BTC'

/** When the reference market trades. `globex`: CME Sun 18:00 – Fri 17:00 ET. `24x7`: continuous. */
export type TradingSession = 'globex' | '24x7'

export type InstrumentKind = 'etf' | 'future' | 'physical' | 'cash' | 'equity'

export type Exchange = 'COMEX' | 'NYMEX' | 'CME'
const YAHOO_SUFFIX: Record<Exchange, string> = { COMEX: '.CMX', NYMEX: '.NYM', CME: '.CME' }

export interface FuturesProduct {
  /** Root used across the app and by Databento (`<root>.FUT` parent symbology). */
  root: string
  name: string
  exchange: Exchange
  /** Yahoo continuous front-month symbol for live quotes. */
  yahoo: string
  /** Units of the underlying per contract (oz, lb or BTC — see the asset's `priceUnit`). */
  contractSize: number
  /** Dollars per 1.00 price-point move. The ONLY dollar multiplier; never hardcode 100/5000. */
  pointValue: number
  /** Minimum price increment. */
  tickSize: number
  /** Liquid/active contract months (1-12). Serial months are ignored by curves and calendars. */
  activeMonths: number[]
  /** Months used for roll-clean seasonal pairs (defaults to `activeMonths`). */
  seasonalMonths?: number[]
  /** Cash-settled (no delivery / first notice): rolls key off last trade instead. */
  cashSettled: boolean
  /** @deprecated Troy ounces per contract; use `contractSize` + the asset's `priceUnit`. */
  ozPerContract: number
}

export interface PhysicalSpec {
  /** Unit holdings are counted in. */
  unit: 'oz' | 'BTC'
  /** `bullion`: bars/coins in a vault (fine oz, purity, serials). `custody`: a balance in a wallet/exchange account. */
  kind: 'bullion' | 'custody'
  /** Stable instrument id for the physical holding (e.g. XAU-PHYS). */
  instrumentId: string
}

export interface CotSpec {
  /** CFTC report family: disaggregated (commodities) or Traders in Financial Futures (financials, incl. bitcoin). */
  report: 'disagg' | 'tff'
  /** CFTC contract market code. */
  code: string
  /** Stable market key used in the cot tables and APIs. */
  market: string
}

/**
 * Cash-and-carry basis inputs: the asset's front CASH-SETTLED future against a
 * daily spot series, compared with a cash benchmark. Any asset with a spot
 * series and cash-settled futures can declare one; the quant engine then builds
 * the `<root>.basis` instrument (see `basisInstrumentId`).
 */
export interface CarryBasisSpec {
  /** Yahoo symbol of the spot series the future converges to (daily close, `prices_daily`). */
  spot: string
  /** Yahoo symbol of the cash benchmark, quoted in percent (e.g. `^IRX`, the 13-week T-bill). */
  rate: string
  /** Human name of the cash benchmark. */
  rateLabel: string
  /** Reference rate the futures settle to (named in caveats). */
  settlement: string
}

/** 13-week US T-bill discount yield (Yahoo, quoted in percent). */
export const TBILL_13W = '^IRX'

export interface AssetSpec {
  id: AssetId
  label: string
  /** Compact label for tickers and chips ("Au", "BTC"). */
  short: string
  assetClass: AssetClass
  /** Yahoo symbol of the reference price series (weekday bars; used for NAV, ML, correlations). */
  spot: string
  /** Optional 24/7 display quote (e.g. BTC-USD) shown in tickers; never used for calculations. */
  displaySpot?: string
  priceUnit: PriceUnit
  /** Human price unit, e.g. "$/oz". */
  unitLabel: string
  /** Decimals for prices of this asset. */
  displayDecimals: number
  session: TradingSession
  futures: FuturesProduct[]
  /** Physically backed / spot ETFs (holdings, premium/discount, flows). */
  etfs: string[]
  /** Miners/equity proxy ETF (beta proxy, not the asset). */
  miners?: string
  /** ETF used as the default benchmark for this asset. */
  benchmarkEtf: string
  /** How the fund can hold the asset directly; null when it cannot. */
  physical: PhysicalSpec | null
  cot: CotSpec | null
  /** Cash-and-carry basis (front cash-settled future vs spot); absent when the asset has none. */
  basis?: CarryBasisSpec
  /** CSS custom property holding this asset's chart colour. */
  colorVar: string

  /** @deprecated Use `id`. */
  metal: AssetId
  /** @deprecated Use `cot.market`. */
  cotMarket: string
}

export const UNIVERSE: Record<AssetId, AssetSpec> = {
  gold: {
    id: 'gold',
    metal: 'gold',
    label: 'Gold',
    short: 'Au',
    assetClass: 'precious',
    spot: 'GC=F',
    priceUnit: 'oz',
    unitLabel: '$/oz',
    displayDecimals: 2,
    session: 'globex',
    futures: [
      { root: 'GC', name: 'COMEX Gold', exchange: 'COMEX', yahoo: 'GC=F', contractSize: 100, pointValue: 100, tickSize: 0.1, activeMonths: [2, 4, 6, 8, 10, 12], cashSettled: false, ozPerContract: 100 },
      { root: 'MGC', name: 'COMEX Micro Gold', exchange: 'COMEX', yahoo: 'MGC=F', contractSize: 10, pointValue: 10, tickSize: 0.1, activeMonths: [2, 4, 6, 8, 10, 12], cashSettled: false, ozPerContract: 10 },
    ],
    etfs: ['GLD', 'IAU', 'GLDM', 'SGOL', 'PHYS'],
    miners: 'GDX',
    benchmarkEtf: 'GLD',
    physical: { unit: 'oz', kind: 'bullion', instrumentId: 'XAU-PHYS' },
    cot: { report: 'disagg', code: '088691', market: 'GOLD' },
    cotMarket: 'GOLD',
    colorVar: '--metal-gold',
  },
  silver: {
    id: 'silver',
    metal: 'silver',
    label: 'Silver',
    short: 'Ag',
    assetClass: 'precious',
    spot: 'SI=F',
    priceUnit: 'oz',
    unitLabel: '$/oz',
    displayDecimals: 3,
    session: 'globex',
    futures: [
      { root: 'SI', name: 'COMEX Silver', exchange: 'COMEX', yahoo: 'SI=F', contractSize: 5000, pointValue: 5000, tickSize: 0.005, activeMonths: [3, 5, 7, 9, 12], cashSettled: false, ozPerContract: 5000 },
      { root: 'SIL', name: 'COMEX Micro Silver', exchange: 'COMEX', yahoo: 'SIL=F', contractSize: 1000, pointValue: 1000, tickSize: 0.005, activeMonths: [3, 5, 7, 9, 12], cashSettled: false, ozPerContract: 1000 },
    ],
    etfs: ['SLV', 'SIVR', 'PSLV'],
    miners: 'SILJ',
    benchmarkEtf: 'SLV',
    physical: { unit: 'oz', kind: 'bullion', instrumentId: 'XAG-PHYS' },
    cot: { report: 'disagg', code: '084691', market: 'SILVER' },
    cotMarket: 'SILVER',
    colorVar: '--metal-silver',
  },
  platinum: {
    id: 'platinum',
    metal: 'platinum',
    label: 'Platinum',
    short: 'Pt',
    assetClass: 'precious',
    spot: 'PL=F',
    priceUnit: 'oz',
    unitLabel: '$/oz',
    displayDecimals: 2,
    session: 'globex',
    futures: [
      // NYMEX platinum: 50 troy oz, $0.10 tick ($5); liquid cycle Jan/Apr/Jul/Oct.
      { root: 'PL', name: 'NYMEX Platinum', exchange: 'NYMEX', yahoo: 'PL=F', contractSize: 50, pointValue: 50, tickSize: 0.1, activeMonths: [1, 4, 7, 10], cashSettled: false, ozPerContract: 50 },
    ],
    etfs: ['PPLT'],
    // No dedicated PGM miners ETF exists (Sibanye-Stillwater is a single stock), so no miners proxy.
    benchmarkEtf: 'PPLT',
    physical: { unit: 'oz', kind: 'bullion', instrumentId: 'XPT-PHYS' },
    cot: { report: 'disagg', code: '076651', market: 'PLATINUM' },
    cotMarket: 'PLATINUM',
    colorVar: '--asset-platinum',
  },
  palladium: {
    id: 'palladium',
    metal: 'palladium',
    label: 'Palladium',
    short: 'Pd',
    assetClass: 'precious',
    spot: 'PA=F',
    priceUnit: 'oz',
    unitLabel: '$/oz',
    displayDecimals: 2,
    session: 'globex',
    futures: [
      // NYMEX palladium: 100 troy oz, $0.50 tick ($50); liquid cycle Mar/Jun/Sep/Dec.
      { root: 'PA', name: 'NYMEX Palladium', exchange: 'NYMEX', yahoo: 'PA=F', contractSize: 100, pointValue: 100, tickSize: 0.5, activeMonths: [3, 6, 9, 12], cashSettled: false, ozPerContract: 100 },
    ],
    etfs: ['PALL'],
    benchmarkEtf: 'PALL',
    physical: { unit: 'oz', kind: 'bullion', instrumentId: 'XPD-PHYS' },
    cot: { report: 'disagg', code: '075651', market: 'PALLADIUM' },
    cotMarket: 'PALLADIUM',
    colorVar: '--asset-palladium',
  },
  copper: {
    id: 'copper',
    metal: 'copper',
    label: 'Copper',
    short: 'Cu',
    assetClass: 'industrial',
    spot: 'HG=F',
    priceUnit: 'lb',
    unitLabel: '$/lb',
    displayDecimals: 4,
    session: 'globex',
    futures: [
      // COMEX copper: 25,000 lb, every month listed; liquidity sits in the quarterly cycle H/K/N/U/Z.
      { root: 'HG', name: 'COMEX Copper', exchange: 'COMEX', yahoo: 'HG=F', contractSize: 25000, pointValue: 25000, tickSize: 0.0005, activeMonths: [3, 5, 7, 9, 12], cashSettled: false, ozPerContract: 0 },
      { root: 'MHG', name: 'COMEX Micro Copper', exchange: 'COMEX', yahoo: 'MHG=F', contractSize: 2500, pointValue: 2500, tickSize: 0.0005, activeMonths: [3, 5, 7, 9, 12], cashSettled: false, ozPerContract: 0 },
    ],
    etfs: ['CPER'],
    miners: 'COPX',
    benchmarkEtf: 'CPER',
    physical: null,
    cot: { report: 'disagg', code: '085692', market: 'COPPER' },
    cotMarket: 'COPPER',
    colorVar: '--asset-copper',
  },
  btc: {
    id: 'btc',
    metal: 'btc',
    label: 'Bitcoin',
    short: 'BTC',
    assetClass: 'crypto',
    // Reference series: the CME front future (weekday bars keep NAV, ML and
    // 252-day conventions consistent with the other assets). Spot trades 24/7
    // and is shown on tickers via displaySpot only.
    spot: 'BTC=F',
    displaySpot: 'BTC-USD',
    priceUnit: 'BTC',
    unitLabel: '$/BTC',
    displayDecimals: 0,
    session: '24x7',
    futures: [
      // CME Bitcoin: cash-settled to the CME CF BRR, every calendar month listed, expires the last Friday.
      { root: 'BTC', name: 'CME Bitcoin', exchange: 'CME', yahoo: 'BTC=F', contractSize: 5, pointValue: 5, tickSize: 5, activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], seasonalMonths: [3, 6, 9, 12], cashSettled: true, ozPerContract: 0 },
      { root: 'MBT', name: 'CME Micro Bitcoin', exchange: 'CME', yahoo: 'MBT=F', contractSize: 0.1, pointValue: 0.1, tickSize: 5, activeMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], seasonalMonths: [3, 6, 9, 12], cashSettled: true, ozPerContract: 0 },
    ],
    etfs: ['IBIT', 'FBTC'],
    benchmarkEtf: 'IBIT',
    physical: { unit: 'BTC', kind: 'custody', instrumentId: 'BTC-SPOT' },
    cot: { report: 'tff', code: '133741', market: 'BTC' },
    basis: { spot: 'BTC-USD', rate: TBILL_13W, rateLabel: '13-week T-bill', settlement: 'CME CF Bitcoin Reference Rate' },
    cotMarket: 'BTC',
    colorVar: '--asset-bitcoin',
  },
}

export function assetSpec(id: AssetId): AssetSpec {
  return UNIVERSE[id]
}

export function isAssetId(x: unknown): x is AssetId {
  return typeof x === 'string' && (ASSETS as readonly string[]).includes(x)
}

/** Parse an untrusted id (query param, localStorage), falling back to the first asset. */
export function parseAssetId(x: unknown, fallback: AssetId = ASSETS[0]): AssetId {
  return isAssetId(x) ? x : fallback
}

export function assetsInClass(cls: AssetClass): AssetId[] {
  return ASSETS.filter((a) => UNIVERSE[a].assetClass === cls)
}

/** Assets the fund can hold directly (vault bullion or custody balances). */
export function physicalAssets(): AssetId[] {
  return ASSETS.filter((a) => UNIVERSE[a].physical != null)
}

/** Every futures root across the universe (Databento parent symbology, contract tables). */
export function futuresRoots(): string[] {
  return ASSETS.flatMap((a) => UNIVERSE[a].futures.map((f) => f.root))
}

/**
 * Quant instrument id of an asset's cash-and-carry basis (`BTC.basis`), or null
 * when the asset declares no basis or its front future is physically settled.
 */
export function basisInstrumentId(id: AssetId): string | null {
  const s = UNIVERSE[id]
  const front = s.futures[0]
  return s.basis && front?.cashSettled ? `${front.root}.basis` : null
}

/** Assets with a cash-and-carry basis instrument. */
export function basisAssets(): AssetId[] {
  return ASSETS.filter((a) => basisInstrumentId(a) !== null)
}

/** Relative-value pairs the quant engine analyses. `ratio` = num/den; `spread` = num − hedge·den (vol-parity). */
export interface RelativeValuePair {
  /** Stable id used in instrument ids (`<id>.ratio`, `<id>.spread`) and the `pair` query param. */
  id: string
  /** URL/query key (kept for backward compatibility: 'gold-silver'). */
  key: string
  label: string
  numerator: AssetId
  denominator: AssetId
}

export const RELATIVE_VALUE_PAIRS: RelativeValuePair[] = [
  { id: 'GS', key: 'gold-silver', label: 'Gold / silver', numerator: 'gold', denominator: 'silver' },
  // Gold over platinum: historically near 1 or below; a high ratio means platinum is cheap vs gold.
  { id: 'GP', key: 'gold-platinum', label: 'Gold / platinum', numerator: 'gold', denominator: 'platinum' },
  // Palladium over platinum: the autocatalyst substitution trade (gasoline vs diesel loadings).
  { id: 'DP', key: 'palladium-platinum', label: 'Palladium / platinum', numerator: 'palladium', denominator: 'platinum' },
  // Copper over gold: the classic growth-vs-fear gauge (cyclical demand vs haven demand).
  { id: 'CG', key: 'copper-gold', label: 'Copper / gold', numerator: 'copper', denominator: 'gold' },
  // Bitcoin priced in ounces of gold: the "digital vs physical store of value" gauge.
  { id: 'BG', key: 'btc-gold', label: 'Bitcoin / gold', numerator: 'btc', denominator: 'gold' },
]

/** Futures month codes (CME convention). */
export const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'] as const

/** Yahoo symbol for a specific contract month, e.g. ('GC', 12, 2026) -> 'GCZ26.CMX'; ('BTC', 12, 2026) -> 'BTCZ26.CME'. */
export function yahooContractSymbol(root: string, month: number, year: number): string {
  const exchange = futuresProduct(root)?.exchange ?? 'COMEX'
  return `${root}${MONTH_CODES[month - 1]}${String(year).slice(-2)}${YAHOO_SUFFIX[exchange]}`
}

export function futuresProduct(root: string): FuturesProduct | undefined {
  for (const a of ASSETS) {
    const p = UNIVERSE[a].futures.find((f) => f.root === root)
    if (p) return p
  }
  return undefined
}

/** Asset owning a futures root. */
export function assetOfRoot(root: string): AssetId | undefined {
  return ASSETS.find((a) => UNIVERSE[a].futures.some((f) => f.root === root))
}

// A contract-month symbol: ROOT + month code + 2-digit year, optional exchange suffix (GCZ26, GCZ26.CMX).
const CONTRACT_RE = /^([A-Z]+)([FGHJKMNQUVXZ])(\d{2})(\.[A-Z]+)?$/

/**
 * Asset for any Yahoo/Databento symbol, matched EXACTLY: spot/display quotes,
 * ETFs, miners, continuous futures (GC=F) and contract months (GCZ26.CMX).
 * Prefix matching is deliberately avoided (PL would match PLTR, PA → PAAS).
 */
export function assetOfSymbol(symbol: string): AssetId | undefined {
  for (const a of ASSETS) {
    const s = UNIVERSE[a]
    if (s.spot === symbol || s.displaySpot === symbol || s.etfs.includes(symbol) || s.miners === symbol) return a
    if (s.futures.some((f) => f.yahoo === symbol || f.root === symbol)) return a
  }
  const m = CONTRACT_RE.exec(symbol)
  return m ? assetOfRoot(m[1]) : undefined
}

/** @deprecated Use `assetOfSymbol`. */
export const metalOfSymbol = assetOfSymbol

/** Market/macro reference symbols (Yahoo). */
export const MACRO_SYMBOLS = {
  dxy: 'DX-Y.NYB',
  us10y: '^TNX',
  vix: '^VIX',
  spx: 'SPY',
  tips: 'TIP',
} as const

export const TROY_OZ_PER_GRAM = 1 / 31.1034768
export const TROY_OZ_PER_KG = 1000 / 31.1034768

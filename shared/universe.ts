// Single source of truth for the tradable universe. Gold and silver are
// first-class and symmetric: every domain (portfolio, quant, macro, ML) is
// parameterized by `Metal` and reads its instruments from here.

export type Metal = 'gold' | 'silver'
export const METALS: readonly Metal[] = ['gold', 'silver'] as const

export type InstrumentKind = 'etf' | 'future' | 'physical' | 'cash' | 'equity'

export interface FuturesProduct {
  /** Root used across the app and by Databento (`<root>.FUT` parent symbology). */
  root: string
  name: string
  /** Yahoo continuous front-month symbol for live quotes. */
  yahoo: string
  /** Troy ounces per contract. */
  ozPerContract: number
  /** Dollars per 1.00 price-point move (= ozPerContract for $/oz quotes). */
  pointValue: number
  /** Liquid/active contract months (1-12). Serial months are ignored. */
  activeMonths: number[]
}

export interface MetalSpec {
  metal: Metal
  label: string
  /** Yahoo symbol used as the reference spot/front price. */
  spot: string
  futures: FuturesProduct[]
  /** Physically backed ETFs (tracked for holdings, premium/discount, flows). */
  etfs: string[]
  /** Miners equity ETF (beta proxy, not metal). */
  miners: string
  /** CFTC disaggregated COT market name. */
  cotMarket: string
  /** Chart accent token name for this metal. */
  colorVar: string
}

export const UNIVERSE: Record<Metal, MetalSpec> = {
  gold: {
    metal: 'gold',
    label: 'Gold',
    spot: 'GC=F',
    futures: [
      { root: 'GC', name: 'COMEX Gold', yahoo: 'GC=F', ozPerContract: 100, pointValue: 100, activeMonths: [2, 4, 6, 8, 10, 12] },
      { root: 'MGC', name: 'COMEX Micro Gold', yahoo: 'MGC=F', ozPerContract: 10, pointValue: 10, activeMonths: [2, 4, 6, 8, 10, 12] },
    ],
    etfs: ['GLD', 'IAU', 'GLDM', 'SGOL', 'PHYS'],
    miners: 'GDX',
    cotMarket: 'GOLD',
    colorVar: '--metal-gold',
  },
  silver: {
    metal: 'silver',
    label: 'Silver',
    spot: 'SI=F',
    futures: [
      { root: 'SI', name: 'COMEX Silver', yahoo: 'SI=F', ozPerContract: 5000, pointValue: 5000, activeMonths: [3, 5, 7, 9, 12] },
      { root: 'SIL', name: 'COMEX Micro Silver', yahoo: 'SIL=F', ozPerContract: 1000, pointValue: 1000, activeMonths: [3, 5, 7, 9, 12] },
    ],
    etfs: ['SLV', 'SIVR', 'PSLV'],
    miners: 'SILJ',
    cotMarket: 'SILVER',
    colorVar: '--metal-silver',
  },
}

/** Futures month codes (CME convention). */
export const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'] as const

/** Yahoo symbol for a specific COMEX contract month, e.g. ('GC', 12, 2026) -> 'GCZ26.CMX'. */
export function yahooContractSymbol(root: string, month: number, year: number): string {
  return `${root}${MONTH_CODES[month - 1]}${String(year).slice(-2)}.CMX`
}

export function futuresProduct(root: string): FuturesProduct | undefined {
  for (const m of METALS) {
    const p = UNIVERSE[m].futures.find((f) => f.root === root)
    if (p) return p
  }
  return undefined
}

export function metalOfSymbol(symbol: string): Metal | undefined {
  for (const m of METALS) {
    const s = UNIVERSE[m]
    if (s.spot === symbol || s.etfs.includes(symbol) || s.miners === symbol) return m
    if (s.futures.some((f) => f.yahoo === symbol || symbol.startsWith(f.root))) return m
  }
  return undefined
}

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

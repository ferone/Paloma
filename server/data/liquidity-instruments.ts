import { ASSETS, UNIVERSE, type AssetId, type AssetSpec } from '../../shared/universe.js'

// Instrument sets for /api/markets/liquidity, derived from the universe: the
// asset's main futures product (continuous Yahoo front) plus its physically
// backed / spot ETFs. Real, observable volumes only. The modeled WGC source and
// region splits (gold-constants.ts) are gold data and stay gold-only.

export interface LiquidityInstrumentDef {
  symbol: string
  name: string
  kind: 'future' | 'etf'
  /** Dollars per 1.00 price move per contract (futures only): dollar volume = contracts × pointValue × price. */
  pointValue?: number
  /**
   * false when Yahoo's daily history for this symbol is not usable for volume
   * (SI=F's continuous series follows thin delivery months, e.g. ~100 lots/day
   * while the Dec contract trades ~30k). Such symbols are left out of history.
   */
  historyReliable?: boolean
}

/** Display names for fund tickers; unknown tickers fall back to the Yahoo short name (snapshot) or the ticker. */
export const ETF_NAMES: Record<string, string> = {
  GLD: 'SPDR Gold Shares',
  IAU: 'iShares Gold Trust',
  GLDM: 'SPDR Gold MiniShares',
  SGOL: 'abrdn Physical Gold Shares',
  PHYS: 'Sprott Physical Gold Trust',
  SLV: 'iShares Silver Trust',
  SIVR: 'abrdn Physical Silver Shares',
  PSLV: 'Sprott Physical Silver Trust',
}

/** Continuous futures whose Yahoo daily volume history is unreliable (see `historyReliable`). */
export const UNRELIABLE_VOLUME_HISTORY = new Set(['SI=F'])

export function liquidityInstruments(spec: AssetSpec): LiquidityInstrumentDef[] {
  const defs: LiquidityInstrumentDef[] = []
  const f = spec.futures[0]
  if (f) {
    defs.push({
      symbol: f.yahoo,
      name: `${f.name} Futures (front)`,
      kind: 'future',
      pointValue: f.pointValue,
      ...(UNRELIABLE_VOLUME_HISTORY.has(f.yahoo) ? { historyReliable: false } : {}),
    })
  }
  for (const symbol of spec.etfs) defs.push({ symbol, name: ETF_NAMES[symbol] ?? symbol, kind: 'etf' })
  return defs
}

export const LIQUIDITY_INSTRUMENTS = Object.fromEntries(ASSETS.map((a) => [a, liquidityInstruments(UNIVERSE[a])])) as Record<
  AssetId,
  LiquidityInstrumentDef[]
>

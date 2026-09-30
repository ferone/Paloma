import { ASSETS, MACRO_SYMBOLS, UNIVERSE, assetOfSymbol, type AssetId, type AssetSpec } from '@shared/universe'
import type { ChartTheme } from '../charts/chartTheme'

const LABELS: Record<string, string> = {
  [MACRO_SYMBOLS.dxy]: 'US Dollar Index',
  [MACRO_SYMBOLS.us10y]: 'US 10Y yield',
  [MACRO_SYMBOLS.vix]: 'VIX',
  SPY: 'S&P 500 (SPY)',
  QQQ: 'Nasdaq 100 (QQQ)',
  TLT: '20Y+ Treasuries (TLT)',
  TIP: 'TIPS (TIP)',
}
// Universe-derived labels: continuous futures and 24/7 display quotes.
for (const a of ASSETS) {
  const u = UNIVERSE[a]
  const f = u.futures[0]
  if (f) LABELS[f.yahoo] = `${u.label} front future`
  if (u.displaySpot) LABELS[u.displaySpot] = `${u.label} spot (24/7)`
  if (!(u.spot in LABELS)) LABELS[u.spot] = `${u.label} reference`
}

const SHORT: Record<string, string> = { [MACRO_SYMBOLS.dxy]: 'DXY', [MACRO_SYMBOLS.us10y]: 'US10Y', [MACRO_SYMBOLS.vix]: 'VIX' }

/** Compact ticker for tables and legends (DX-Y.NYB → DXY). */
export const shortSymbol = (s: string) => SHORT[s] ?? s
export const symbolLabel = (s: string) => LABELS[s] ?? s

/** Reference spot, physically backed ETFs and miners (when the asset has them). */
export function assetInstruments(asset: AssetId): string[] {
  const u = UNIVERSE[asset]
  return u.miners ? [u.spot, ...u.etfs, u.miners] : [u.spot, ...u.etfs]
}
/** @deprecated Use `assetInstruments`. */
export const metalInstruments = assetInstruments

export const MACRO_COMPARISON = ['SPY', 'QQQ', 'TLT', MACRO_SYMBOLS.dxy] as const

/** Asset whose reference spot (or 24/7 display quote) this symbol is. */
function spotAsset(symbol: string): AssetId | undefined {
  return ASSETS.find((a) => UNIVERSE[a].spot === symbol || UNIVERSE[a].displaySpot === symbol)
}

/** Stable series colour: asset-coloured spot, categorical palette otherwise. */
export function seriesColor(symbol: string, index: number, t: ChartTheme): string {
  const a = spotAsset(symbol)
  if (a) return t.asset[a]
  // Skip series-1 (gold hue) and series-6 (silver hue): those belong to the metals.
  const pool = [t.series[1], t.series[2], t.series[3], t.series[4]]
  return pool[index % pool.length]
}

/** Colour of the asset owning a symbol (spot, ETF, miners, futures), else the brand colour. */
export function assetColor(symbol: string, t: ChartTheme): string {
  const a = assetOfSymbol(symbol)
  return a ? t.asset[a] : t.brand
}
/** @deprecated Use `assetColor`. */
export const metalColor = assetColor

/** What an asset's headline quote is: "COMEX front future (GC=F)", "spot, 24/7 (BTC-USD)". */
export function quoteDescription(spec: AssetSpec): string {
  if (spec.displaySpot) return `spot, 24/7 (${spec.displaySpot})`
  const f = spec.futures.find((x) => x.yahoo === spec.spot)
  return f ? `${f.exchange} front future (${spec.spot})` : `reference (${spec.spot})`
}

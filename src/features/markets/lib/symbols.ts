import { MACRO_SYMBOLS, UNIVERSE, metalOfSymbol, type Metal } from '@shared/universe'
import type { ChartTheme } from '../charts/chartTheme'

const LABELS: Record<string, string> = {
  'GC=F': 'Gold front future',
  'SI=F': 'Silver front future',
  [MACRO_SYMBOLS.dxy]: 'US Dollar Index',
  [MACRO_SYMBOLS.us10y]: 'US 10Y yield',
  [MACRO_SYMBOLS.vix]: 'VIX',
  SPY: 'S&P 500 (SPY)',
  QQQ: 'Nasdaq 100 (QQQ)',
  TLT: '20Y+ Treasuries (TLT)',
  TIP: 'TIPS (TIP)',
}

const SHORT: Record<string, string> = { [MACRO_SYMBOLS.dxy]: 'DXY', [MACRO_SYMBOLS.us10y]: 'US10Y', [MACRO_SYMBOLS.vix]: 'VIX' }

/** Compact ticker for tables and legends (DX-Y.NYB → DXY). */
export const shortSymbol = (s: string) => SHORT[s] ?? s
export const symbolLabel = (s: string) => LABELS[s] ?? s

/** Spot proxy, physically backed ETFs and miners for a metal. */
export function metalInstruments(metal: Metal): string[] {
  const u = UNIVERSE[metal]
  return [u.spot, ...u.etfs, u.miners]
}

export const MACRO_COMPARISON = ['SPY', 'QQQ', 'TLT', MACRO_SYMBOLS.dxy] as const

/** Stable series colour: metal-coloured spot, categorical palette otherwise. */
export function seriesColor(symbol: string, index: number, t: ChartTheme): string {
  if (symbol === UNIVERSE.gold.spot) return t.gold
  if (symbol === UNIVERSE.silver.spot) return t.silver
  // Skip series-1 (gold hue) and series-6 (silver hue): those belong to the metals.
  const pool = [t.series[1], t.series[2], t.series[3], t.series[4]]
  return pool[index % pool.length]
}

export function metalColor(symbol: string, t: ChartTheme): string {
  const m = metalOfSymbol(symbol)
  return m === 'silver' ? t.silver : m === 'gold' ? t.gold : t.brand
}

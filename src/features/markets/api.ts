import { api } from '../../api/client'
import type { AssetId } from '@shared/universe'
import type {
  CurveHistoryResponse,
  CurveResponse,
  EtfsResponse,
  LiquidityHistoryResponse,
  LiquiditySnapshot,
  OHLCV,
  Quote,
} from '@shared/markets'

// Fetchers for the markets section. Query keys are prefixed with 'markets'.
const enc = encodeURIComponent

export const marketsKeys = {
  quote: (symbol: string) => ['markets', 'quote', symbol] as const,
  quotes: (symbols: string[]) => ['markets', 'quotes', ...symbols] as const,
  history: (symbol: string, range: string) => ['markets', 'history', symbol, range] as const,
  curve: (metal: AssetId) => ['markets', 'curve', metal] as const,
  curveHistory: (metal: AssetId) => ['markets', 'curve-history', metal] as const,
  etfs: (metal: AssetId) => ['markets', 'etfs', metal] as const,
  liquidity: (metal: AssetId) => ['markets', 'liquidity', metal] as const,
  liquidityHistory: (metal: AssetId, range: string) => ['markets', 'liquidity-history', metal, range] as const,
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  return (await api.get<Quote>(`/quotes/${enc(symbol)}`)).data
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  return (await api.get<Quote[]>('/batch', { params: { symbols: symbols.join(',') } })).data
}

export async function fetchHistory(symbol: string, range: string): Promise<OHLCV[]> {
  const data = (await api.get<OHLCV[]>(`/historical/${enc(symbol)}`, { params: { range } })).data
  // Charts iterate the bars: anything but a list is an error state, not data.
  if (!Array.isArray(data)) throw new Error(`No price history for ${symbol}`)
  return data
}

export async function fetchCurve(metal: AssetId): Promise<CurveResponse> {
  return (await api.get<CurveResponse>('/markets/curve', { params: { asset: metal } })).data
}

export async function fetchCurveHistory(metal: AssetId): Promise<CurveHistoryResponse> {
  return (await api.get<CurveHistoryResponse>('/markets/curve/history', { params: { asset: metal } })).data
}

export async function fetchEtfs(metal: AssetId): Promise<EtfsResponse> {
  return (await api.get<EtfsResponse>('/markets/etfs', { params: { asset: metal }, timeout: 45_000 })).data
}

export async function fetchLiquidity(metal: AssetId): Promise<LiquiditySnapshot> {
  return (await api.get<LiquiditySnapshot>('/markets/liquidity', { params: { asset: metal }, timeout: 30_000 })).data
}

export async function fetchLiquidityHistory(metal: AssetId, range: string): Promise<LiquidityHistoryResponse> {
  return (await api.get<LiquidityHistoryResponse>('/markets/liquidity/history', { params: { asset: metal, range }, timeout: 45_000 })).data
}

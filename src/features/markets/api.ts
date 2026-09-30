import { api } from '../../api/client'
import type { Metal } from '@shared/universe'
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
  curve: (metal: Metal) => ['markets', 'curve', metal] as const,
  curveHistory: (metal: Metal) => ['markets', 'curve-history', metal] as const,
  etfs: (metal: Metal) => ['markets', 'etfs', metal] as const,
  liquidity: (metal: Metal) => ['markets', 'liquidity', metal] as const,
  liquidityHistory: (metal: Metal, range: string) => ['markets', 'liquidity-history', metal, range] as const,
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  return (await api.get<Quote>(`/quotes/${enc(symbol)}`)).data
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  return (await api.get<Quote[]>('/batch', { params: { symbols: symbols.join(',') } })).data
}

export async function fetchHistory(symbol: string, range: string): Promise<OHLCV[]> {
  return (await api.get<OHLCV[]>(`/historical/${enc(symbol)}`, { params: { range } })).data
}

export async function fetchCurve(metal: Metal): Promise<CurveResponse> {
  return (await api.get<CurveResponse>('/markets/curve', { params: { metal } })).data
}

export async function fetchCurveHistory(metal: Metal): Promise<CurveHistoryResponse> {
  return (await api.get<CurveHistoryResponse>('/markets/curve/history', { params: { metal } })).data
}

export async function fetchEtfs(metal: Metal): Promise<EtfsResponse> {
  return (await api.get<EtfsResponse>('/markets/etfs', { params: { metal }, timeout: 45_000 })).data
}

export async function fetchLiquidity(metal: Metal): Promise<LiquiditySnapshot> {
  return (await api.get<LiquiditySnapshot>('/markets/liquidity', { params: { metal }, timeout: 30_000 })).data
}

export async function fetchLiquidityHistory(metal: Metal, range: string): Promise<LiquidityHistoryResponse> {
  return (await api.get<LiquidityHistoryResponse>('/markets/liquidity/history', { params: { metal, range }, timeout: 45_000 })).data
}

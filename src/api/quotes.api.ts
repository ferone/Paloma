import { api } from './client'
import type { Quote, GoldLiquidity, LiquidityHistoryResponse } from '../types'

export async function fetchQuote(symbol: string): Promise<Quote> {
  const { data } = await api.get<Quote>(`/quotes/${symbol}`)
  return data
}

export async function fetchBatchQuotes(symbols: string[]): Promise<Quote[]> {
  const { data } = await api.get<Quote[]>('/batch', {
    params: { symbols: symbols.join(',') },
  })
  return data
}

export async function fetchGoldPrice(): Promise<Quote> {
  const { data } = await api.get<Quote>('/gold-price')
  return data
}

export async function fetchGoldLiquidity(): Promise<GoldLiquidity> {
  const { data } = await api.get<GoldLiquidity>('/gold-liquidity')
  return data
}

export async function fetchLiquidityHistory(range: string): Promise<LiquidityHistoryResponse> {
  const { data } = await api.get<LiquidityHistoryResponse>('/gold-liquidity/history', {
    params: { range },
  })
  return data
}

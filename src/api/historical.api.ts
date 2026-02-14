import { api } from './client'
import type { OHLCV } from '../types'

export async function fetchHistorical(symbol: string, range: string): Promise<OHLCV[]> {
  const { data } = await api.get<OHLCV[]>(`/historical/${symbol}`, {
    params: { range },
  })
  return data
}

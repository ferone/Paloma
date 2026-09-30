import { useQueries, useQuery } from '@tanstack/react-query'
import type { AssetId } from '@shared/universe'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import {
  fetchCurve,
  fetchCurveHistory,
  fetchEtfs,
  fetchHistory,
  fetchLiquidity,
  fetchLiquidityHistory,
  fetchQuote,
  fetchQuotes,
  marketsKeys,
} from './api'

const HISTORY_STALE = 30 * 60_000

export function useQuote(symbol: string) {
  const refetchInterval = useAutoRefresh()
  return useQuery({
    queryKey: marketsKeys.quote(symbol),
    queryFn: () => fetchQuote(symbol),
    refetchInterval,
    enabled: !!symbol,
  })
}

export function useQuotes(symbols: string[]) {
  const refetchInterval = useAutoRefresh()
  return useQuery({
    queryKey: marketsKeys.quotes(symbols),
    queryFn: () => fetchQuotes(symbols),
    refetchInterval,
    enabled: symbols.length > 0,
  })
}

export function useHistory(symbol: string, range: string) {
  return useQuery({
    queryKey: marketsKeys.history(symbol, range),
    queryFn: () => fetchHistory(symbol, range),
    enabled: !!symbol,
    staleTime: range === '1D' || range === '1W' ? 60_000 : HISTORY_STALE,
  })
}

/** Several symbols over one range; results in input order. */
export function useHistories(symbols: string[], range: string) {
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: marketsKeys.history(symbol, range),
      queryFn: () => fetchHistory(symbol, range),
      staleTime: HISTORY_STALE,
    })),
  })
}

export function useCurve(metal: AssetId) {
  const refetchInterval = useAutoRefresh()
  return useQuery({ queryKey: marketsKeys.curve(metal), queryFn: () => fetchCurve(metal), refetchInterval: refetchInterval && Math.max(refetchInterval, 60_000) })
}

export function useCurveHistory(metal: AssetId) {
  return useQuery({ queryKey: marketsKeys.curveHistory(metal), queryFn: () => fetchCurveHistory(metal), staleTime: 5 * 60_000 })
}

export function useEtfs(metal: AssetId) {
  const refetchInterval = useAutoRefresh()
  return useQuery({ queryKey: marketsKeys.etfs(metal), queryFn: () => fetchEtfs(metal), refetchInterval: refetchInterval && Math.max(refetchInterval, 60_000) })
}

export function useLiquidity(metal: AssetId) {
  const refetchInterval = useAutoRefresh()
  return useQuery({ queryKey: marketsKeys.liquidity(metal), queryFn: () => fetchLiquidity(metal), refetchInterval: refetchInterval && Math.max(refetchInterval, 60_000) })
}

export function useLiquidityHistory(metal: AssetId, range: string) {
  return useQuery({
    queryKey: marketsKeys.liquidityHistory(metal, range),
    queryFn: () => fetchLiquidityHistory(metal, range),
    staleTime: HISTORY_STALE,
  })
}

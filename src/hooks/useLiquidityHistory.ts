import { useQuery } from '@tanstack/react-query'
import { fetchLiquidityHistory } from '../api/quotes.api'
import { queryKeys } from '../api/query-keys'

export function useLiquidityHistory(range: string) {
  return useQuery({
    queryKey: queryKeys.gold.liquidityHistory(range),
    queryFn: () => fetchLiquidityHistory(range),
    staleTime: 30 * 60 * 1000,
  })
}

import { useQuery } from '@tanstack/react-query'
import { fetchGoldLiquidity } from '../api/quotes.api'
import { queryKeys } from '../api/query-keys'
import { useAutoRefresh } from './useAutoRefresh'

export function useGoldLiquidity() {
  const refetchInterval = useAutoRefresh()
  return useQuery({
    queryKey: queryKeys.gold.liquidity,
    queryFn: fetchGoldLiquidity,
    refetchInterval,
  })
}

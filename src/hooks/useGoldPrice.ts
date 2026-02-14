import { useQuery } from '@tanstack/react-query'
import { fetchGoldPrice } from '../api/quotes.api'
import { queryKeys } from '../api/query-keys'
import { useAutoRefresh } from './useAutoRefresh'

export function useGoldPrice() {
  const refetchInterval = useAutoRefresh()
  return useQuery({
    queryKey: queryKeys.gold.price,
    queryFn: fetchGoldPrice,
    refetchInterval,
  })
}

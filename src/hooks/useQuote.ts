import { useQuery } from '@tanstack/react-query'
import { fetchQuote } from '../api/quotes.api'
import { queryKeys } from '../api/query-keys'
import { useAutoRefresh } from './useAutoRefresh'

export function useQuote(symbol: string) {
  const refetchInterval = useAutoRefresh()
  return useQuery({
    queryKey: queryKeys.quotes.single(symbol),
    queryFn: () => fetchQuote(symbol),
    refetchInterval,
    enabled: !!symbol,
  })
}

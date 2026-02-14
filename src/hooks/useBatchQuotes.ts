import { useQuery } from '@tanstack/react-query'
import { fetchBatchQuotes } from '../api/quotes.api'
import { queryKeys } from '../api/query-keys'
import { useAutoRefresh } from './useAutoRefresh'

export function useBatchQuotes(symbols: string[]) {
  const refetchInterval = useAutoRefresh()
  return useQuery({
    queryKey: queryKeys.quotes.batch(symbols),
    queryFn: () => fetchBatchQuotes(symbols),
    refetchInterval,
    enabled: symbols.length > 0,
  })
}

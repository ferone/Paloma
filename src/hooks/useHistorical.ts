import { useQuery } from '@tanstack/react-query'
import { fetchHistorical } from '../api/historical.api'
import { queryKeys } from '../api/query-keys'

export function useHistorical(symbol: string, range: string) {
  return useQuery({
    queryKey: queryKeys.historical.symbol(symbol, range),
    queryFn: () => fetchHistorical(symbol, range),
    enabled: !!symbol,
    staleTime: range === '1D' ? 60_000 : 30 * 60_000,
  })
}

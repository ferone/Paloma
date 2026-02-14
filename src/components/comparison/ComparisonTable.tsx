import { useQueries } from '@tanstack/react-query'
import { fetchHistorical } from '../../api/historical.api'
import { queryKeys } from '../../api/query-keys'
import { Card } from '../shared/Card'
import { PercentChange } from '../shared/PercentChange'
import { Skeleton } from '../shared/SkeletonLoader'

interface ComparisonTableProps {
  symbols: string[]
}

const PERIODS = ['1W', '1M', '3M', '6M', '1Y'] as const

export function ComparisonTable({ symbols }: ComparisonTableProps) {
  const queries = useQueries({
    queries: symbols.flatMap((symbol) =>
      PERIODS.map((range) => ({
        queryKey: queryKeys.historical.symbol(symbol, range),
        queryFn: () => fetchHistorical(symbol, range),
        staleTime: 30 * 60_000,
      }))
    ),
  })

  const isLoading = queries.some((q) => q.isLoading)

  function getReturn(symbolIdx: number, periodIdx: number): number | null {
    const queryIdx = symbolIdx * PERIODS.length + periodIdx
    const data = queries[queryIdx]?.data
    if (!data || data.length < 2) return null
    const first = data[0].close
    const last = data[data.length - 1].close
    return ((last - first) / first) * 100
  }

  if (symbols.length === 0) return null

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left px-4 py-3 text-gray-400 font-medium">ETF</th>
            {PERIODS.map((p) => (
              <th key={p} className="text-right px-4 py-3 text-gray-400 font-medium">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol, sIdx) => (
            <tr key={symbol} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="px-4 py-3 font-medium text-white">{symbol}</td>
              {PERIODS.map((_, pIdx) => {
                const ret = getReturn(sIdx, pIdx)
                return (
                  <td key={pIdx} className="text-right px-4 py-3">
                    {isLoading ? (
                      <Skeleton className="h-4 w-16 ml-auto" />
                    ) : ret !== null ? (
                      <PercentChange value={ret} showIcon={false} />
                    ) : (
                      <span className="text-gray-600">--</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

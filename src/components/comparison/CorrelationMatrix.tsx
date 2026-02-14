import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchHistorical } from '../../api/historical.api'
import { queryKeys } from '../../api/query-keys'
import { Card } from '../shared/Card'
import { Skeleton } from '../shared/SkeletonLoader'

interface CorrelationMatrixProps {
  symbols: string[]
}

function calculateCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 2) return 0

  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n

  let cov = 0
  let varA = 0
  let varB = 0

  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }

  const denom = Math.sqrt(varA * varB)
  return denom === 0 ? 0 : cov / denom
}

function getCorrelationColor(corr: number): string {
  if (corr >= 0.7) return 'bg-green-500/30 text-green-300'
  if (corr >= 0.3) return 'bg-green-500/15 text-green-400'
  if (corr >= -0.3) return 'bg-gray-500/10 text-gray-400'
  if (corr >= -0.7) return 'bg-red-500/15 text-red-400'
  return 'bg-red-500/30 text-red-300'
}

export function CorrelationMatrix({ symbols }: CorrelationMatrixProps) {
  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: queryKeys.historical.symbol(symbol, '1Y'),
      queryFn: () => fetchHistorical(symbol, '1Y'),
      staleTime: 30 * 60_000,
    })),
  })

  const isLoading = queries.some((q) => q.isLoading)

  const matrix = useMemo(() => {
    if (isLoading || queries.some((q) => !q.data)) return null

    const returns = queries.map((q) => {
      const data = q.data!
      const rets: number[] = []
      for (let i = 1; i < data.length; i++) {
        rets.push((data[i].close - data[i - 1].close) / data[i - 1].close)
      }
      return rets
    })

    return symbols.map((_, i) =>
      symbols.map((_, j) => calculateCorrelation(returns[i], returns[j]))
    )
  }, [isLoading, queries, symbols])

  if (symbols.length < 2) return null

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-white mb-4">Correlation Matrix (1Y)</h3>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="px-3 py-2" />
                {symbols.map((s) => (
                  <th key={s} className="px-3 py-2 text-gray-400 font-medium">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {symbols.map((s, i) => (
                <tr key={s}>
                  <td className="px-3 py-2 text-gray-400 font-medium">{s}</td>
                  {symbols.map((_, j) => {
                    const corr = matrix?.[i][j] ?? 0
                    return (
                      <td
                        key={j}
                        className={`px-3 py-2 text-center rounded ${getCorrelationColor(corr)}`}
                      >
                        {corr.toFixed(2)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

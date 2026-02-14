import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { fetchHistorical } from '../api/historical.api'
import { queryKeys } from '../api/query-keys'
import {
  calculateCAGR,
  calculateMaxDrawdown,
  calculateVolatility,
  calculateSharpeRatio,
  calculateDailyReturns,
} from '../lib/portfolio-math'
import type { PortfolioAllocation, SimulationResult } from '../types'

interface SimulatorInput {
  amount: number
  startDate: string
  endDate: string
  allocations: PortfolioAllocation[]
}

export function usePortfolioSimulator(input: SimulatorInput | null) {
  const symbols = input?.allocations.map((a) => a.symbol) ?? []

  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: queryKeys.historical.symbol(symbol, 'custom'),
      queryFn: () => fetchHistorical(symbol, '5Y'),
      enabled: !!input,
      staleTime: 30 * 60_000,
    })),
  })

  const isLoading = queries.some((q) => q.isLoading)
  const error = queries.find((q) => q.error)?.error ?? null

  const result = useMemo((): SimulationResult | null => {
    if (!input || isLoading || queries.some((q) => !q.data)) return null

    const startDate = new Date(input.startDate)
    const endDate = new Date(input.endDate)

    const filteredData = queries.map((q, idx) => ({
      symbol: symbols[idx],
      weight: input.allocations[idx].weight / 100,
      data: (q.data ?? []).filter((d) => {
        const date = new Date(d.date)
        return date >= startDate && date <= endDate
      }),
    }))

    if (filteredData.some((d) => d.data.length < 2)) return null

    const minLen = Math.min(...filteredData.map((d) => d.data.length))
    const portfolioValues: number[] = []

    for (let i = 0; i < minLen; i++) {
      let dayValue = 0
      for (const fd of filteredData) {
        const basePrice = fd.data[0].close
        const currentPrice = fd.data[i].close
        const growth = currentPrice / basePrice
        dayValue += input.amount * fd.weight * growth
      }
      portfolioValues.push(dayValue)
    }

    const years = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    const totalReturn = ((portfolioValues[portfolioValues.length - 1] - input.amount) / input.amount) * 100
    const cagr = calculateCAGR(input.amount, portfolioValues[portfolioValues.length - 1], years)
    const maxDrawdown = calculateMaxDrawdown(portfolioValues)
    const dailyReturns = calculateDailyReturns(portfolioValues)
    const volatility = calculateVolatility(dailyReturns)
    const sharpeRatio = calculateSharpeRatio(dailyReturns)

    const dates = filteredData[0].data.slice(0, minLen).map((d) => d.date)
    const data = portfolioValues.map((value, i) => ({
      date: dates[i],
      value,
    }))

    return { totalReturn, cagr, maxDrawdown, sharpeRatio, volatility, data }
  }, [input, isLoading, queries, symbols])

  return { result, isLoading, error }
}

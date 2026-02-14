import { useState } from 'react'
import { ALL_ETFS, ETF_COLORS } from '../../lib/constants'
import { Card } from '../shared/Card'
import type { PortfolioAllocation } from '../../types'
import clsx from 'clsx'

interface InvestmentFormProps {
  onSubmit: (data: {
    amount: number
    startDate: string
    endDate: string
    allocations: PortfolioAllocation[]
  }) => void
  isLoading: boolean
}

export function InvestmentForm({ onSubmit, isLoading }: InvestmentFormProps) {
  const [amount, setAmount] = useState(10000)
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-12-31')
  const [selected, setSelected] = useState<string[]>(['GLD', 'SPY'])
  const [weights, setWeights] = useState<Record<string, number>>({ GLD: 50, SPY: 50 })

  const toggleETF = (symbol: string) => {
    if (selected.includes(symbol)) {
      const next = selected.filter((s) => s !== symbol)
      setSelected(next)
      const newWeights = { ...weights }
      delete newWeights[symbol]
      if (next.length > 0) {
        const equal = Math.round(100 / next.length)
        next.forEach((s, i) => {
          newWeights[s] = i === next.length - 1 ? 100 - equal * (next.length - 1) : equal
        })
      }
      setWeights(newWeights)
    } else {
      const next = [...selected, symbol]
      setSelected(next)
      const equal = Math.round(100 / next.length)
      const newWeights: Record<string, number> = {}
      next.forEach((s, i) => {
        newWeights[s] = i === next.length - 1 ? 100 - equal * (next.length - 1) : equal
      })
      setWeights(newWeights)
    }
  }

  const totalWeight = selected.reduce((sum, s) => sum + (weights[s] || 0), 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (totalWeight !== 100 || selected.length === 0) return
    onSubmit({
      amount,
      startDate,
      endDate,
      allocations: selected.map((s) => ({ symbol: s, weight: weights[s] })),
    })
  }

  return (
    <Card className="p-6">
      <h3 className="text-sm font-medium text-white mb-4">Portfolio Configuration</h3>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Investment Amount ($)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            min={100}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-gold-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-gold-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-gold-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Select ETFs</label>
          <div className="flex flex-wrap gap-2">
            {ALL_ETFS.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => toggleETF(sym)}
                className={clsx(
                  'px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors',
                  selected.includes(sym)
                    ? 'border-gold-500/40 bg-gold-500/10 text-gold-300'
                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-white'
                )}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: ETF_COLORS[sym] }}
                />
                {sym}
              </button>
            ))}
          </div>
        </div>

        {selected.length > 0 && (
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Allocation (%)
              <span className={clsx('ml-2 font-mono', totalWeight === 100 ? 'text-green-400' : 'text-red-400')}>
                Total: {totalWeight}%
              </span>
            </label>
            <div className="space-y-2">
              {selected.map((sym) => (
                <div key={sym} className="flex items-center gap-3">
                  <span className="text-sm text-white w-12">{sym}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={weights[sym] || 0}
                    onChange={(e) => setWeights({ ...weights, [sym]: Number(e.target.value) })}
                    className="flex-1 accent-gold-500"
                  />
                  <span className="text-sm text-gray-300 w-12 text-right font-mono">{weights[sym] || 0}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || totalWeight !== 100 || selected.length === 0}
          className={clsx(
            'w-full py-2.5 rounded-lg font-medium text-sm transition-colors',
            totalWeight === 100 && selected.length > 0
              ? 'bg-gold-500 text-gray-900 hover:bg-gold-400'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          )}
        >
          {isLoading ? 'Simulating...' : 'Run Simulation'}
        </button>
      </form>
    </Card>
  )
}

import { useQueries } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState, type FormEvent } from 'react'
import { ASSETS as ASSET_IDS, MACRO_SYMBOLS, UNIVERSE } from '@shared/universe'
import { api } from '../../../api/client'
import { fmtDate, fmtNum, fmtPct, fmtPctSigned, fmtUsd, fmtUsdCompact } from '../../../design/format'
import { signColor } from '../../../design/tokens'
import { Button, Chip, EmptyState, ErrorNote, Field, Input, Panel, PanelSkeleton, Segmented, Stat } from '../../../ui'
import { TimeChart } from '../components/TimeChart'
import { simulate, type Allocation, type Bar, type Rebalance } from './math'

const ASSETS: { symbol: string; group: string }[] = [
  ...UNIVERSE.gold.etfs.map((s) => ({ symbol: s, group: 'Gold' })),
  ...UNIVERSE.silver.etfs.map((s) => ({ symbol: s, group: 'Silver' })),
  ...ASSET_IDS.flatMap((a) => (UNIVERSE[a].miners ? [{ symbol: UNIVERSE[a].miners!, group: 'Miners' }] : [])),
  { symbol: MACRO_SYMBOLS.spx, group: 'Other' },
  { symbol: MACRO_SYMBOLS.tips, group: 'Other' },
]

interface Input_ {
  amount: number
  start: string
  end: string
  rebalance: Rebalance
  allocations: Allocation[]
}

function rangeFor(start: string): string {
  const days = (Date.now() - Date.parse(start)) / 86_400_000
  return days <= 360 ? '1Y' : days <= 5 * 365 ? '5Y' : 'ALL'
}

async function fetchDaily(symbol: string, range: string): Promise<Bar[]> {
  const { data } = await api.get<{ date: string; close: number }[]>(`/historical/${encodeURIComponent(symbol)}`, { params: { range, interval: '1d' }, timeout: 30_000 })
  return data.map((d) => ({ date: d.date.slice(0, 10), close: d.close }))
}

function equalWeights(symbols: string[]): Record<string, number> {
  const n = symbols.length
  if (!n) return {}
  const each = Math.floor(100 / n)
  return Object.fromEntries(symbols.map((s, i) => [s, i === n - 1 ? 100 - each * (n - 1) : each]))
}

export default function ScenarioPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [amount, setAmount] = useState('1000000')
  const [start, setStart] = useState(`${Number(today.slice(0, 4)) - 3}-01-01`)
  const [end, setEnd] = useState(today)
  const [rebalance, setRebalance] = useState<Rebalance>('none')
  const [selected, setSelected] = useState<string[]>(['GLD', 'SLV'])
  const [weights, setWeights] = useState<Record<string, number>>({ GLD: 70, SLV: 30 })
  const [input, setInput] = useState<Input_ | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const total = selected.reduce((s, x) => s + (weights[x] ?? 0), 0)
  const toggle = (sym: string) => {
    const next = selected.includes(sym) ? selected.filter((s) => s !== sym) : [...selected, sym]
    setSelected(next)
    setWeights(equalWeights(next))
  }

  const range = input ? rangeFor(input.start) : '1Y'
  const queries = useQueries({
    queries: (input?.allocations ?? []).map((a) => ({
      queryKey: ['portfolio', 'scenario', a.symbol, range],
      queryFn: () => fetchDaily(a.symbol, range),
      staleTime: 30 * 60_000,
    })),
  })
  const loading = queries.some((q) => q.isLoading)
  const error = queries.find((q) => q.error)?.error
  const dataKey = queries.map((q) => q.dataUpdatedAt).join(',')

  const result = useMemo(() => {
    if (!input || loading || error) return null
    const series = Object.fromEntries(input.allocations.map((a, i) => [a.symbol, queries[i]?.data ?? []]))
    return simulate(input.amount, input.allocations, series, input.start, input.end, input.rebalance)
    // queries is a new array every render; dataKey tracks their content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, error, dataKey])

  function submit(e: FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!(amt > 0)) return setFormError('Amount must be positive')
    if (selected.length === 0) return setFormError('Choose at least one asset')
    if (Math.abs(total - 100) > 0.001) return setFormError(`Weights must sum to 100% (now ${fmtNum(total, 0)}%)`)
    if (start >= end) return setFormError('Start must precede end')
    setFormError(null)
    setInput({ amount: amt, start, end, rebalance, allocations: selected.map((s) => ({ symbol: s, weight: (weights[s] ?? 0) / 100 })) })
  }

  const groups = [...new Set(ASSETS.map((a) => a.group))]
  return (
    <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Panel title="Scenario" eyebrow="Historical backtest" provenance={{ source: 'Yahoo Finance daily closes', note: 'Price return only (distributions excluded)' }}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Initial investment (USD)">
            <Input type="number" min={1} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="End">
              <Input type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <div>
            <span className="label mb-1 block">Rebalancing</span>
            <Segmented<Rebalance>
              ariaLabel="Rebalancing"
              value={rebalance}
              onChange={setRebalance}
              options={[
                { value: 'none', label: 'Buy & hold' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
              ]}
            />
          </div>
          <fieldset>
            <legend className="label mb-2">Assets</legend>
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-14 text-2xs text-muted">{g}</span>
                  {ASSETS.filter((a) => a.group === g).map((a) => (
                    <button
                      key={a.symbol}
                      type="button"
                      aria-pressed={selected.includes(a.symbol)}
                      onClick={() => toggle(a.symbol)}
                      className={clsx(
                        'num rounded-md border px-2 py-0.5 text-xs transition-colors',
                        selected.includes(a.symbol) ? 'border-brand bg-brand-soft text-foreground' : 'border-border text-muted hover:text-foreground',
                      )}
                    >
                      {a.symbol}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </fieldset>
          {selected.length > 0 && (
            <fieldset>
              <legend className="label mb-2 flex w-full items-center justify-between">
                Weights (%)
                <span className={clsx('num normal-case', Math.abs(total - 100) < 0.001 ? 'text-muted' : 'text-neg-text')}>Σ {fmtNum(total, 0)}%</span>
              </legend>
              <div className="space-y-2">
                {selected.map((s) => (
                  <div key={s} className="flex items-center gap-3">
                    <label htmlFor={`w-${s}`} className="num w-12 text-sm text-foreground">
                      {s}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={weights[s] ?? 0}
                      onChange={(e) => setWeights((w) => ({ ...w, [s]: Number(e.target.value) }))}
                      className="flex-1 accent-[var(--brand)]"
                      aria-label={`${s} weight slider`}
                    />
                    <Input id={`w-${s}`} type="number" min={0} max={100} className="w-20 text-right" value={weights[s] ?? 0} onChange={(e) => setWeights((w) => ({ ...w, [s]: Number(e.target.value) }))} />
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setWeights(equalWeights(selected))}>
                Equal weight
              </Button>
            </fieldset>
          )}
          {formError && <ErrorNote error={new Error(formError)} />}
          <Button type="submit" variant="primary" className="w-full" disabled={loading}>
            {loading ? 'Loading prices…' : 'Run scenario'}
          </Button>
        </form>
      </Panel>

      <div className="min-w-0 space-y-6">
        {!input ? (
          <Panel>
            <EmptyState title="Configure a mix and run the scenario">
              Backtests a fixed-weight mix of gold and silver ETFs, miners and reference assets on historical closes. It is an illustration of past behaviour, not a forecast.
            </EmptyState>
          </Panel>
        ) : loading ? (
          <Panel>
            <PanelSkeleton rows={8} />
          </Panel>
        ) : error ? (
          <ErrorNote error={error} onRetry={() => queries.forEach((q) => q.refetch())} />
        ) : !result ? (
          <Panel>
            <EmptyState title="Not enough overlapping history">Every selected asset needs prices across the chosen dates. Try a later start date.</EmptyState>
          </Panel>
        ) : (
          <Panel
            title="Growth of the mix"
            eyebrow={`${fmtDate(result.data[0].date)} – ${fmtDate(result.data.at(-1)!.date)} · ${input.allocations.map((a) => `${a.symbol} ${fmtPct(a.weight, 0)}`).join(' · ')}`}
            actions={<Chip tone="modeled">Illustration</Chip>}
            provenance={{ source: 'Yahoo Finance daily closes', asOf: result.data.at(-1)!.date, note: `${result.observations} common trading days · ${input.rebalance === 'none' ? 'buy & hold' : `${input.rebalance} rebalance`} · no costs or taxes` }}
          >
            <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Final value" value={fmtUsdCompact(result.finalValue)} hint={fmtUsd(input.amount, 0)} />
              <Stat label="Total return" value={<span className={signColor(result.totalReturn)}>{fmtPctSigned(result.totalReturn)}</span>} />
              <Stat label="CAGR" value={fmtPctSigned(result.cagr)} />
              <Stat label="Max drawdown" value={<span className="text-neg-text">{fmtPct(result.maxDrawdown)}</span>} />
              <Stat label="Volatility" value={fmtPct(result.volatility)} />
              <Stat label="Sharpe (rf 0)" value={fmtNum(result.sharpe)} />
            </dl>
            <TimeChart ariaLabel="Scenario portfolio value" data={result.data} series={[{ key: 'value', label: 'Portfolio value', color: 'brand' }]} format={(v) => fmtUsdCompact(v)} reference={input.amount} height={340} />
          </Panel>
        )}
      </div>
    </div>
  )
}

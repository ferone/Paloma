// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreshnessResponse } from '@shared/marketdata'

const get = vi.fn()
const post = vi.fn()
vi.mock('../../../api/client', () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn() } }))

import DatasetsPage from './DatasetsPage'
import DatabentoPage from './DatabentoPage'

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const freshness: FreshnessResponse = {
  generatedAt: '2026-09-30T16:00:00Z',
  rows: [
    { dataset: 'prices_daily', source: 'yahoo', exists: true, rows: 103388, symbols: 20, from: '2000-01-03', to: '2026-09-30', lastJob: { name: 'marketdata.yahoo', finishedAt: '2026-09-30T15:00:00Z' }, ageDays: 0, stale: false, maxAgeDays: 4 },
    { dataset: 'contract_bars', source: 'databento', exists: true, rows: 281, symbols: 24, from: '2026-08-31', to: '2026-09-18', lastJob: null, ageDays: 12, stale: true, maxAgeDays: 4 },
    { dataset: 'transactions', source: '—', exists: false, rows: 0, symbols: 0, from: null, to: null, lastJob: null, ageDays: null, stale: false, maxAgeDays: null },
  ],
}

describe('Data Center pages', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
  })

  it('shows freshness with stale flags and lists tables not yet created', async () => {
    get.mockResolvedValue({ data: freshness })
    wrap(<DatasetsPage />)
    expect(await screen.findByText('103,388')).toBeInTheDocument()
    expect(screen.getByTitle('Latest data is 12 days old; tolerance is 4 days')).toHaveTextContent('Stale')
    expect(screen.getByText('Fresh')).toBeInTheDocument()
    expect(screen.getByText(/Not created yet by their domains: Transactions/)).toBeInTheDocument()
  })

  it('renders the not-configured state when Databento has no key', async () => {
    get.mockResolvedValue({ data: { configured: false, budget: 10, roots: [], schemas: [], historyStart: '2010-06-06', spend: { totalUsd: 0, pulls: 0, lastPullAt: null }, backfill: null } })
    wrap(<DatabentoPage />)
    expect(await screen.findByText('Integration not configured')).toBeInTheDocument()
    expect(screen.getByText('DATABENTO_API_KEY')).toBeInTheDocument()
  })

  it('requires an explicit, amount-bearing confirmation before a paid backfill', async () => {
    get.mockResolvedValue({ data: { configured: true, budget: 10, roots: ['GC', 'MGC', 'SI', 'SIL'], schemas: ['ohlcv-1d', 'statistics'], historyStart: '2010-06-06', spend: { totalUsd: 0.03, pulls: 4, lastPullAt: null }, backfill: null } })
    post.mockImplementation(async (url: string) => {
      if (url.endsWith('/estimate'))
        return {
          data: {
            dataset: 'GLBX.MDP3',
            start: '2010-06-06',
            end: '2026-09-30',
            lines: [
              { root: 'GC', schema: 'ohlcv-1d', cost: 1.545 },
              { root: 'GC', schema: 'statistics', cost: 0.9916 },
            ],
            total: 2.5366,
            budget: 10,
            withinBudget: true,
          },
        }
      return { status: 202, data: { name: 'marketdata.databento.backfill', state: 'running', startedAt: null, finishedAt: null, message: null } }
    })
    wrap(<DatabentoPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Estimate cost (free)' }))
    expect(await screen.findByText('$2.54')).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Run backfill…' }))
    const confirm = screen.getByRole('button', { name: /Confirm backfill · \$2\.54/ })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I authorise spending up to \$2\.81/))
    fireEvent.click(confirm)
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[1][1]).toMatchObject({ roots: ['GC'], maxCost: 2.81, start: '2010-06-06', end: '2026-09-30' })
  })
})

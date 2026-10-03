// @vitest-environment jsdom
// Smoke-renders every portfolio route against real API response shapes
// (captured from the demo-seeded server, trimmed) and against an empty ledger.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../app/theme'
import demo from './__fixtures__/demo.json'

let fixtures: Record<string, unknown> = demo

vi.mock('../../api/client', () => {
  const respond = (url: string) => {
    const path = url.replace(/^\/portfolio/, '').split('?')[0]
    if (!(path in fixtures)) return Promise.reject(new Error(`No fixture for ${path}`))
    return Promise.resolve({ data: fixtures[path] })
  }
  return {
    api: {
      get: vi.fn((url: string) => respond(url)),
      request: vi.fn((cfg: { url: string }) => respond(cfg.url)),
    },
  }
})

const EMPTY = {
  '/summary': {
    empty: true, asOf: '2026-09-30', nav: 0, navPerUnit: null, unitsOutstanding: null, dayReturn: null, mtdReturn: null, ytdReturn: null,
    sinceInceptionReturn: null, dayPnl: null, allocation: [], byAsset: [], inceptionDate: null, cash: 0, grossExposure: 0, netExposure: [],
    unrealizedPnl: 0, realizedPnl: 0, income: 0, expenses: 0, totalPnl: 0, netContributions: 0, transactionCount: 0, warnings: [],
    provenance: { source: 'Fund ledger', asOf: null },
  },
  '/holdings': { asOf: null, nav: 0, holdings: [], cash: [], totalCash: 0, warnings: [], provenance: { source: 'Fund ledger', asOf: null } },
  '/vault': { items: [], totals: [], haircut: 0, warnings: [], provenance: { source: 'Vault', asOf: null } },
  '/transactions': [],
  '/accounts': [],
  '/instruments': (demo as Record<string, unknown>)['/instruments'],
  '/settings': (demo as Record<string, unknown>)['/settings'],
  '/import/batches': [],
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  fixtures = demo
})

async function renderAt(path: string) {
  const { routes } = await import('./routes')
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('portfolio pages (demo ledger)', () => {
  it('renders holdings with the NAV hero, allocation and FIFO tables', async () => {
    await renderAt('/portfolio')
    expect(await screen.findByText(/Net asset value/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Allocation by sleeve' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ETFs and miners' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GLD/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('heading', { name: 'Futures' })).toBeInTheDocument()
  })

  it('renders the ledger with filters, rows and fund setup', async () => {
    await renderAt('/portfolio/ledger')
    expect(await screen.findByRole('button', { name: 'New transaction' })).toBeEnabled()
    const table = await screen.findByRole('table', { name: 'Ledger transactions' })
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(5)
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Fund settings' })).toBeInTheDocument()
  })

  it('opens the transaction drawer from ?new=1', async () => {
    await renderAt('/portfolio/ledger?new=1')
    expect(await screen.findByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record transaction' })).toBeInTheDocument()
  })

  it('renders performance, risk and attribution', async () => {
    await renderAt('/portfolio/performance')
    expect(await screen.findByRole('heading', { name: 'NAV per unit vs benchmark' }, { timeout: 15_000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly returns' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Attribution' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Value at risk' })).toBeInTheDocument()
  })

  it('renders the vault register', async () => {
    await renderAt('/portfolio/vault')
    expect(await screen.findByRole('heading', { name: 'Physical register' })).toBeInTheDocument()
    expect(screen.getByText('1 kg cast bar')).toBeInTheDocument()
  })

  it('renders the scenario form', async () => {
    await renderAt('/portfolio/scenario')
    expect(await screen.findByRole('button', { name: 'Run scenario' })).toBeInTheDocument()
  })
})

describe('portfolio pages (empty ledger)', () => {
  it('shows the record-your-first-transaction state on holdings and performance', async () => {
    fixtures = EMPTY
    await renderAt('/portfolio')
    expect(await screen.findByRole('link', { name: 'Record your first transaction' })).toHaveAttribute('href', '/portfolio/ledger?new=1')
  })

  it('asks for an account first on an empty ledger', async () => {
    fixtures = EMPTY
    await renderAt('/portfolio/ledger')
    expect(await screen.findByText(/Start by adding the account/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled()
  })

  it('shows the empty vault state', async () => {
    fixtures = EMPTY
    await renderAt('/portfolio/vault')
    expect(await screen.findByText('The vault register is empty')).toBeInTheDocument()
  })
})

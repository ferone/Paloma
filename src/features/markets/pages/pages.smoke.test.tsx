// @vitest-environment jsdom
// Smoke tests: every Markets page renders real (recorded) API payloads without
// throwing, shows its key figures and labels modeled data.
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SettingsProvider } from '../../../store/settings-context'
import curve from '../__fixtures__/curve-gold.json'
import curveHistory from '../__fixtures__/curve-history-gold.json'
import etfs from '../__fixtures__/etfs-silver.json'
import liquidity from '../__fixtures__/liquidity-gold.json'
import liquidityHistory from '../__fixtures__/liquidity-history-gold-1m.json'
import gld from '../__fixtures__/history-gld-1y.json'
import quote from '../__fixtures__/quote-gc.json'
import CurvePage from './CurvePage'
import EtfsPage from './EtfsPage'
import LiquidityPage from './LiquidityPage'
import ComparisonPage from './ComparisonPage'
import TechnicalsPage from './TechnicalsPage'
import PricesPage from './PricesPage'

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  fetchCurve: vi.fn(async () => curve),
  fetchCurveHistory: vi.fn(async () => curveHistory),
  fetchEtfs: vi.fn(async () => etfs),
  fetchLiquidity: vi.fn(async () => liquidity),
  fetchLiquidityHistory: vi.fn(async () => liquidityHistory),
  fetchHistory: vi.fn(async () => gld),
  fetchQuote: vi.fn(async () => quote),
  fetchQuotes: vi.fn(async (symbols: string[]) => symbols.map((s) => ({ ...quote, symbol: s }))),
}))

// Canvas charts can't run in jsdom: stub the lightweight-charts API surface we use.
vi.mock('lightweight-charts', async (orig) => {
  const series = { setData: vi.fn(), createPriceLine: vi.fn() }
  const chart = {
    addSeries: vi.fn(() => series),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    panes: vi.fn(() => [{ setHeight: vi.fn() }, { setHeight: vi.fn() }]),
    remove: vi.fn(),
  }
  return { ...(await orig<typeof import('lightweight-charts')>()), createChart: vi.fn(() => chart) }
})

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  localStorage.setItem('gid.metal', 'gold')
})

function renderAt(node: ReactNode, path = '/', route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SettingsProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={node} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

describe('Markets pages', () => {
  it('term structure shows shape, carry and the contracts table', async () => {
    renderAt(<CurvePage />)
    expect(await screen.findByText('Listed contract months')).toBeInTheDocument()
    expect(screen.getByText('Contango')).toBeInTheDocument()
    expect(screen.getAllByText('Ref').length).toBeGreaterThan(0)
    expect(await screen.findByText(/History is still being recorded/)).toBeInTheDocument()
  })

  it('ETFs show NAV premia and flag modeled ones', async () => {
    renderAt(<EtfsPage />)
    expect((await screen.findAllByText('SLV')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('PSLV').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Modeled').length).toBeGreaterThan(0)
  })

  it('liquidity labels every modeled figure', async () => {
    renderAt(<LiquidityPage />)
    expect(await screen.findByText(/Today's dollar volume by instrument/)).toBeInTheDocument()
    expect(screen.getByText(/source split modeled from World Gold Council shares/)).toBeInTheDocument()
    const split = screen.getByText(/By participant type/).parentElement as HTMLElement
    // 5 sources, each with its own chip
    expect(within(split).getAllByText('Modeled')).toHaveLength(5)
  })

  it('comparison renders returns and the correlation matrix', async () => {
    renderAt(<ComparisonPage />)
    expect(await screen.findByText('Correlation of daily returns (1Y)')).toBeInTheDocument()
    expect(await screen.findAllByText('1.00')).not.toHaveLength(0)
  })

  it('technicals compute indicators for the routed symbol', async () => {
    renderAt(<TechnicalsPage />, '/markets/signals/GLD', '/markets/signals/:symbol')
    expect(await screen.findByText('Signal summary')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^RSI \d/ })).toBeInTheDocument()
  })

  it('prices page renders hero, chart panel, ratio and ETF strip', async () => {
    renderAt(<PricesPage />)
    expect(await screen.findByText(/COMEX front future \(GC=F\)/)).toBeInTheDocument()
    expect(screen.getByText('Gold ETFs & miners')).toBeInTheDocument()
    expect(await screen.findByText('Gold/silver ratio')).toBeInTheDocument()
  })
})

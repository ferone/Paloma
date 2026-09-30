// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { CorrelationResponse, CotResponse, MacroDashboard, SeriesResponse } from '@shared/macro'
import type { AiModelsResponse, AiReport, AiStatus } from '@shared/ai'

// Mount every macro page against a mocked API to catch render-time errors.
const days = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 6, 1) + i * 86_400_000).toISOString().slice(0, 10))
const pts = (base: number, drift: number) => days.map((date, i) => ({ date, value: base + i * drift + Math.sin(i / 7) }))

const dashboard: MacroDashboard = {
  asset: 'gold',
  asOf: '2026-09-30',
  regime: {
    label: 'Real yields rising · Dollar stable · Risk mixed',
    parts: [
      { key: 'realYields', label: 'Real yields rising', stance: 'headwind' },
      { key: 'dollar', label: 'Dollar stable', stance: 'neutral' },
      { key: 'risk', label: 'Risk mixed', stance: 'neutral' },
    ],
  },
  scorecard: [
    { id: 'DFII10', label: 'Real yield (10y TIPS)', seriesId: 'DFII10', value: 2.9, unit: 'percent', changeKind: 'diff', change1m: 0.48, change3m: 0.72, z: 4, stance: 'headwind', reason: 'Real yield +0.72pp over 3m: rising', rule: 'rule', asOf: '2026-09-28' },
    { id: 'COT_MM', label: 'Managed-money positioning (COT)', seriesId: 'COT_MM', value: 30.9, unit: 'percent', changeKind: 'diff', change1m: null, change3m: null, z: 0.2, stance: 'neutral', reason: 'MM net 30.9% of OI', rule: 'rule', asOf: '2026-09-22' },
  ],
  netScore: -1,
  tailwinds: 0,
  headwinds: 1,
  series: [
    { id: 'DFII10', label: '10y real yield', description: 'd', unit: 'percent', changeKind: 'diff', frequency: 'daily', source: 'fred', url: null, latest: 2.9, latestDate: '2026-09-28', change1m: 0.48, change3m: 0.72, z: 4, percentile: 1, observations: 300, provenance: { source: 'FRED DFII10', asOf: '2026-09-28' } },
  ],
  refresh: { fred: null, cot: null, all: null },
  empty: false,
}

const meta = (id: string, label: string) => ({ id, label, description: '', unit: 'percent' as const, changeKind: 'diff' as const, frequency: 'daily' as const, source: 'fred', url: null })
const series: SeriesResponse = {
  series: [
    { ...meta('GOLD', 'Gold'), unit: 'usd', points: pts(3000, 3), provenance: { source: 'Yahoo', asOf: days.at(-1)! } },
    { ...meta('DFII10', '10y real yield'), points: pts(2, 0.003), provenance: { source: 'FRED', asOf: days.at(-1)! } },
  ],
}

const cotHistory = days.map((d, i) => ({
  reportDate: d,
  publishedAt: `${d}T20:30:00Z`,
  openInterest: 400000,
  specNet: 100000 + i * 100,
  specNetPctOi: 0.25 + Math.sin(i / 10) * 0.05,
  specPercentile3y: 0.6,
  specZ3y: 0.2,
  specNetChange: 100,
  nets: { prod: -20000, swap: -200000 },
}))
// GOLD answers as a disaggregated market, SILVER as a TFF one, so both speculator labels render.
const cot = (market: 'GOLD' | 'SILVER'): CotResponse => ({
  market,
  marketName: `${market} - COMMODITY EXCHANGE INC.`,
  report: market === 'GOLD' ? 'disagg' : 'tff',
  speculator:
    market === 'GOLD'
      ? { category: 'mm', label: 'Managed money', short: 'MM', driverId: 'COT_MM' }
      : { category: 'lev_money', label: 'Leveraged funds', short: 'Lev. funds', driverId: 'COT_LF' },
  latest: {
    reportDate: '2026-09-22',
    publishedAt: '2026-09-25T20:30:00Z',
    openInterest: 412800,
    changeOpenInterest: 2901,
    categories: [
      market === 'GOLD'
        ? { id: 'mm', name: 'Managed money', speculator: true, long: 135699, short: 8310, net: 127389, changeLong: -6695, changeShort: -968, changeNet: -5727, netPctOi: 0.3086 }
        : { id: 'lev_money', name: 'Leveraged funds', speculator: true, long: 4745, short: 12698, net: -7953, changeLong: -800, changeShort: 799, changeNet: -1599, netPctOi: -0.356 },
    ],
    specNetPctOi: 0.3086,
    specPercentile3y: 0.61,
    specZ3y: 0.2,
  },
  history: cotHistory,
  provenance: { source: 'CFTC', asOf: '2026-09-22' },
})

const factors = ['gold', 'silver', 'realYield', 'dxy', 'vix', 'spy'] as const
const corr: CorrelationResponse = {
  asset: 'gold',
  window: 63,
  asOf: '2026-09-28',
  factors: factors.map((id) => ({ id, label: id, transform: 't' })),
  rolling: days.map((date) => ({ date, values: { silver: 0.8, realYield: -0.3, dxy: -0.5, vix: -0.2, spy: 0.4 } })),
  matrix: { factors: [...factors], values: factors.map((a) => factors.map((b) => (a === b ? 1 : -0.3))) },
  betas: [{ factor: 'realYield', correlation: -0.3, beta: -0.1, n: 63 }],
  provenance: { source: 'Yahoo · FRED', asOf: '2026-09-28' },
}

const status: AiStatus = { configured: false, model: 'anthropic/claude-sonnet-4.6', online: true, effectiveModel: 'anthropic/claude-sonnet-4.6:online', defaultModel: 'anthropic/claude-sonnet-4.6' }
const models: AiModelsResponse = { models: [{ id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', contextLength: 200000, promptPrice: 3, completionPrice: 15 }], fetchedAt: '2026-09-30T00:00:00Z' }
const report: AiReport = {
  id: 1, kind: 'ask', metal: 'gold', model: 'x:online', status: 'succeeded', error: null, createdAt: '2026-09-30T16:00:00Z', asOf: '2026-09-30',
  title: 'Why is gold down?', request: { kind: 'ask', metal: 'gold', input: { question: 'Why is gold down?' } },
  body: { kind: 'ask', question: 'Why is gold down?', answer: 'Real yields rose.', points: [{ text: 'DFII10 2.90%', sources: [{ url: 'https://fred.stlouisfed.org/series/DFII10' }], sourced: true }] },
  sources: [{ url: 'https://fred.stlouisfed.org/series/DFII10' }], webResults: [], context: [], droppedSources: 0, unsourcedCount: 0, online: true, tokens: 5000, costUsd: 0.01,
}

vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn(async (url: string, cfg?: { params?: Record<string, string> }) => {
      const data: Record<string, unknown> = {
        '/macro/dashboard': dashboard,
        '/macro/series': series,
        '/macro/cot': cot((cfg?.params?.market as 'GOLD' | 'SILVER') ?? 'GOLD'),
        '/macro/correlations': corr,
        '/ai/status': status,
        '/ai/models': models,
        '/ai/reports': [{ ...report, body: undefined }],
        '/ai/reports/1': report,
      }
      if (!(url in data)) throw new Error(`unmocked ${url}`)
      return { data: data[url] }
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

// jsdom lacks ResizeObserver (recharts ResponsiveContainer).
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO

async function wrap(node: ReactNode) {
  const { ThemeProvider } = await import('../../../app/theme')
  const { SettingsProvider } = await import('../../../store/settings-context')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <SettingsProvider>
          <MemoryRouter>{node}</MemoryRouter>
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

// First test pays the cold import of recharts and the pages.
describe('macro pages render', { timeout: 30_000 }, () => {
  beforeEach(() => {
    document.documentElement.classList.add('dark')
  })

  it('dashboard: regime strip, scorecard and charts', async () => {
    const { default: Page } = await import('./DashboardPage')
    await wrap(<Page />)
    expect(await screen.findByText('Real yields rising')).toBeTruthy()
    expect(screen.getByText('Real yield +0.72pp over 3m: rising')).toBeTruthy()
    expect(screen.getAllByText('Headwind').length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText('Gold price')).toBeTruthy())
  })

  it('positioning: both markets with category tables', async () => {
    const { default: Page } = await import('./PositioningPage')
    await wrap(<Page />)
    await waitFor(() => expect(screen.getAllByText('Positions by trader category')).toHaveLength(2))
    expect(screen.getAllByText('Managed money').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Leveraged funds').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Lev. funds net % OI').length).toBeGreaterThan(0)
    expect(screen.getByText('Gold · COMEX')).toBeTruthy()
  })

  it('correlations: matrix with text values', async () => {
    const { default: Page } = await import('./CorrelationsPage')
    await wrap(<Page />)
    await waitFor(() => expect(screen.getByText(/Correlation matrix/)).toBeTruthy())
    expect(screen.getAllByText('−0.30').length).toBeGreaterThan(5)
  })

  it('analyst: not-configured state, history and reader', async () => {
    const { default: Page } = await import('./AnalystPage')
    await wrap(<Page />)
    await waitFor(() => expect(screen.getByText('Integration not configured')).toBeTruthy())
    expect(await screen.findByText('Real yields rose.')).toBeTruthy()
    expect(screen.getAllByText('Why is gold down?').length).toBeGreaterThan(0)
  })
})

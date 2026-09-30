// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '../../store/settings-context'
import { computeQuant, type QuantResult } from '../../../server/quant/run/compute'
import { makeFixture } from '../../../server/quant/testing/fixture'

// TEST-ONLY: a synthetic engine result served through a mocked API client.
let res: QuantResult

function route(url: string): unknown {
  const u = new URL(url, 'http://x')
  const p = u.pathname
  const metal = u.searchParams.get('asset') ?? u.searchParams.get('metal') ?? 'gold'
  const mode = (u.searchParams.get('mode') ?? 'conservative') as 'conservative' | 'aggressive'
  const forMetal = (o: { metal: string; product: string }) => o.metal === metal || o.product === 'GS'
  if (p === '/quant/status') return { run: { id: 1, generatedAt: res.generatedAt, dataThrough: res.dataThrough, instruments: res.instruments.length, durationMs: 1 }, job: null, hasData: true }
  if (p === '/quant/opportunities') return { metal, mode, asOf: res.generatedAt, dataThrough: res.dataThrough, rows: res.opportunities[mode].filter(forMetal), provenance: { source: 'test', asOf: res.dataThrough } }
  if (p === '/quant/instruments') return res.instruments.filter((i) => i.metal === metal || i.product === 'GS').map((i) => ({ id: i.id, label: i.label, kind: i.kind, metal: i.metal }))
  if (p.startsWith('/quant/instrument/')) return res.instruments.find((i) => i.id === decodeURIComponent(p.split('/').pop()!))
  if (p.startsWith('/quant/seasonality/')) return res.seasonality.find((i) => i.id === decodeURIComponent(p.split('/').pop()!))
  if (p === '/quant/relative-value') return res.relativeValue.find((r) => r.pair === u.searchParams.get('pair'))
  if (p.startsWith('/quant/curve/')) return res.curves.find((c) => c.root === p.split('/').pop())
  if (p === '/quant/backtest') return res.backtests.find((b) => b.metal === metal && b.mode === mode)
  if (p === '/quant/gates') return res.gates.find((g) => g.metal === metal)
  throw new Error(`unmocked ${url}`)
}

vi.mock('../../api/client', () => ({
  api: {
    get: async (url: string) => ({ data: route(url) }),
    post: async () => ({ data: { job: 'quant.recompute', state: 'running', startedAt: null } }),
  },
}))

beforeAll(async () => {
  const gc = makeFixture({ root: 'GC', startYear: 2014, endDate: '2024-03-28', spot0: 1500, seed: 3 })
  const si = makeFixture({ root: 'SI', startYear: 2014, endDate: '2024-03-28', spot0: 22, vol: 0.016, seed: 4 })
  res = computeQuant({ roots: { GC: gc, SI: si }, generatedAt: '2024-03-29T06:00:00.000Z' })
  // routes import lazily; warm them so findBy* timeouts stay short
  await import('./routes')
}, 240_000)

async function renderAt(path: string) {
  const { routes } = await import('./routes')
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SettingsProvider>
        <RouterProvider router={router} />
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

describe('Quant Lab pages', () => {
  it('scanner lists ranked opportunities with explicit verdict directions', async () => {
    await renderAt('/quant')
    expect(await screen.findByText('Ranked opportunities', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getAllByText(/Stand aside|Buy · long|Sell · short/).length).toBeGreaterThan(3)
    expect(screen.getByText(/Engine run/)).toBeTruthy()
    cleanup()
  })

  it('instrument detail shows the verdict explanation and trade ticket', async () => {
    await renderAt('/quant/i/GC.fly.0-1-2')
    expect(await screen.findByText('Why this verdict', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByText('Trade ticket')).toBeTruthy()
    expect(screen.getByText(/Curvature — the bow/)).toBeTruthy()
    expect(screen.getByText('Structural-move gate')).toBeTruthy()
    expect(screen.getByText('Out-of-sample validation')).toBeTruthy()
    cleanup()
  })

  it('spreads, seasonality, relative value, curve and backtest render', async () => {
    await renderAt('/quant/spreads')
    expect(await screen.findByText(/value & z-bands/, {}, { timeout: 10_000 })).toBeTruthy()
    cleanup()
    await renderAt('/quant/seasonality?id=GC.seas.M-Q')
    expect(await screen.findByText('Seasonal envelope', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByText('Monthly returns')).toBeTruthy()
    expect(screen.getByText('Seasonal pair edges')).toBeTruthy()
    cleanup()
    await renderAt('/quant/relative-value')
    expect(await screen.findByText('Gold/silver ratio', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByText('Gold − silver dollar spread')).toBeTruthy()
    expect(screen.getAllByText(/^1 GC : [\d.]+ SI$/).length).toBeGreaterThanOrEqual(1) // hedge (+ vol-parity)
    expect(screen.getByText(/100 oz gold − 5,000 oz silver \(1 GC vs 1 SI\)/)).toBeTruthy()
    expect(screen.getByText('Full analysis & trade ticket →').getAttribute('href')).toBe('/quant/i/GS.ratio')
    cleanup()
    await renderAt('/quant/curve')
    expect(await screen.findByText(/COMEX Gold term structure/, {}, { timeout: 10_000 })).toBeTruthy()
    cleanup()
    await renderAt('/quant/backtest')
    expect(await screen.findByText('Equity curve', {}, { timeout: 10_000 })).toBeTruthy()
    expect(await screen.findByText('QT gate ablation')).toBeTruthy()
    cleanup()
  })
})

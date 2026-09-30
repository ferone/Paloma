// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { SettingsProvider } from '../../store/settings-context'
import { computeQuant, type QuantResult } from '../../../server/quant/run/compute'
import { makeFixture } from '../../../server/quant/testing/fixture'

// TEST-ONLY: a synthetic bitcoin + gold engine result (with a spot series and a flat T-bill)
// served through a mocked API client.
let res: QuantResult

function route(url: string): unknown {
  const u = new URL(url, 'http://x')
  const p = u.pathname
  const metal = u.searchParams.get('asset') ?? 'btc'
  const mode = (u.searchParams.get('mode') ?? 'conservative') as 'conservative' | 'aggressive'
  const forMetal = (o: { metal: string; product: string }) => o.metal === metal || o.product === 'BG'
  if (p === '/quant/status') return { run: { id: 1, generatedAt: res.generatedAt, dataThrough: res.dataThrough, instruments: res.instruments.length, durationMs: 1 }, job: null, hasData: true }
  if (p === '/quant/opportunities') return { metal, mode, asOf: res.generatedAt, dataThrough: res.dataThrough, rows: res.opportunities[mode].filter(forMetal), provenance: { source: 'test', asOf: res.dataThrough } }
  if (p.startsWith('/quant/instrument/')) return res.instruments.find((i) => i.id === decodeURIComponent(p.split('/').pop()!))
  if (p === '/quant/relative-value') return res.relativeValue.find((r) => r.pair === u.searchParams.get('pair'))
  throw new Error(`unmocked ${url}`)
}

vi.mock('../../api/client', () => ({
  api: {
    get: async (url: string) => ({ data: route(url) }),
    post: async () => ({ data: { job: 'quant.recompute', state: 'running', startedAt: null } }),
  },
}))

beforeAll(async () => {
  const gc = makeFixture({ root: 'GC', startYear: 2016, endDate: '2023-06-30', spot0: 1600, seed: 3 })
  const btc = makeFixture({ root: 'BTC', startYear: 2016, endDate: '2023-06-30', spot0: 30_000, vol: 0.03, carry: 0.08, seed: 303 })
  const spot = [...btc.spot.entries()].map(([date, close]) => ({ date, close }))
  res = computeQuant({
    roots: { GC: gc, BTC: btc },
    daily: { 'BTC-USD': spot, '^IRX': spot.map((s) => ({ date: s.date, close: 4 })) },
    generatedAt: '2023-07-01T06:00:00.000Z',
    skipBacktests: true,
  })
  localStorage.setItem('gid.asset', 'btc')
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

describe('Cash-and-carry basis views', () => {
  it('the instrument page shows basis vs T-bill, the excess-carry bands and a carry ticket', async () => {
    await renderAt('/quant/i/BTC.basis')
    expect(await screen.findByText('Annualized basis vs the T-bill', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByText('Excess carry and its z-bands')).toBeTruthy()
    expect(screen.getByText('Carry trade ticket')).toBeTruthy()
    expect(screen.getByText(/buy 5 BTC spot \(BTC-USD\)/)).toBeTruthy()
    expect(screen.getByText(/^sell 1 BTC[FGHJKMNQUVXZ]\d\d$/)).toBeTruthy()
    expect(screen.getByText('What is the cash-and-carry basis?')).toBeTruthy()
    expect(screen.getByText('OOS trades')).toBeTruthy()
    expect(screen.getAllByText(/carry harvest, not a directional bet/i).length).toBeGreaterThan(0)
    cleanup()
  })

  it('the Relative-value page gains a cash-and-carry basis section for bitcoin', async () => {
    await renderAt('/quant/relative-value')
    expect(await screen.findByText('Cash-and-carry basis', {}, { timeout: 10_000 })).toBeTruthy()
    expect(await screen.findByText('Basis verdict', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByText('Full analysis & carry ticket →').getAttribute('href')).toBe('/quant/i/BTC.basis')
    cleanup()
  })

  it('the scanner lists the basis as a bitcoin relative-value row', async () => {
    await renderAt('/quant')
    expect(await screen.findByText('Ranked opportunities', {}, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getAllByText(/Cash-and-carry basis · BTC\.basis/).length).toBeGreaterThan(0)
    cleanup()
  })
})

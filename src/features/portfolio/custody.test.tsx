// @vitest-environment jsdom
// Vault register with a custody asset. No universe asset uses custody yet, so
// the universe is extended with a fake BTC spec held in a wallet.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../app/theme'
import demo from './__fixtures__/demo.json'

vi.mock('@shared/universe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/universe')>()
  const btc = {
    ...actual.UNIVERSE.gold,
    id: 'btc',
    metal: 'btc',
    label: 'Bitcoin',
    short: 'BTC',
    assetClass: 'crypto',
    spot: 'BTC-USD',
    priceUnit: 'BTC',
    unitLabel: '$/BTC',
    session: '24x7',
    futures: [],
    etfs: ['IBIT'],
    miners: undefined,
    benchmarkEtf: 'IBIT',
    physical: { unit: 'BTC', kind: 'custody', instrumentId: 'BTC-CUSTODY' },
    cot: null,
    colorVar: '--series-4',
  }
  const ASSETS = [...actual.ASSETS, 'btc']
  const UNIVERSE = { ...actual.UNIVERSE, btc }
  return { ...actual, ASSETS, UNIVERSE, physicalAssets: () => ASSETS.filter((a) => (UNIVERSE as Record<string, { physical: unknown }>)[a].physical) }
})

const WALLET = { id: 9, name: 'Cold wallet', custody: 'wallet', institution: null, notes: null, createdAt: '' }
const ITEM = {
  id: 77, asset: 'btc', form: 'balance', description: 'Cold storage multisig', weight: 1.5, weightUnit: 'BTC', purity: 1, fineQty: 1.5,
  serial: 'bc1q-demo', refiner: null, accountId: 9, acquisitionTxnId: null, acquiredDate: '2026-01-05', premiumPaid: null,
  storageFeeRateAnnual: null, status: 'held', notes: null, accountName: 'Cold wallet', spot: 64000, value: 96000, storageAccrued: 0,
}
const fixtures: Record<string, unknown> = {
  ...demo,
  '/accounts': [...demo['/accounts'], WALLET],
  '/vault': {
    items: [ITEM],
    totals: [{ asset: 'btc', unitLabel: 'BTC', items: 1, fineQty: 1.5, value: 96000, premiumPaid: 0, storageAccrued: 0, ledgerQty: 1.5 }],
    haircut: 0,
    warnings: [],
    provenance: { source: 'Vault register', asOf: '2026-09-30' },
  },
}

vi.mock('../../api/client', () => {
  const respond = (url: string) => {
    const path = url.replace(/^\/portfolio/, '').split('?')[0]
    if (!(path in fixtures)) return Promise.reject(new Error(`No fixture for ${path}`))
    return Promise.resolve({ data: fixtures[path] })
  }
  return { api: { get: vi.fn((url: string) => respond(url)), request: vi.fn((cfg: { url: string }) => respond(cfg.url)) } }
})

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

async function renderVault() {
  const { routes } = await import('./routes')
  const router = createMemoryRouter(routes, { initialEntries: ['/portfolio/vault'] })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('vault register with a custody asset', () => {
  it('shows a custody balance in its own unit', async () => {
    await renderVault()
    expect(await screen.findByText('Cold storage multisig')).toBeInTheDocument()
    expect(screen.getByText('Balance (BTC)')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Physical register' })
    expect(within(table).getAllByText('1.5000 BTC').length).toBe(2)
  })

  it('switches the form to a balance in BTC for a custody asset', async () => {
    await renderVault()
    fireEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = await screen.findByRole('dialog', { name: 'Register a holding' })
    expect(within(dialog).getByText('Fineness')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Asset'), { target: { value: 'btc' } })
    expect(within(dialog).getByLabelText('Balance (BTC)')).toBeInTheDocument()
    expect(within(dialog).queryByText('Fineness')).not.toBeInTheDocument()
    expect((within(dialog).getByLabelText('Location (account)') as HTMLSelectElement).value).toBe('9')
    expect(within(dialog).getByRole('option', { name: 'Cold wallet · Wallet (self-custody)' })).toBeInTheDocument()
  })
})

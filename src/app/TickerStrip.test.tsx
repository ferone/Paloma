// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsProvider } from '../store/settings-context'
import { TICKER_STORAGE_KEY } from './tickerConfig'
import { TickerStrip } from './TickerStrip'

const PRICES: Record<string, number> = { 'GC=F': 4000, 'SI=F': 50 }

vi.mock('../features/markets/api', async (orig) => ({
  ...(await orig<typeof import('../features/markets/api')>()),
  fetchQuote: vi.fn(async (symbol: string) => ({ symbol, shortName: symbol, price: PRICES[symbol] ?? 1, previousClose: 1, change: 0, changePercent: 1.5, dayHigh: 1, dayLow: 1, volume: 1, marketState: 'REGULAR', timestamp: 0 })),
}))

function renderStrip() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SettingsProvider>
        <TickerStrip />
      </SettingsProvider>
    </QueryClientProvider>,
  )
}

describe('TickerStrip', () => {
  beforeEach(() => localStorage.clear())

  it('shows every asset and the gold/silver ratio by default', async () => {
    renderStrip()
    expect(await screen.findByText('$4,000.00')).toBeTruthy()
    expect(await screen.findByText('$50.000')).toBeTruthy()
    expect(screen.getByText('Au')).toBeTruthy()
    expect(screen.getByText('Ag')).toBeTruthy()
    expect(screen.getByText('Au/Ag')).toBeTruthy()
    expect(await screen.findByText('80.0')).toBeTruthy()
  })

  it('persists the selection when an item is toggled off', async () => {
    renderStrip()
    fireEvent.click(screen.getByRole('button', { name: 'Choose tickers' }))
    const ratio = screen.getByRole('checkbox', { name: /Au\/Ag/ })
    fireEvent.click(ratio)
    expect(JSON.parse(localStorage.getItem(TICKER_STORAGE_KEY)!)).toEqual(['asset:gold', 'asset:silver', 'asset:btc', 'pair:BG'])
    expect(screen.queryByText('80.0')).toBeNull()
  })
})

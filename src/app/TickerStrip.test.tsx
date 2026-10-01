// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsProvider } from '../store/settings-context'
import { TICKER_STORAGE_KEY, allTickerKeys } from './tickerConfig'
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
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('gid.asset', 'gold')
  })

  it('shows focus asset, gold, BTC and the natural ratio; the rest behind +N', async () => {
    renderStrip()
    expect(await screen.findByText('$4,000.00')).toBeTruthy()
    expect(screen.getByText('Au')).toBeTruthy()
    expect(screen.getByText('BTC')).toBeTruthy()
    expect(screen.getByText('Au/Ag')).toBeTruthy()
    expect(await screen.findByText('80.0')).toBeTruthy()
    expect(screen.queryByText('Ag')).toBeNull()
    const more = screen.getByRole('button', { name: `${allTickerKeys().length - 3} more tickers` })
    expect(more.textContent).toBe(`+${allTickerKeys().length - 3}`)
  })

  it('overflow menu is keyboard navigable and Escape closes it, returning focus', async () => {
    renderStrip()
    const more = await screen.findByRole('button', { name: /more tickers/ })
    more.focus()
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: 'More tickers' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(allTickerKeys().length - 3)
    expect(document.activeElement).toBe(items[0])
    expect(items[0].textContent).toContain('Ag')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items.at(-1))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('choosing an asset in the overflow puts it in focus, and it leads the strip', async () => {
    renderStrip()
    fireEvent.click(await screen.findByRole('button', { name: /more tickers/ }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]) // silver
    expect(localStorage.getItem('gid.asset')).toBe('silver')
    expect(await screen.findByText('Ag')).toBeTruthy()
    expect(screen.getByRole('button', { name: `${allTickerKeys().length - 4} more tickers` })).toBeTruthy()
  })

  it('keeps a saved custom selection in full and persists toggles; reset returns to the default', async () => {
    localStorage.setItem(TICKER_STORAGE_KEY, JSON.stringify(['asset:gold', 'asset:silver', 'pair:GS']))
    renderStrip()
    expect(await screen.findByText('$50.000')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /more tickers/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose tickers' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Au\/Ag/ }))
    expect(JSON.parse(localStorage.getItem(TICKER_STORAGE_KEY)!)).toEqual(['asset:gold', 'asset:silver'])
    expect(screen.queryByText('80.0')).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    })
    expect(localStorage.getItem(TICKER_STORAGE_KEY)).toBeNull()
    expect(screen.getByRole('button', { name: /more tickers/ })).toBeTruthy()
  })

  it('migrates the legacy saved full list to the new default', async () => {
    localStorage.setItem(TICKER_STORAGE_KEY, JSON.stringify(allTickerKeys()))
    renderStrip()
    expect(await screen.findByRole('button', { name: /more tickers/ })).toBeTruthy()
  })
})

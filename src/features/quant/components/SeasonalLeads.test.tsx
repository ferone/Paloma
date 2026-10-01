// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { QuantOpportunity } from '@shared/quant'
import { SeasonalLeads, seasonalLeads } from './SeasonalLeads'

vi.mock('../../../api/client', () => ({
  api: {
    get: async (url: string) => ({
      data: url.includes('HG.seas.U-Z')
        ? { windows: [{ entryLabel: '5 Mar', exitLabel: '19 Apr', active: false }], oos: { trades: 12, sharpe: 0.6153 } }
        : { status: 'not_computed', message: 'test', action: 'none' },
    }),
  },
}))

function opp(p: Partial<QuantOpportunity>): QuantOpportunity {
  return {
    id: 'X',
    metal: 'copper',
    label: 'X',
    kind: 'seasonal',
    product: 'HG',
    asOf: '2026-09-30',
    value: 0,
    unit: '¢/lb',
    z: null,
    zEff: null,
    halfLife: null,
    score: null,
    tier: 'WATCH',
    qtRank: 10,
    verdict: { action: 'AVOID', instruction: '', reasons: [] } as unknown as QuantOpportunity['verdict'],
    carry: null,
    gates: {} as QuantOpportunity['gates'],
    oos: 'passed',
    survivesRegime: true,
    mlProb: null,
    mlCounted: false,
    window: { side: 'short', entryLabel: '5 Mar', exitLabel: '19 Apr', winRate: 0.93 },
    evidence: [],
    ...p,
  }
}

const ROWS = [
  opp({ id: 'HG.seas.U-Z', label: 'Copper Sep–Dec (U−Z)', qtRank: 30 }),
  opp({ id: 'HG.seas.H-N', label: 'Copper Mar–Jul (H−N)', qtRank: 40, survivesRegime: false }),
  opp({ id: 'HG.seas.F-K', label: 'failed one', oos: 'failed' }),
  opp({ id: 'HG.cal.1-2', label: 'calendar', kind: 'calendar' }),
  opp({ id: 'GS.ratio', label: 'other asset', kind: 'ratio', metal: 'gold' }),
  opp({ id: 'GC.seas.M-Q', label: 'gold seasonal that failed', metal: 'gold', oos: 'failed' }),
]

afterEach(cleanup)

describe('seasonal leads', () => {
  it('keeps only OOS-passed seasonal windows of the selected asset, best rank first', () => {
    expect(seasonalLeads(ROWS, 'copper').map((o) => o.id)).toEqual(['HG.seas.H-N', 'HG.seas.U-Z'])
    expect(seasonalLeads(ROWS, 'gold')).toEqual([])
  })

  it('renders cards linking to the instrument page with the small-sample caveat', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SeasonalLeads rows={ROWS} asset="copper" />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Paper-trade first/)).toBeTruthy()
    expect(screen.getByText(/small sample/)).toBeTruthy()
    const link = screen.getByText('Copper Sep–Dec (U−Z)').closest('a')!
    expect(link.getAttribute('href')).toBe('/quant/i/HG.seas.U-Z')
    expect(await screen.findByText(/OOS 12 trades · Sharpe 0.62/)).toBeTruthy()
    expect(screen.getByText(/regime-fragile/)).toBeTruthy()
    expect(screen.queryByText('failed one')).toBeNull()
  })

  it('says so when the asset has no lead', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <SeasonalLeads rows={ROWS} asset="gold" />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText(/no gold seasonal window has passed/)).toBeTruthy()
  })
})

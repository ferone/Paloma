// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AiReport } from '@shared/ai'
import { ReportReader } from './ReportReader'

const report: AiReport = {
  id: 7,
  kind: 'macro_brief',
  metal: 'gold',
  model: 'anthropic/claude-sonnet-4.6:online',
  status: 'succeeded',
  error: null,
  createdAt: '2026-09-30T16:24:30Z',
  asOf: '2026-09-30',
  title: 'Gold macro brief',
  request: { kind: 'macro_brief', metal: 'gold' },
  body: {
    kind: 'macro_brief',
    summary: 'Real yields at 2.90% are the main headwind.',
    outlook: 'bearish',
    drivers: [
      { title: 'Real yields', detail: 'Up 72bp in 3m.', sentiment: 'bearish', sources: [{ url: 'https://fred.stlouisfed.org/series/DFII10', publisher: 'FRED' }], sourced: true },
      { title: 'ETF flows', detail: 'Outflows in Q2.', sentiment: 'neutral', sources: [], sourced: false },
    ],
    risks: [{ text: 'A Fed hike.', sources: [], sourced: false }],
    whatWouldChangeMyMind: [],
  },
  sources: [{ url: 'https://fred.stlouisfed.org/series/DFII10', publisher: 'FRED' }],
  webResults: [{ url: 'https://www.kitco.com/news/x', title: 'Gold rises' }],
  context: [
    { name: 'Macro dashboard', present: true, asOf: '2026-09-30' },
    { name: 'COT positioning', present: false, asOf: null },
  ],
  droppedSources: 2,
  unsourcedCount: 2,
  online: true,
  tokens: 25122,
  costUsd: 0.120914,
}

describe('ReportReader', () => {
  it('renders real source links, unsourced warnings, dropped links and cost', () => {
    render(<ReportReader report={report} />)
    expect(screen.getByRole('heading', { name: 'Gold macro brief' })).toBeTruthy()
    const links = screen.getAllByRole('link', { name: /FRED/ })
    expect(links[0].getAttribute('href')).toBe('https://fred.stlouisfed.org/series/DFII10')
    expect(links[0].getAttribute('rel')).toContain('noopener')
    expect(screen.getAllByText('Unsourced')).toHaveLength(2)
    expect(screen.getByText('2 unsourced')).toBeTruthy()
    expect(screen.getByText('2 unverifiable links removed')).toBeTruthy()
    expect(screen.getByText('$0.121')).toBeTruthy()
    expect(screen.getByText('COT positioning (absent)')).toBeTruthy()
    expect(screen.getByText('Web results consulted (1)')).toBeTruthy()
  })

  it('shows the failure message', () => {
    render(<ReportReader report={{ ...report, status: 'failed', error: 'OpenRouter HTTP 401', body: null }} />)
    expect(screen.getByRole('alert').textContent).toContain('OpenRouter HTTP 401')
  })
})

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { AiReportSummary } from '@shared/ai'
import { ReportHistory } from './ReportHistory'
import { shortModel } from './labels'

const base: AiReportSummary = {
  id: 1, kind: 'macro_brief', metal: 'gold', model: 'anthropic/claude-sonnet-4.6:online', status: 'succeeded', error: null,
  createdAt: '2026-10-01T09:15:00Z', asOf: '2026-09-30', title: 'Gold macro brief', request: { kind: 'macro_brief', metal: 'gold' },
  sources: [], droppedSources: 0, unsourcedCount: 0, online: true, tokens: 4000, costUsd: 0.03,
} as AiReportSummary

// Newest first, as the API returns them: the same brief run with two models on two dates.
const reports: AiReportSummary[] = [
  { ...base, id: 3, model: 'openai/gpt-4.1-mini', online: false, createdAt: '2026-10-03T14:20:00Z', costUsd: 0.004 },
  { ...base, id: 2, createdAt: '2026-10-03T08:00:00Z' },
  { ...base, id: 1, kind: 'ask', title: 'Why is gold down?', createdAt: '2026-10-01T09:15:00Z' },
]

describe('ReportHistory', () => {
  it('keeps every run, grouped by day, with model and the latest marked', () => {
    render(<ReportHistory reports={reports} activeId={3} latestId={3} onSelect={() => {}} />)
    expect(screen.getByText('3 saved · every run is kept')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2) // 3 Oct and 1 Oct
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Latest')).toBeTruthy()
    expect(within(items[0]).getByText('gpt-4.1-mini')).toBeTruthy()
    expect(within(items[1]).getByText('claude-sonnet-4.6 + web')).toBeTruthy()
  })

  it('filters by model and type, and selects an older run', () => {
    const onSelect = vi.fn()
    render(<ReportHistory reports={reports} activeId={3} latestId={3} onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Filter by model'), { target: { value: 'claude-sonnet-4.6' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('2 of 3 saved · every run is kept')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter by report type'), { target: { value: 'ask' } })
    const [only] = screen.getAllByRole('listitem')
    fireEvent.click(within(only).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('shortens model ids for display', () => {
    expect(shortModel('anthropic/claude-sonnet-4.6:online')).toBe('claude-sonnet-4.6')
    expect(shortModel('google/gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })
})

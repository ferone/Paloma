// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleStatus } from '@shared/marketdata'

const get = vi.fn()
const put = vi.fn()
vi.mock('../../api/client', () => ({ api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: vi.fn() } }))

import { SchedulerPanel } from './SchedulerPanel'

const status: ScheduleStatus = {
  enabled: true,
  timeUtc: '22:30',
  skipWeekends: true,
  jobs: ['marketdata.yahoo', 'portfolio.nav'],
  nextRunAt: '2026-10-01T22:30:00.000Z',
  lastRun: {
    date: '2026-09-30',
    startedAt: '2026-09-30T22:30:00.000Z',
    finishedAt: '2026-09-30T22:41:00.000Z',
    results: [
      { job: 'marketdata.yahoo', outcome: 'succeeded' },
      { job: 'portfolio.nav', outcome: 'failed' },
    ],
  },
  running: false,
  unknownJobs: [],
  isDefault: true,
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SchedulerPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SchedulerPanel', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
  })

  it('shows the default-on state, next run, last-run verdict and the Jobs link', async () => {
    get.mockResolvedValue({ data: status })
    wrap()
    expect(await screen.findByText('On')).toBeInTheDocument()
    expect(screen.getByText('default; not yet saved')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Data Center/ })).toHaveAttribute('href', '/data/jobs')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves an explicit "off" with the rest of the schedule unchanged', async () => {
    get.mockResolvedValue({ data: status })
    put.mockResolvedValue({ data: { ...status, enabled: false, nextRunAt: null, isDefault: false } })
    wrap()
    fireEvent.click(await screen.findByLabelText('Run every weekday'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    expect(put).toHaveBeenCalledWith('/marketdata/schedule', { enabled: false, timeUtc: '22:30', skipWeekends: true, jobs: ['marketdata.yahoo', 'portfolio.nav'] })
  })
})

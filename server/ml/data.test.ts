import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/yahoo-finance.service.js', () => ({ getHistorical: vi.fn() }))

import { useTestDb } from '../db/client.js'
import { readDailyBars, upsertDailyBars } from '../db/repo.js'
import { getHistorical } from '../services/yahoo-finance.service.js'
import { ensureYahooHistory, HISTORY_FROM } from './data.js'

const quote = (date: string, close = 100) => ({ date: `${date}T00:00:00.000Z`, open: close, high: close, low: close, close, volume: 1000 })
const bar = (symbol: string, date: string) => ({ symbol, date, open: 1, high: 1, low: 1, close: 1, volume: 1, source: 'yahoo' })

describe('ensureYahooHistory: whole history, extended backwards once', () => {
  beforeEach(() => {
    useTestDb()
    vi.mocked(getHistorical).mockReset()
  })

  it('asks for the full range once when stored history starts after HISTORY_FROM, then only refreshes the tail', async () => {
    expect(HISTORY_FROM).toBe('2000-01-01')
    upsertDailyBars([bar('GLD', '2008-01-02'), bar('GLD', '2026-09-28')])
    vi.mocked(getHistorical).mockResolvedValue([quote('2004-11-18'), quote('2026-10-01')] as never)
    expect(await ensureYahooHistory('GLD', '2026-10-02')).toBe(2)
    expect(vi.mocked(getHistorical).mock.calls[0][1]).toMatchObject({ range: 'ALL' })
    expect(readDailyBars('GLD', { source: 'yahoo' })[0].date).toBe('2004-11-18')

    // GLD simply starts in 2004: fresh data → no fetch at all; stale → tail only, never the full range again.
    vi.mocked(getHistorical).mockClear()
    expect(await ensureYahooHistory('GLD', '2026-10-02')).toBe(0)
    expect(getHistorical).not.toHaveBeenCalled()
    vi.mocked(getHistorical).mockResolvedValue([quote('2026-10-09')] as never)
    await ensureYahooHistory('GLD', '2026-10-10')
    expect(vi.mocked(getHistorical).mock.calls[0][1]).toMatchObject({ range: '1Y' })
  })

  it('does not refetch the full range when history already reaches HISTORY_FROM', async () => {
    upsertDailyBars([bar('SPY', '2000-01-03'), bar('SPY', '2026-10-01')])
    expect(await ensureYahooHistory('SPY', '2026-10-02')).toBe(0)
    expect(getHistorical).not.toHaveBeenCalled()
  })
})

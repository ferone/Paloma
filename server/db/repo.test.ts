import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from './client.js'
import { getSetting, setSetting, readArtifact, writeArtifact, upsertDailyBars, readDailyBars, startJob } from './repo.js'

describe('core repositories', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('round-trips settings and artifacts as JSON', () => {
    expect(getSetting('fund', null)).toBeNull()
    setSetting('fund', { inception: '2026-01-01' })
    expect(getSetting('fund', null)).toEqual({ inception: '2026-01-01' })
    writeArtifact('snap', [1, 2])
    expect(readArtifact<number[]>('snap')?.data).toEqual([1, 2])
  })

  it('upserts daily bars idempotently and filters by source and date', () => {
    upsertDailyBars([
      { symbol: 'GC=F', date: '2026-01-02', close: 1, source: 'yahoo' },
      { symbol: 'GC=F', date: '2026-01-03', close: 2, source: 'yahoo' },
    ])
    upsertDailyBars([{ symbol: 'GC=F', date: '2026-01-03', close: 3, source: 'yahoo' }])
    const bars = readDailyBars('GC=F', { source: 'yahoo', from: '2026-01-03' })
    expect(bars).toHaveLength(1)
    expect(bars[0].close).toBe(3)
  })

  it('records job runs', () => {
    const job = startJob('test')
    job.succeed('done', { n: 1 })
    expect(job.id).toBeGreaterThan(0)
  })
})

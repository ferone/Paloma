import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client.js'
import { registerJob } from './registry.js'
import { DEFAULT_SCHEDULE, getScheduleConfig, getScheduleStatus, isDue, nextRunAt, runScheduledJobs, setScheduleConfig, tick } from './scheduler.js'

const cfg = { ...DEFAULT_SCHEDULE, enabled: true, timeUtc: '22:30', jobs: [] as string[] }
const at = (iso: string) => new Date(iso)

describe('scheduler timing', () => {
  it('is due after the configured UTC time on weekdays only, once per day', () => {
    expect(isDue(cfg, at('2026-09-30T22:29:00Z'), null)).toBe(false)
    expect(isDue(cfg, at('2026-09-30T22:30:00Z'), null)).toBe(true)
    expect(isDue(cfg, at('2026-09-30T23:10:00Z'), '2026-09-30')).toBe(false)
    expect(isDue(cfg, at('2026-10-03T23:00:00Z'), null)).toBe(false) // Saturday
    expect(isDue({ ...cfg, skipWeekends: false }, at('2026-10-03T23:00:00Z'), null)).toBe(true)
    expect(isDue({ ...cfg, enabled: false }, at('2026-09-30T23:00:00Z'), null)).toBe(false)
  })
  it('computes the next run, skipping weekends and completed days', () => {
    expect(nextRunAt(cfg, at('2026-09-30T10:00:00Z'), null)?.toISOString()).toBe('2026-09-30T22:30:00.000Z')
    expect(nextRunAt(cfg, at('2026-10-02T23:00:00Z'), '2026-10-02')?.toISOString()).toBe('2026-10-05T22:30:00.000Z')
    expect(nextRunAt({ ...cfg, enabled: false }, at('2026-09-30T10:00:00Z'), null)).toBeNull()
  })
})

describe('scheduler runs', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('validates and persists config', () => {
    expect(getScheduleConfig()).toEqual(DEFAULT_SCHEDULE)
    expect(() => setScheduleConfig({ ...cfg, timeUtc: '25:00' })).toThrow()
    setScheduleConfig({ ...cfg, jobs: ['a.b', 'a.b', 'c'] })
    expect(getScheduleConfig()).toMatchObject({ enabled: true, jobs: ['a.b', 'c'] })
  })

  it('runs registered jobs in order and tolerates unknown ones', async () => {
    const order: string[] = []
    registerJob('t.sched.one', 'test', async () => {
      order.push('one')
    })
    registerJob('t.sched.two', 'test', async () => {
      order.push('two')
      throw new Error('nope')
    })
    const run = await runScheduledJobs({ ...cfg, jobs: ['t.sched.one', 'macro.not-yet', 't.sched.two'] }, { pollMs: 1 })
    expect(order).toEqual(['one', 'two'])
    expect(run.results).toEqual([
      { job: 't.sched.one', outcome: 'succeeded' },
      { job: 'macro.not-yet', outcome: 'skipped (not registered)' },
      { job: 't.sched.two', outcome: 'failed' },
    ])
    expect(run.finishedAt).not.toBeNull()
  })

  it('tick runs once per due day and reports unknown jobs in status', async () => {
    let n = 0
    registerJob('t.sched.count', 'test', async () => {
      n++
    })
    setScheduleConfig({ ...cfg, jobs: ['t.sched.count', 'ml.predict.unknown'] })
    expect(await tick(at('2026-09-30T21:00:00Z'))).toBe(false)
    expect(await tick(at('2026-09-30T22:31:00Z'))).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    expect(await tick(at('2026-09-30T23:00:00Z'))).toBe(false)
    expect(n).toBe(1)
    const s = getScheduleStatus(at('2026-09-30T23:00:00Z'))
    expect(s.lastRun?.date).toBe('2026-09-30')
    expect(s.unknownJobs).toEqual(['ml.predict.unknown'])
    expect(s.nextRunAt).toBe('2026-10-01T22:30:00.000Z')
  })
})

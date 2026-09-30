import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client.js'
import { JobBusyError, jobStatus, registerJob, runJob } from './registry.js'

describe('job registry', () => {
  beforeEach(() => {
    useTestDb()
  })

  it('runs a job in the background, rejects overlap, records completion', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    registerJob('t.slow', 'test', async (ctx) => {
      ctx.progress(0.5, 'half')
      await gate
      return 'finished'
    })
    expect(runJob('t.slow').state).toBe('running')
    expect(() => runJob('t.slow')).toThrow(JobBusyError)
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(jobStatus('t.slow')).toMatchObject({ state: 'succeeded', message: 'finished', progress: 1 })
  })

  it('captures failures', async () => {
    registerJob('t.fail', 'test', async () => {
      throw new Error('boom')
    })
    runJob('t.fail')
    await new Promise((r) => setTimeout(r, 0))
    expect(jobStatus('t.fail')).toMatchObject({ state: 'failed', message: 'boom' })
  })
})

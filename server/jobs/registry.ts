import type { JobStatus } from '../../shared/api.js'
import { startJob } from '../db/repo.js'

// In-process background job runner shared by every domain (marketdata
// refreshes, macro/COT pulls, ML training, AI reports, NAV snapshots).
// One run per job name at a time; each run is recorded in job_runs.

export interface JobContext {
  /** Report progress 0..1 and an optional status line. */
  progress(fraction: number, message?: string): void
  log(message: string): void
}

export type JobFn = (ctx: JobContext, params?: unknown) => Promise<string | void>

interface JobDef {
  name: string
  description: string
  fn: JobFn
}

const defs = new Map<string, JobDef>()
const live = new Map<string, JobStatus>()

export function registerJob(name: string, description: string, fn: JobFn): void {
  defs.set(name, { name, description, fn })
  if (!live.has(name)) live.set(name, { name, state: 'idle', startedAt: null, finishedAt: null, message: null })
}

export function listJobs(): (JobStatus & { description: string })[] {
  return [...defs.values()].map((d) => ({ ...live.get(d.name)!, description: d.description }))
}

export function jobStatus(name: string): JobStatus | undefined {
  return live.get(name)
}

export class JobBusyError extends Error {}
export class UnknownJobError extends Error {}

/**
 * Start a job in the background. Returns immediately with the running status.
 * Throws JobBusyError if the same job is already running.
 */
export function runJob(name: string, params?: unknown): JobStatus {
  const def = defs.get(name)
  if (!def) throw new UnknownJobError(`Unknown job: ${name}`)
  const current = live.get(name)
  if (current?.state === 'running') throw new JobBusyError(`${name} is already running`)

  const status: JobStatus = { name, state: 'running', startedAt: new Date().toISOString(), finishedAt: null, message: null, progress: 0 }
  live.set(name, status)
  const record = startJob(name)
  const logs: string[] = []
  const ctx: JobContext = {
    progress(fraction, message) {
      status.progress = Math.max(0, Math.min(1, fraction))
      if (message) status.message = message
    },
    log(message) {
      logs.push(`${new Date().toISOString()} ${message}`)
      status.message = message
    },
  }

  def
    .fn(ctx, params)
    .then((result) => {
      status.state = 'succeeded'
      status.progress = 1
      status.message = typeof result === 'string' ? result : status.message
      record.succeed(status.message ?? undefined, { logs })
    })
    .catch((err: unknown) => {
      status.state = 'failed'
      status.message = err instanceof Error ? err.message : String(err)
      record.fail(status.message, { logs })
      console.error(`[job:${name}]`, err)
    })
    .finally(() => {
      status.finishedAt = new Date().toISOString()
    })

  return { ...status }
}

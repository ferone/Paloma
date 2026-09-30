import { z } from 'zod'
import type { ScheduleConfig, ScheduleStatus } from '../../shared/marketdata.js'
import { getSetting, setSetting } from '../db/repo.js'
import { JobBusyError, UnknownJobError, jobStatus, listJobs, runJob } from './registry.js'

// Opt-in daily scheduler. After the CME close (default 22:30 UTC) on weekdays
// it runs a configured list of registered jobs, sequentially, by name. Jobs
// are owned by their domains (marketdata.*, macro.*, ml.*, portfolio.nav,
// quant.recompute…); unknown names are skipped and reported, never fatal.
// Config lives in settings key `scheduler`; the last run in `scheduler.lastRun`
// so a restart never double-runs a day.

export const SCHEDULE_KEY = 'scheduler'
const LAST_RUN_KEY = 'scheduler.lastRun'

export const DEFAULT_SCHEDULE: ScheduleConfig = {
  enabled: false,
  timeUtc: '22:30',
  skipWeekends: true,
  jobs: ['marketdata.yahoo', 'marketdata.databento.incremental', 'macro.refresh', 'quant.recompute', 'ml.infer', 'portfolio.nav'],
}

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  timeUtc: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h, UTC)'),
  skipWeekends: z.boolean(),
  jobs: z.array(z.string().min(1).max(100).regex(/^[\w.:-]+$/)).max(50),
})

type LastRun = NonNullable<ScheduleStatus['lastRun']>

export function getScheduleConfig(): ScheduleConfig {
  const parsed = scheduleSchema.safeParse({ ...DEFAULT_SCHEDULE, ...getSetting<Partial<ScheduleConfig>>(SCHEDULE_KEY, {}) })
  return parsed.success ? parsed.data : DEFAULT_SCHEDULE
}

export function setScheduleConfig(input: unknown): ScheduleConfig {
  const cfg = scheduleSchema.parse(input)
  cfg.jobs = [...new Set(cfg.jobs)]
  setSetting(SCHEDULE_KEY, cfg)
  return cfg
}

function isWeekend(d: Date): boolean {
  const w = d.getUTCDay()
  return w === 0 || w === 6
}

/** Next run instant strictly after `now`, or null when disabled. PURE. */
export function nextRunAt(cfg: ScheduleConfig, now: Date, lastRunDate: string | null): Date | null {
  if (!cfg.enabled) return null
  const [hh, mm] = cfg.timeUtc.split(':').map(Number)
  for (let k = 0; k < 8; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + k, hh, mm))
    const day = d.toISOString().slice(0, 10)
    if (cfg.skipWeekends && isWeekend(d)) continue
    if (day === lastRunDate) continue
    if (d.getTime() <= now.getTime() && k > 0) continue
    // Today's slot already passed but hasn't run yet → it's due now.
    return d.getTime() <= now.getTime() ? now : d
  }
  return null
}

/** Is a run due at `now`? Today's slot has passed, today is eligible and hasn't run. PURE. */
export function isDue(cfg: ScheduleConfig, now: Date, lastRunDate: string | null): boolean {
  if (!cfg.enabled) return false
  if (cfg.skipWeekends && isWeekend(now)) return false
  const today = now.toISOString().slice(0, 10)
  if (lastRunDate === today) return false
  const [hh, mm] = cfg.timeUtc.split(':').map(Number)
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= hh * 60 + mm
}

let running = false
let timer: ReturnType<typeof setInterval> | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForJob(name: string, pollMs: number, timeoutMs: number): Promise<string> {
  const t0 = Date.now()
  for (;;) {
    const s = jobStatus(name)
    if (!s || s.state !== 'running') return s?.state ?? 'unknown'
    if (Date.now() - t0 > timeoutMs) return 'timeout (still running)'
    await sleep(pollMs)
  }
}

/** Run the configured job list now (sequentially). Returns per-job outcomes. */
export async function runScheduledJobs(
  cfg: ScheduleConfig = getScheduleConfig(),
  opts: { pollMs?: number; timeoutMs?: number; now?: Date } = {},
): Promise<LastRun> {
  if (running) throw new JobBusyError('Scheduled run already in progress')
  running = true
  const now = opts.now ?? new Date()
  const run: LastRun = { date: now.toISOString().slice(0, 10), startedAt: now.toISOString(), finishedAt: null, results: [] }
  setSetting(LAST_RUN_KEY, run)
  try {
    for (const name of cfg.jobs) {
      let outcome: string
      try {
        runJob(name)
        outcome = await waitForJob(name, opts.pollMs ?? 2000, opts.timeoutMs ?? 6 * 3600_000)
      } catch (err) {
        if (err instanceof UnknownJobError) outcome = 'skipped (not registered)'
        else if (err instanceof JobBusyError) outcome = 'skipped (already running)'
        else outcome = `error: ${err instanceof Error ? err.message : String(err)}`
      }
      run.results.push({ job: name, outcome })
      setSetting(LAST_RUN_KEY, run)
    }
  } finally {
    run.finishedAt = new Date().toISOString()
    setSetting(LAST_RUN_KEY, run)
    running = false
  }
  return run
}

export function getScheduleStatus(now = new Date()): ScheduleStatus {
  const cfg = getScheduleConfig()
  const lastRun = getSetting<LastRun | null>(LAST_RUN_KEY, null)
  const registered = new Set(listJobs().map((j) => j.name))
  const next = nextRunAt(cfg, now, lastRun?.date ?? null)
  return {
    ...cfg,
    nextRunAt: next ? next.toISOString() : null,
    lastRun,
    running,
    unknownJobs: cfg.jobs.filter((j) => !registered.has(j)),
  }
}

/** Check once; start a run when due. Exposed for tests. */
export async function tick(now = new Date()): Promise<boolean> {
  if (running) return false
  const cfg = getScheduleConfig()
  const last = getSetting<LastRun | null>(LAST_RUN_KEY, null)
  if (!isDue(cfg, now, last?.date ?? null)) return false
  await runScheduledJobs(cfg, { now })
  return true
}

/**
 * Start the in-process scheduler (checks every minute). Call once from
 * server/index.ts after the DB is open. Idempotent.
 */
export function startScheduler(intervalMs = 60_000): void {
  if (timer) return
  timer = setInterval(() => {
    tick().catch((err) => console.error('[scheduler]', err))
  }, intervalMs)
  timer.unref?.()
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

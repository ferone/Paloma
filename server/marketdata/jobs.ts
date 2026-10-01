import { z } from 'zod'
import { DATABENTO_HISTORY_START, DATABENTO_ROOTS, DATABENTO_SCHEMAS, type BackfillRequest } from '../../shared/marketdata.js'
import { env } from '../lib/env.js'
import { registerJob, type JobContext } from '../jobs/registry.js'
import { DatabentoClient } from './databento/client.js'
import { OverBudgetError, todayUtc } from './databento/cost.js'
import { incrementalRequests, ingestDatabento } from './databento/ingest.js'
import { databentoSpend } from './repo.js'
import { ingestYahoo } from './yahoo.js'

// Marketdata background jobs (registered on import; router.ts imports this).

export const JOB_YAHOO = 'marketdata.yahoo'
export const JOB_DATABENTO_INCREMENTAL = 'marketdata.databento.incremental'
export const JOB_DATABENTO_BACKFILL = 'marketdata.databento.backfill'

/** Default cap for the unattended daily incremental pull (USD). */
export const INCREMENTAL_CAP = 1

export const backfillSchema = z.object({
  roots: z.array(z.enum(DATABENTO_ROOTS)).min(1).default([...DATABENTO_ROOTS]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(DATABENTO_HISTORY_START),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  schemas: z.array(z.enum(DATABENTO_SCHEMAS)).min(1).default([...DATABENTO_SCHEMAS]),
  maxCost: z.number().nonnegative().optional(),
  windowMonths: z.number().int().min(1).max(24).optional(),
})

export function databentoClient(): DatabentoClient | null {
  return env.databentoKey ? new DatabentoClient({ apiKey: env.databentoKey }) : null
}

function requireClient(): DatabentoClient {
  const c = databentoClient()
  if (!c) throw new Error('Databento is not configured: add the key in Settings → API keys')
  return c
}

export async function runBackfill(ctx: JobContext, params: unknown): Promise<string> {
  const req: BackfillRequest = backfillSchema.parse(params ?? {})
  const r = await ingestDatabento(req, { client: requireClient(), budget: env.databentoBudget }, ctx)
  return `Backfill ${req.roots.join(',')} ${r.estimate.start}→${r.estimate.end}: ${r.bars} bars, ${r.openInterest} OI updates, ${r.contracts} contracts, ${r.frontMonthRows} front-month rows; spent ≈ $${r.spent.toFixed(4)}`
}

export interface IncrementalDeps {
  client: DatabentoClient | null
  budget: number
  today?: string
}

/**
 * The unattended daily Databento pull: every root in DATABENTO_ROOTS, BOTH
 * schemas (ohlcv-1d bars and statistics = open interest), from the latest
 * stored date. One running cap, min(DATABENTO_BUDGET, INCREMENTAL_CAP) unless
 * `maxCost` is given, is shared by all roots; a root whose free estimate does
 * not fit what is left is skipped (and retried tomorrow), never pulled.
 */
export async function runIncremental(
  ctx: JobContext,
  params: unknown,
  deps: IncrementalDeps = { client: databentoClient(), budget: env.databentoBudget },
): Promise<string> {
  const p = z.object({ maxCost: z.number().nonnegative().optional() }).parse(params ?? {})
  // Part of the default daily schedule: without a key this is a no-op, not a daily failure.
  const { client, budget } = deps
  if (!client) return 'Skipped: Databento is not configured (add the key in Settings → API keys)'
  let remaining = p.maxCost ?? Math.min(budget, INCREMENTAL_CAP)
  const plan = incrementalRequests(DATABENTO_ROOTS, deps.today ?? todayUtc())
  const parts: string[] = []
  let i = 0
  for (const { root, start } of plan) {
    const sub: JobContext = {
      progress: (f, m) => ctx.progress((i + f) / plan.length, m),
      log: (m) => ctx.log(m),
    }
    // Spend is measured from the recorded pulls, so a root that stops half-way still counts against the cap.
    const before = databentoSpend().totalUsd
    try {
      const r = await ingestDatabento({ roots: [root], start, schemas: [...DATABENTO_SCHEMAS], maxCost: remaining }, { client, budget }, sub)
      parts.push(`${root} from ${r.estimate.start}: ${r.bars} bars, ${r.openInterest} OI ($${r.spent.toFixed(4)})`)
    } catch (err) {
      // An empty range (already current) is not a failure.
      if (err instanceof Error && /Empty range/.test(err.message)) parts.push(`${root}: up to date`)
      else if (err instanceof OverBudgetError) parts.push(`${root}: skipped, $${err.estimate.total.toFixed(4)} is over the $${remaining.toFixed(4)} left`)
      else throw err
    } finally {
      remaining = Math.max(0, remaining - (databentoSpend().totalUsd - before))
    }
    i++
  }
  return `Incremental: ${parts.join('; ')}`
}

let registered = false
export function registerMarketdataJobs(): void {
  if (registered) return
  registered = true
  registerJob(JOB_YAHOO, 'Yahoo daily history: futures fronts, spot, ETFs, miners, DXY/10Y/VIX/SPY/TIP/13W; listed futures months', (ctx) => ingestYahoo(ctx))
  registerJob(
    JOB_DATABENTO_INCREMENTAL,
    `Databento ${DATABENTO_ROOTS.join('/')} bars and open interest since last stored date (cost-guarded, ≤ $${INCREMENTAL_CAP})`,
    (ctx, params) => runIncremental(ctx, params),
  )
  registerJob(JOB_DATABENTO_BACKFILL, 'Databento backfill (params: roots, start, end, schemas, maxCost)', runBackfill)
}

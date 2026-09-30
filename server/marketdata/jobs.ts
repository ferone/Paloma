import { z } from 'zod'
import { DATABENTO_HISTORY_START, DATABENTO_ROOTS, DATABENTO_SCHEMAS, type BackfillRequest } from '../../shared/marketdata.js'
import { env } from '../lib/env.js'
import { registerJob, type JobContext } from '../jobs/registry.js'
import { DatabentoClient } from './databento/client.js'
import { todayUtc } from './databento/cost.js'
import { incrementalRequests, ingestDatabento } from './databento/ingest.js'
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
  if (!c) throw new Error('Databento is not configured: set DATABENTO_API_KEY in .env')
  return c
}

export async function runBackfill(ctx: JobContext, params: unknown): Promise<string> {
  const req: BackfillRequest = backfillSchema.parse(params ?? {})
  const r = await ingestDatabento(req, { client: requireClient(), budget: env.databentoBudget }, ctx)
  return `Backfill ${req.roots.join(',')} ${r.estimate.start}→${r.estimate.end}: ${r.bars} bars, ${r.openInterest} OI updates, ${r.contracts} contracts, ${r.frontMonthRows} front-month rows; spent ≈ $${r.spent.toFixed(4)}`
}

export async function runIncremental(ctx: JobContext, params: unknown): Promise<string> {
  const p = z.object({ maxCost: z.number().nonnegative().optional() }).parse(params ?? {})
  const client = requireClient()
  let remaining = p.maxCost ?? Math.min(env.databentoBudget, INCREMENTAL_CAP)
  const plan = incrementalRequests(DATABENTO_ROOTS, todayUtc())
  const parts: string[] = []
  let i = 0
  for (const { root, start } of plan) {
    const sub: JobContext = {
      progress: (f, m) => ctx.progress((i + f) / plan.length, m),
      log: (m) => ctx.log(m),
    }
    try {
      const r = await ingestDatabento({ roots: [root], start, schemas: [...DATABENTO_SCHEMAS], maxCost: remaining }, { client, budget: env.databentoBudget }, sub)
      remaining = Math.max(0, remaining - r.spent)
      parts.push(`${root} from ${r.estimate.start}: ${r.bars} bars ($${r.spent.toFixed(4)})`)
    } catch (err) {
      // An empty range (already current) is not a failure.
      if (err instanceof Error && /Empty range/.test(err.message)) parts.push(`${root}: up to date`)
      else throw err
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
  registerJob(JOB_DATABENTO_INCREMENTAL, `Databento ${DATABENTO_ROOTS.join('/')} since last stored date (cost-guarded, ≤ $${INCREMENTAL_CAP})`, runIncremental)
  registerJob(JOB_DATABENTO_BACKFILL, 'Databento backfill (params: roots, start, end, schemas, maxCost)', runBackfill)
}

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { NotConfigured } from '../../shared/api.js'
import { ARTIFACTS } from '../../shared/artifacts.js'
import {
  DATABENTO_ROOTS,
  DATABENTO_SCHEMAS,
  DATABENTO_HISTORY_START,
  type OverBudgetBody,
  type SeriesResponse,
} from '../../shared/marketdata.js'
import { readArtifact } from '../db/repo.js'
import { env } from '../lib/env.js'
import { JobBusyError, jobStatus, runJob } from '../jobs/registry.js'
import { getScheduleStatus, runScheduledJobs, scheduleSchema, setScheduleConfig } from '../jobs/scheduler.js'
import { assertWithinBudget, estimate, OverBudgetError } from './databento/cost.js'
import { ExportNotFoundError, buildExportQuery, exportFilename, streamExport } from './export.js'
import { freshness } from './freshness.js'
import { openInterestCoverage } from './open-interest.js'
import { JOB_DATABENTO_BACKFILL, backfillSchema, databentoClient, registerMarketdataJobs } from './jobs.js'
import { contractBarsRange, contractSummaries, dailySeries, databentoSpend, priceSymbols, recentJobRuns } from './repo.js'

// /api/marketdata — market data ingest, freshness, exports and scheduling.
registerMarketdataJobs()

export const router = Router()

const NOT_CONFIGURED: NotConfigured = {
  status: 'not_configured',
  missing: ['DATABENTO_API_KEY'],
  message: `Databento provides historical CME contract data for ${DATABENTO_ROOTS.join(', ')} (spreads, curves, open interest).`,
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function badRequest(res: Response, err: unknown): void {
  const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') : err instanceof Error ? err.message : String(err)
  res.status(400).json({ error: 'bad_request', message })
}

router.get('/health', (_req, res) => {
  res.json({ domain: 'marketdata', status: 'ok' })
})

// ── Freshness ────────────────────────────────────────────────────────────────
router.get('/freshness', (_req, res) => {
  res.json(freshness())
})

// ── Databento ───────────────────────────────────────────────────────────────
router.get('/databento/status', (_req, res) => {
  res.json({
    configured: !!env.databentoKey,
    budget: env.databentoBudget,
    roots: DATABENTO_ROOTS,
    schemas: DATABENTO_SCHEMAS,
    historyStart: DATABENTO_HISTORY_START,
    spend: databentoSpend(),
    backfill: jobStatus(JOB_DATABENTO_BACKFILL) ?? null,
    openInterest: openInterestCoverage(),
  })
})

const estimateSchema = z.object({
  roots: z.array(z.enum(DATABENTO_ROOTS)).min(1),
  start: date,
  end: date.optional(),
  schemas: z.array(z.enum(DATABENTO_SCHEMAS)).min(1),
})

router.post('/databento/estimate', async (req, res) => {
  const client = databentoClient()
  if (!client) return void res.json(NOT_CONFIGURED)
  let body
  try {
    body = estimateSchema.parse(req.body ?? {})
  } catch (err) {
    return badRequest(res, err)
  }
  try {
    res.json(await estimate(client, body, env.databentoBudget))
  } catch (err) {
    res.status(502).json({ error: 'databento_error', message: err instanceof Error ? err.message : String(err) })
  }
})

router.post('/databento/backfill', async (req, res) => {
  const client = databentoClient()
  if (!client) return void res.json(NOT_CONFIGURED)
  let body
  try {
    body = backfillSchema.parse(req.body ?? {})
  } catch (err) {
    return badRequest(res, err)
  }
  if (jobStatus(JOB_DATABENTO_BACKFILL)?.state === 'running') {
    return void res.status(409).json({ error: 'busy', message: 'A Databento backfill is already running', job: jobStatus(JOB_DATABENTO_BACKFILL) })
  }
  // Pre-flight the free estimate so an over-budget request is refused before a job starts.
  try {
    const est = await estimate(client, body, env.databentoBudget)
    try {
      assertWithinBudget(est, body.maxCost)
    } catch (err) {
      if (err instanceof OverBudgetError) {
        const payload: OverBudgetBody = { error: 'over_budget', message: err.message, limit: err.limit, estimate: est }
        return void res.status(402).json(payload)
      }
      throw err
    }
  } catch (err) {
    return void res.status(502).json({ error: 'databento_error', message: err instanceof Error ? err.message : String(err) })
  }
  try {
    res.status(202).json(runJob(JOB_DATABENTO_BACKFILL, body))
  } catch (err) {
    if (err instanceof JobBusyError) res.status(409).json({ error: 'busy', message: err.message })
    else throw err
  }
})

// ── Contracts & series ──────────────────────────────────────────────────────
router.get('/contracts', (req, res) => {
  const root = str(req.query.root)
  if (!root || !(DATABENTO_ROOTS as readonly string[]).includes(root)) {
    return void res.status(400).json({ error: 'bad_request', message: `root must be one of ${DATABENTO_ROOTS.join(', ')}` })
  }
  res.json(contractSummaries(root))
})

function rangeParams(req: Request): { from?: string; to?: string } | string {
  const from = str(req.query.from)
  const to = str(req.query.to)
  for (const v of [from, to]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'from/to must be YYYY-MM-DD'
  return { from, to }
}

router.get('/bars', (req, res) => {
  const symbol = str(req.query.symbol)
  const range = rangeParams(req)
  if (!symbol) return void res.status(400).json({ error: 'bad_request', message: 'symbol is required' })
  if (typeof range === 'string') return void res.status(400).json({ error: 'bad_request', message: range })
  const bars = contractBarsRange(symbol, range.from, range.to)
  const sources = [...new Set(bars.map((b) => b.source))]
  const out: SeriesResponse = {
    symbol,
    source: sources.length === 1 ? sources[0] : null,
    bars,
    provenance: { source: sources.length ? sources.map(sourceLabel).join(' + ') : 'No data', asOf: bars.at(-1)?.date ?? null },
  }
  res.json(out)
})

router.get('/series', (req, res) => {
  const symbol = str(req.query.symbol)
  const source = str(req.query.source)
  const range = rangeParams(req)
  if (!symbol) return void res.status(400).json({ error: 'bad_request', message: 'symbol is required' })
  if (typeof range === 'string') return void res.status(400).json({ error: 'bad_request', message: range })
  const bars = dailySeries(symbol, source, range.from, range.to)
  const out: SeriesResponse = {
    symbol,
    source: source ?? null,
    bars,
    provenance: {
      source: source ? sourceLabel(source) : 'All sources',
      asOf: bars.at(-1)?.date ?? null,
      note: source ? undefined : 'Multiple sources may appear per date; pass source= to select one.',
    },
  }
  res.json(out)
})

router.get('/symbols', (_req, res) => {
  res.json(priceSymbols())
})

function sourceLabel(s: string): string {
  return s === 'databento' ? 'Databento GLBX.MDP3' : s === 'yahoo' ? 'Yahoo Finance' : s
}

// ── Export ──────────────────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  const dataset = str(req.query.dataset) ?? ''
  const format = str(req.query.format) ?? 'csv'
  if (format !== 'csv' && format !== 'json') return void res.status(400).json({ error: 'bad_request', message: 'format must be csv or json' })
  const range = rangeParams(req)
  if (typeof range === 'string') return void res.status(400).json({ error: 'bad_request', message: range })
  const filters = { symbol: str(req.query.symbol), source: str(req.query.source), ...range }
  let query
  try {
    query = buildExportQuery(dataset, filters)
  } catch (err) {
    if (err instanceof ExportNotFoundError) return void res.status(404).json({ error: 'not_found', message: err.message })
    throw err
  }
  await streamExport(res, query, format, exportFilename(dataset, filters, format))
})

const ARTIFACT_NAME = /^[A-Za-z0-9:._-]{1,100}$/

router.get('/export/artifact/:name', (req, res) => {
  const name = req.params.name
  if (!ARTIFACT_NAME.test(name)) return void res.status(400).json({ error: 'bad_request', message: 'Invalid artifact name' })
  const art = readArtifact<unknown>(name)
  if (!art) return void res.status(404).json({ error: 'not_found', message: `Artifact '${name}' has not been published yet` })
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9._-]+/g, '-')}.json"`)
  res.json({ name, generatedAt: art.generatedAt, data: art.data })
})

/** One JSON file with every published analysis artifact plus data freshness. */
router.get('/export/research-pack', (_req, res) => {
  const artifacts: Record<string, { generatedAt: string; data: unknown } | null> = {}
  for (const name of Object.values(ARTIFACTS)) artifacts[name] = readArtifact<unknown>(name)
  const generatedAt = new Date().toISOString()
  res.setHeader('Content-Disposition', `attachment; filename="research-pack_${generatedAt.slice(0, 10)}.json"`)
  res.json({ generatedAt, artifacts, freshness: freshness() })
})

router.get('/artifacts', (_req, res) => {
  res.json(
    Object.values(ARTIFACTS).map((name) => {
      const a = readArtifact<unknown>(name)
      return { name, generatedAt: a?.generatedAt ?? null, available: !!a }
    }),
  )
})

// ── Jobs & schedule ─────────────────────────────────────────────────────────
router.get('/jobs/runs', (req, res) => {
  const limit = Number(str(req.query.limit) ?? 50)
  res.json(recentJobRuns(Number.isFinite(limit) ? limit : 50, str(req.query.name)))
})

router.get('/schedule', (_req, res) => {
  res.json(getScheduleStatus())
})

router.put('/schedule', (req, res) => {
  try {
    setScheduleConfig(scheduleSchema.parse(req.body ?? {}))
  } catch (err) {
    return badRequest(res, err)
  }
  res.json(getScheduleStatus())
})

/** Run the configured list now (ignores time/weekend; still sequential). */
router.post('/schedule/run', (_req, res) => {
  if (getScheduleStatus().running) return void res.status(409).json({ error: 'busy', message: 'A scheduled run is already in progress' })
  runScheduledJobs().catch((err) => console.error('[scheduler]', err))
  res.status(202).json(getScheduleStatus())
})

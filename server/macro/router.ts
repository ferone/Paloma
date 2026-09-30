import { Router } from 'express'
import { parseAssetId } from '../../shared/universe.js'
import { JobBusyError, jobStatus, runJob } from '../jobs/registry.js'
import { registerMacroJobs } from './jobs.js'
import { buildDashboard, correlationResponse, cotMarkets, cotResponse, seriesResponse } from './service.js'

// /api/macro — dashboard, series, COT positioning, correlations, refresh.
registerMacroJobs()

export const router = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/

router.get('/health', (_req, res) => {
  res.json({ domain: 'macro', status: 'ok' })
})

router.get('/dashboard', (req, res) => {
  res.json(buildDashboard(parseAssetId(req.query.asset ?? req.query.metal)))
})

router.get('/series', (req, res) => {
  const ids = String(req.query.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
  if (ids.length === 0) {
    res.status(400).json({ error: 'ids is required (comma-separated series ids)' })
    return
  }
  const from = typeof req.query.from === 'string' && ISO.test(req.query.from) ? req.query.from : undefined
  res.json(seriesResponse(ids, from))
})

router.get('/cot', (req, res) => {
  const known = cotMarkets().map((c) => c.market)
  const r = cotResponse(String(req.query.market ?? known[0] ?? ''))
  if (!r) {
    res.status(400).json({ error: `market must be one of ${known.join(', ')}` })
    return
  }
  res.json(r)
})

router.get('/correlations', (req, res) => {
  const w = Number(req.query.window ?? 63)
  const window = w === 252 ? 252 : w === 126 ? 126 : 63
  res.json(correlationResponse(parseAssetId(req.query.asset ?? req.query.metal), window))
})

router.get('/refresh', (_req, res) => {
  res.json({ fred: jobStatus('macro.fred') ?? null, cot: jobStatus('macro.cot') ?? null, all: jobStatus('macro.refresh') ?? null })
})

router.post('/refresh', (req, res) => {
  const what = (req.body as { what?: string } | undefined)?.what
  const which = what === 'fred' ? 'macro.fred' : what === 'cot' ? 'macro.cot' : 'macro.refresh'
  try {
    res.status(202).json({ job: runJob(which) })
  } catch (err) {
    if (err instanceof JobBusyError) res.status(409).json({ error: err.message, job: jobStatus(which) })
    else throw err
  }
})

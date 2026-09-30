import { Router } from 'express'
import type { MlPredictionsResponse, MlStatus } from '../../shared/ml.js'
import { METALS, type Metal } from '../../shared/universe.js'
import { JobBusyError, jobStatus, registerJob, runJob } from '../jobs/registry.js'
import { pythonStatus } from './python.js'
import { getRun, latestPredictions, listRuns, markInterruptedRuns } from './repo.js'
import { MAX_MODEL_AGE_DAYS, inferAll, trainAll } from './service.js'

// Domain router for /api/ml, plus the ml.train / ml.infer background jobs.
export const router = Router()

const isMetal = (x: unknown): x is Metal => x === 'gold' || x === 'silver'

function assertNotTraining(other: string) {
  if (jobStatus(other)?.state === 'running') throw new JobBusyError(`${other} is running; try again when it finishes`)
}

// No job survives a restart, so any 'running' row is an orphan.
markInterruptedRuns()

registerJob('ml.train', 'Train the gold/silver 20-day models with walk-forward validation', async (ctx, params) => {
  assertNotTraining('ml.infer')
  const metal = (params as { metal?: unknown } | undefined)?.metal
  return trainAll(ctx, isMetal(metal) ? [metal] : [...METALS])
})

registerJob('ml.infer', 'Score the latest day with the saved models (retrains if missing or older than 7 days)', async (ctx) => {
  assertNotTraining('ml.train')
  return inferAll(ctx)
})

router.get('/health', (_req, res) => {
  res.json({ domain: 'ml', status: 'ok' })
})

router.get('/status', (_req, res) => {
  const lastRuns: MlStatus['lastRuns'] = {}
  for (const m of METALS) {
    const [r] = listRuns(m, 1)
    if (r) lastRuns[m] = r
  }
  const body: MlStatus = { python: pythonStatus(), lastRuns, maxModelAgeDays: MAX_MODEL_AGE_DAYS }
  res.json(body)
})

router.get('/predictions', (req, res) => {
  const metal = req.query.metal
  if (metal !== undefined && !isMetal(metal)) {
    res.status(400).json({ error: 'metal must be gold or silver' })
    return
  }
  const body: MlPredictionsResponse = { predictions: latestPredictions(metal) }
  res.json(body)
})

router.get('/runs', (req, res) => {
  const metal = req.query.metal
  if (metal !== undefined && !isMetal(metal)) {
    res.status(400).json({ error: 'metal must be gold or silver' })
    return
  }
  res.json(listRuns(metal))
})

router.get('/runs/:id', (req, res) => {
  const run = getRun(Number(req.params.id))
  if (!run) {
    res.status(404).json({ error: 'run not found' })
    return
  }
  res.json(run)
})

function start(name: string, other: string, params: unknown, res: import('express').Response) {
  try {
    assertNotTraining(other)
    res.status(202).json(runJob(name, params))
  } catch (err) {
    if (err instanceof JobBusyError) res.status(409).json({ error: err.message })
    else throw err
  }
}

router.post('/train', (req, res) => {
  const metal = (req.body as { metal?: unknown } | undefined)?.metal
  if (metal !== undefined && metal !== null && !isMetal(metal)) {
    res.status(400).json({ error: 'metal must be gold or silver' })
    return
  }
  start('ml.train', 'ml.infer', { metal: metal ?? undefined }, res)
})

router.post('/infer', (_req, res) => {
  start('ml.infer', 'ml.train', undefined, res)
})

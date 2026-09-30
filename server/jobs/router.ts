import { Router } from 'express'
import { JobBusyError, UnknownJobError, listJobs, runJob } from './registry.js'

// Generic job control: GET /api/jobs, POST /api/jobs/:name/run (body = params).
export const router = Router()

router.get('/', (_req, res) => {
  res.json(listJobs())
})

router.post('/:name/run', (req, res) => {
  try {
    res.status(202).json(runJob(req.params.name, req.body))
  } catch (err) {
    if (err instanceof UnknownJobError) res.status(404).json({ error: err.message })
    else if (err instanceof JobBusyError) res.status(409).json({ error: err.message })
    else throw err
  }
})

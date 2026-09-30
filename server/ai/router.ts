import { Router } from 'express'
import type { AiSettings, ReportKind } from '../../shared/ai.js'
import { REPORT_KINDS } from '../../shared/ai.js'
import { METALS, type Metal } from '../../shared/universe.js'
import { env } from '../lib/env.js'
import { deleteReport, failOrphans, getReport, listReports } from './repo.js'
import { aiStatus, getAiSettings, listModels, putAiSettings } from './settings.js'
import { BadRequest, NOT_CONFIGURED, parseRequest, startReport } from './service.js'

// /api/ai — AI analyst: status, settings, model catalogue, reports.
export const router = Router()

let orphansCleared = false
function clearOrphansOnce() {
  if (orphansCleared) return
  orphansCleared = true
  failOrphans()
}

router.get('/health', (_req, res) => {
  res.json({ domain: 'ai', status: 'ok' })
})

router.get('/status', (_req, res) => {
  res.json(aiStatus())
})

router.get('/settings', (_req, res) => {
  res.json(getAiSettings())
})

router.put('/settings', (req, res) => {
  const out = putAiSettings((req.body ?? {}) as Partial<AiSettings>)
  if ('error' in out) res.status(400).json(out)
  else res.json(out)
})

router.get('/models', async (req, res) => {
  res.json(await listModels({ force: req.query.refresh === '1' }))
})

router.get('/reports', (req, res) => {
  clearOrphansOnce()
  const kind = REPORT_KINDS.includes(req.query.kind as ReportKind) ? (req.query.kind as ReportKind) : undefined
  const metal = METALS.includes(req.query.metal as Metal) ? (req.query.metal as Metal) : undefined
  res.json(listReports({ kind, metal, limit: Math.min(200, Number(req.query.limit) || 100) }))
})

router.get('/reports/:id', (req, res) => {
  clearOrphansOnce()
  const r = getReport(Number(req.params.id))
  if (!r) res.status(404).json({ error: 'Report not found' })
  else res.json(r)
})

router.delete('/reports/:id', (req, res) => {
  if (deleteReport(Number(req.params.id))) res.status(204).end()
  else res.status(404).json({ error: 'Report not found' })
})

// Starts a generation and returns 202 with the running report; poll GET /reports/:id.
router.post('/reports', (req, res) => {
  clearOrphansOnce()
  if (!env.openrouterKey) {
    res.json(NOT_CONFIGURED)
    return
  }
  try {
    const { id } = startReport(parseRequest(req.body))
    res.status(202).json(getReport(id))
  } catch (err) {
    if (err instanceof BadRequest) res.status(400).json({ error: err.message })
    else throw err
  }
})

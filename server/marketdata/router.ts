import { Router } from 'express'

// Domain router for /api/marketdata. Owned by the marketdata workstream; see CLAUDE.md.
export const router = Router()

router.get('/health', (_req, res) => {
  res.json({ domain: 'marketdata', status: 'ok' })
})

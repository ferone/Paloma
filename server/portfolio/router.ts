import { Router } from 'express'

// Domain router for /api/portfolio. Owned by the portfolio workstream; see CLAUDE.md.
export const router = Router()

router.get('/health', (_req, res) => {
  res.json({ domain: 'portfolio', status: 'ok' })
})

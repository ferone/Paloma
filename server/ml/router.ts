import { Router } from 'express'

// Domain router for /api/ml. Owned by the ml workstream; see CLAUDE.md.
export const router = Router()

router.get('/health', (_req, res) => {
  res.json({ domain: 'ml', status: 'ok' })
})

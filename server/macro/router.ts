import { Router } from 'express'

// Domain router for /api/macro. Owned by the macro workstream; see CLAUDE.md.
export const router = Router()

router.get('/health', (_req, res) => {
  res.json({ domain: 'macro', status: 'ok' })
})

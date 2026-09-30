import { Router } from 'express'

// Domain router for /api/ai. Owned by the ai workstream; see CLAUDE.md.
export const router = Router()

router.get('/health', (_req, res) => {
  res.json({ domain: 'ai', status: 'ok' })
})

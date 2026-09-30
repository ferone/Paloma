import { Router } from 'express'

// Domain router for /api/quant. Owned by the quant workstream; see CLAUDE.md.
export const router = Router()

router.get('/health', (_req, res) => {
  res.json({ domain: 'quant', status: 'ok' })
})

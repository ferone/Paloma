import { Router, type Request, type Response } from 'express'
import { ASSETS, isAssetId, type AssetId } from '../../shared/universe.js'
import { TIME_RANGES } from '../../shared/markets.js'
import { memo } from './memo.js'
import { buildCurve } from './curve.js'
import { buildEtfs } from './etfs.js'
import { liquidityHistory, liquiditySnapshot } from './liquidity.js'
import { readCurveHistory, saveCurveSnapshot } from './repo.js'

// Domain router for /api/markets (owned by the markets workstream).
export const router = Router()

/** `?asset=` (or the legacy `?metal=`), defaulting to the first asset. */
function metalParam(req: Request, res: Response): AssetId | null {
  const m = String(req.query.asset ?? req.query.metal ?? ASSETS[0])
  if (isAssetId(m)) return m
  res.status(400).json({ error: `asset must be one of ${ASSETS.join(', ')}` })
  return null
}

function fail(res: Response, what: string, err: unknown) {
  console.error(`[markets] ${what}:`, err)
  res.status(502).json({ error: `Failed to load ${what} from Yahoo Finance` })
}

router.get('/health', (_req, res) => {
  res.json({ domain: 'markets', status: 'ok' })
})

/** Live futures curve + carry vs ^IRX. Cached 60 s; each fetch also records today's snapshot. */
router.get('/curve', async (req, res) => {
  const metal = metalParam(req, res)
  if (!metal) return
  try {
    const curve = await memo(`markets:curve:${metal}`, 60_000, async () => {
      const c = await buildCurve(metal)
      try {
        if (c.contracts.length > 0) saveCurveSnapshot(c)
      } catch (err) {
        console.error('[markets] curve snapshot not saved:', err)
      }
      return c
    })
    res.json(curve)
  } catch (err) {
    fail(res, 'futures curve', err)
  }
})

/** Locally recorded daily curve snapshots (builds up as the curve page is used). */
router.get('/curve/history', (req, res) => {
  const metal = metalParam(req, res)
  if (!metal) return
  const points = readCurveHistory(metal)
  res.json({
    metal,
    points,
    provenance: {
      source: 'Local snapshots of the Yahoo curve (one per day the curve was viewed)',
      asOf: points.length ? points[points.length - 1].date : null,
    },
  })
})

router.get('/etfs', async (req, res) => {
  const metal = metalParam(req, res)
  if (!metal) return
  try {
    res.json(await memo(`markets:etfs:${metal}`, 60_000, () => buildEtfs(metal)))
  } catch (err) {
    fail(res, 'ETF data', err)
  }
})

router.get('/liquidity', async (req, res) => {
  const metal = metalParam(req, res)
  if (!metal) return
  try {
    res.json(await memo(`markets:liq:${metal}`, 60_000, () => liquiditySnapshot(metal)))
  } catch (err) {
    fail(res, 'liquidity', err)
  }
})

router.get('/liquidity/history', async (req, res) => {
  const metal = metalParam(req, res)
  if (!metal) return
  const range = String(req.query.range ?? '1Y')
  if (!(TIME_RANGES as readonly string[]).includes(range) || range === '1D' || range === '1W') {
    res.status(400).json({ error: 'range must be one of 1M, 3M, 6M, 1Y, 5Y, ALL' })
    return
  }
  try {
    res.json(await memo(`markets:liqhist:${metal}:${range}`, 30 * 60_000, () => liquidityHistory(metal, range)))
  } catch (err) {
    fail(res, 'liquidity history', err)
  }
})

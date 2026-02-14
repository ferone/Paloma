import NodeCache from 'node-cache'
import type { Request, Response, NextFunction } from 'express'

const cache = new NodeCache()

const TTL = {
  quote: 30,
  intraday: 60,
  daily: 1800,
  gold: 60,
} as const

export function cacheMiddleware(ttlKey: keyof typeof TTL) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.originalUrl
    const cached = cache.get(key)
    if (cached) {
      res.json(cached)
      return
    }

    const originalJson = res.json.bind(res)
    res.json = (body: unknown) => {
      cache.set(key, body, TTL[ttlKey])
      return originalJson(body)
    }
    next()
  }
}

export { cache }

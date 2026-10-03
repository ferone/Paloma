import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { cache, cacheMiddleware } from './cache.js'

async function serve(handler: express.RequestHandler) {
  const app = express()
  app.get('/x', cacheMiddleware('daily'), handler)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, close: () => server.close() }
}

describe('cacheMiddleware', () => {
  beforeEach(() => cache.flushAll())

  it('does not cache error responses', async () => {
    let calls = 0
    const s = await serve((_req, res) => {
      calls++
      if (calls === 1) res.status(500).json({ error: 'upstream down' })
      else res.json([1, 2, 3])
    })
    const first = await fetch(s.url)
    expect(first.status).toBe(500)
    const second = await fetch(s.url)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual([1, 2, 3])
    s.close()
  })

  it('serves successes from the cache', async () => {
    let calls = 0
    const s = await serve((_req, res) => {
      calls++
      res.json({ n: calls })
    })
    await fetch(s.url)
    expect(await (await fetch(s.url)).json()).toEqual({ n: 1 })
    expect(calls).toBe(1)
    s.close()
  })
})

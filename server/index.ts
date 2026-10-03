import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { env } from './lib/env.js'
import { getDb } from './db/client.js'
import { mountRoutes } from './routes/index.js'
import { startScheduler } from './jobs/scheduler.js'
import { rateLimiter } from './middleware/rate-limiter.js'

const app = express()

// Local-only app: the browser talks to the API through the Vite proxy (same
// origin), so CORS only needs to admit localhost pages (e.g. a preview build).
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
app.use(cors({ origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)) }))
app.use(express.json({ limit: '5mb' }))
app.use('/api', rateLimiter)

mountRoutes(app)

// Production (npm start): this server also serves the built dashboard, so the whole
// app is one local address. Unknown non-API paths fall back to index.html (SPA routes).
const dist = resolve('dist')
if (process.env.SERVE_CLIENT === '1' && existsSync(resolve(dist, 'index.html'))) {
  app.use(express.static(dist, { index: 'index.html', maxAge: '1h' }))
  // Page routes only: API calls and missing asset files (e.g. an old build's chunk) get a real 404.
  app.get(/^(?!\/api\/|\/assets\/)[^.]*$/, (_req, res) => res.sendFile(resolve(dist, 'index.html')))
}

// Open the DB (and apply pending migrations) before serving.
getDb()
// Daily refresh (Data Center → Jobs): on by default, off when saved off, OFFLINE=1 or SCHEDULER=0.
startScheduler()

app.listen(env.port, env.host, () => {
  console.log(`Server running on http://${env.host}:${env.port}`)
})

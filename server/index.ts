import express from 'express'
import cors from 'cors'
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
app.use(rateLimiter)

mountRoutes(app)

// Open the DB (and apply pending migrations) before serving.
getDb()
// Opt-in daily refresh (Data Center → Jobs); a no-op until enabled.
startScheduler()

app.listen(env.port, env.host, () => {
  console.log(`Server running on http://${env.host}:${env.port}`)
})

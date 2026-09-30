import express from 'express'
import cors from 'cors'
import { env } from './lib/env.js'
import { getDb } from './db/client.js'
import { mountRoutes } from './routes/index.js'
import { rateLimiter } from './middleware/rate-limiter.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '5mb' }))
app.use(rateLimiter)

mountRoutes(app)

// Open the DB (and apply pending migrations) before serving.
getDb()

app.listen(env.port, () => {
  console.log(`Server running on http://localhost:${env.port}`)
})

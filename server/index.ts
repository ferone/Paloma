import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { quotesRouter } from './routes/quotes.js'
import { batchRouter } from './routes/batch.js'
import { historicalRouter } from './routes/historical.js'
import { goldPriceRouter } from './routes/gold-price.js'
import { goldLiquidityRouter } from './routes/gold-liquidity.js'
import { rateLimiter } from './middleware/rate-limiter.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use(rateLimiter)

app.use('/api/quotes', quotesRouter)
app.use('/api/batch', batchRouter)
app.use('/api/historical', historicalRouter)
app.use('/api/gold-price', goldPriceRouter)
app.use('/api/gold-liquidity', goldLiquidityRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

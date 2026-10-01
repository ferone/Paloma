// Regression: a holding must not stay valued at its trade price once closes
// for its price symbol exist. Root cause (reproduced on a demo.db copy): two
// ledger writes in quick succession start two NAV recomputes; the second one
// saw the first one's IN-FLIGHT fetch as "recently tried", skipped it, valued
// BTC-SPOT on an empty cache, and that result was cached and published as the
// portfolio:summary artifact. Nothing recomputed when the closes landed.
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client.js'
import { readArtifact, upsertDailyBars } from '../db/repo.js'
import { ARTIFACTS, type PortfolioSummaryLite } from '../../shared/artifacts.js'
import { emitPricesWritten } from '../jobs/events.js'
import { fallbackMarks } from './fallback.js'
import * as repo from './repo.js'
import { resetPriceFetchState, setPriceSource } from './prices.js'
import { getComputed, invalidate, resetCache } from './service.js'

function weekdays(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const BASE: Record<string, number> = { 'GC=F': 2000, 'BTC=F': 60_000, IBIT: 35 }
const bars = (symbol: string) => weekdays('2023-12-01', '2024-03-29').map((date, i) => ({ date, close: (BASE[symbol] ?? 50) * (1 + i * 0.001) }))
const LAST_BTC = bars('BTC=F').at(-1)!.close

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('portfolio marks after closes land', () => {
  let accountId: number
  const buy = (instrumentId: string, tradeDate: string, quantity: number, price: number) =>
    repo.createTransaction({ tradeDate, settleDate: null, accountId, counterAccountId: null, instrumentId, type: 'buy', quantity, price, fees: 0, notes: null })

  beforeEach(() => {
    useTestDb()
    resetCache()
    resetPriceFetchState()
    accountId = repo.createAccount({ name: 'Broker', custody: 'broker' }).id
    repo.createTransaction({ tradeDate: '2024-01-02', settleDate: null, accountId, counterAccountId: null, instrumentId: 'USD', type: 'subscription', quantity: 1_000_000, price: 1, fees: 0, notes: null })
  })

  it('a recompute started while another is still fetching a symbol waits for that fetch', async () => {
    const gate = deferred()
    let btcFetches = 0
    setPriceSource({
      history: async (s) => {
        if (s === 'BTC=F') {
          btcFetches++
          await gate.promise // slow download, still in flight when the second write lands
        }
        return bars(s)
      },
    })
    buy('BTC-SPOT', '2024-01-03', 2, 100_000)
    const first = getComputed()
    buy('IBIT', '2024-01-04', 1000, 30) // second ledger write → new version → second recompute
    const second = getComputed()
    gate.resolve()
    const [, c] = await Promise.all([first, second])

    expect(btcFetches).toBe(1)
    expect(fallbackMarks(c)).toEqual([])
    expect(c.run.marks.get('BTC-SPOT')).toMatchObject({ price: LAST_BTC, fallback: false })
    expect(readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)!.data.nav).toBeCloseTo(c.run.points.at(-1)!.nav, 6)
  })

  it('price ingestion landing closes for a held symbol recomputes the NAV and republishes the artifact', async () => {
    setPriceSource({
      history: async (s) => {
        if (s === 'BTC=F') throw new Error('Too Many Requests')
        return bars(s)
      },
    })
    buy('BTC-SPOT', '2024-01-03', 2, 100_000)
    const before = await getComputed()
    expect(fallbackMarks(before).map((f) => f.instrumentId)).toEqual(['BTC-SPOT'])
    const staleNav = readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)!.data.nav

    // The marketdata Yahoo job writes the closes and announces them.
    upsertDailyBars(bars('BTC=F').map((b) => ({ symbol: 'BTC=F', date: b.date, close: b.close, source: 'yahoo' })))
    emitPricesWritten(['BTC=F'])
    await until(() => readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)!.data.nav !== staleNav)

    const art = readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)!.data
    expect(art.nav).toBeCloseTo(1_000_000 + 2 * (LAST_BTC - 100_000), 0)
    const after = await getComputed()
    expect(fallbackMarks(after)).toEqual([])
  })

  it('closes written by another process (no event) invalidate the cached NAV on the next request', async () => {
    setPriceSource({
      history: async (s) => {
        if (s === 'BTC=F') throw new Error('offline')
        return bars(s)
      },
    })
    buy('BTC-SPOT', '2024-01-03', 2, 100_000)
    const before = await getComputed()
    expect(fallbackMarks(before)).toHaveLength(1)
    expect(await getComputed()).toBe(before) // cached

    upsertDailyBars(bars('BTC=F').map((b) => ({ symbol: 'BTC=F', date: b.date, close: b.close, source: 'yahoo' })))
    const after = await getComputed()
    expect(after).not.toBe(before)
    expect(fallbackMarks(after)).toEqual([])
  })

  it('ignores closes for symbols the portfolio does not use', async () => {
    setPriceSource({ history: async (s) => bars(s) })
    buy('BTC-SPOT', '2024-01-03', 2, 100_000)
    const c = await getComputed()
    upsertDailyBars([{ symbol: 'SPY', date: '2024-03-29', close: 500, source: 'yahoo' }])
    emitPricesWritten(['SPY'])
    expect(await getComputed()).toBe(c)
    invalidate()
  })
})

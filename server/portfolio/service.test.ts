import { beforeEach, describe, expect, it } from 'vitest'
import { useTestDb } from '../db/client.js'
import { readArtifact } from '../db/repo.js'
import { ARTIFACTS, type PortfolioSummaryLite } from '../../shared/artifacts.js'
import * as repo from './repo.js'
import { setPriceSource } from './prices.js'
import { getComputed, resetCache } from './service.js'
import { buildAttribution, buildHoldings, buildPerformance, buildRisk, buildSummary, buildVault } from './views.js'

// Deterministic closes: weekdays from 2024-01-01, GLD drifts up, gold/silver flat-ish.
function fakeBars(symbol: string, from: string) {
  const out: { date: string; close: number }[] = []
  const start = Date.parse('2023-12-01T00:00:00Z')
  const end = Date.parse('2024-03-29T00:00:00Z')
  let i = 0
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t)
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
    const date = d.toISOString().slice(0, 10)
    i++
    if (date < from) continue
    const base: Record<string, number> = { GLD: 190, 'GC=F': 2000, 'SI=F': 23, SLV: 21, SPY: 470, 'DX-Y.NYB': 103 }
    const wiggle = Math.sin(i / 3) * 0.01 + i * 0.0005
    out.push({ date, close: (base[symbol] ?? 50) * (1 + wiggle) })
  }
  return out
}

describe('portfolio repositories + service', () => {
  beforeEach(() => {
    useTestDb()
    resetCache()
    setPriceSource({ history: async (s, from) => fakeBars(s, from) })
  })

  it('returns valid empty shapes for an empty ledger and publishes an empty artifact', async () => {
    const c = await getComputed()
    const s = buildSummary(c)
    expect(s.empty).toBe(true)
    expect(s.nav).toBe(0)
    expect(buildHoldings(c).holdings).toEqual([])
    expect((await buildPerformance(c, 'GLD')).series).toEqual([])
    expect((await buildRisk(c)).var).toEqual([])
    expect(buildAttribution(c).byHolding).toEqual([])
    expect(buildVault(c).items).toEqual([])
    expect(readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)?.data.nav).toBe(0)
  })

  it('round-trips accounts, transactions and physical items with an audit trail', () => {
    const broker = repo.createAccount({ name: 'Broker', custody: 'broker' })
    const vault = repo.createAccount({ name: 'Vault', custody: 'vault', institution: 'Brinks' })
    expect(repo.listAccounts().map((a) => a.name)).toEqual(['Broker', 'Vault'])

    const t = repo.createTransaction({
      tradeDate: '2024-01-02',
      settleDate: null,
      accountId: broker.id,
      counterAccountId: null,
      instrumentId: 'GLD',
      type: 'buy',
      quantity: 10,
      price: 190,
      fees: 1,
      notes: 'first',
    })
    expect(repo.getTransaction(t.id)).toMatchObject({ instrumentId: 'GLD', quantity: 10, price: 190, fees: 1, currency: 'USD' })
    repo.updateTransaction(t.id, { ...t, quantity: 12, notes: 'edited' })
    expect(repo.getTransaction(t.id)!.quantity).toBe(12)

    const item = repo.createPhysical(
      { asset: 'gold', form: 'bar', description: '1 kg bar', weight: 1, weightUnit: 'kg', purity: 0.9999, serial: 'AB123', accountId: vault.id, acquiredDate: '2024-01-03', status: 'held' },
      { totalCost: 66_000, fees: 50, accountId: vault.id },
    )
    expect(item.fineQty).toBeCloseTo(32.1507466 * 0.9999, 5)
    const buy = repo.getTransaction(item.acquisitionTxnId!)!
    expect(buy).toMatchObject({ type: 'buy', instrumentId: 'XAU-PHYS', fees: 50 })
    expect(buy.quantity * buy.price).toBeCloseTo(66_000, 6)

    expect(() => repo.deleteAccount(vault.id)).toThrow(repo.InUseError)
    expect(repo.deleteTransaction(t.id)).toBe(true)
    const trail = repo.listAudit({ entity: 'transaction', entityId: String(t.id) })
    expect(trail.map((a) => a.action)).toEqual(['delete', 'update', 'create'])
    expect(trail[1].before).toMatchObject({ quantity: 10 })
    expect(trail[1].after).toMatchObject({ quantity: 12 })
  })

  it('commits and rolls back an import batch', () => {
    const acc = repo.createAccount({ name: 'Broker', custody: 'broker' })
    const row = { tradeDate: '2024-01-02', settleDate: null, accountId: acc.id, counterAccountId: null, instrumentId: 'USD', type: 'subscription' as const, quantity: 1000, price: 1, fees: 0, notes: null }
    const batch = repo.commitBatch([row, { ...row, tradeDate: '2024-01-03' }], 'ledger.csv')
    expect(batch).toMatchObject({ rowCount: 2, status: 'committed', filename: 'ledger.csv' })
    expect(repo.listTransactions({ batch: batch.id })).toHaveLength(2)
    const out = repo.rollbackBatch(batch.id)!
    expect(out.removed).toBe(2)
    expect(out.batch.status).toBe('rolled_back')
    expect(repo.countTransactions()).toBe(0)
  })

  it('recomputes NAV that reconciles to holdings + cash and persists snapshots, units and the artifact', async () => {
    const acc = repo.createAccount({ name: 'Broker', custody: 'broker' })
    const base = { settleDate: null, accountId: acc.id, counterAccountId: null, fees: 0, notes: null }
    repo.createTransaction({ ...base, tradeDate: '2024-01-02', instrumentId: 'USD', type: 'subscription', quantity: 100_000, price: 1 })
    repo.createTransaction({ ...base, tradeDate: '2024-01-03', instrumentId: 'GLD', type: 'buy', quantity: 200, price: 189, fees: 5 })
    repo.createTransaction({ ...base, tradeDate: '2024-01-04', instrumentId: 'GC', type: 'futures_open', quantity: 1, price: 2000, fees: 4 })
    repo.createTransaction({ ...base, tradeDate: '2024-02-01', instrumentId: 'USD', type: 'subscription', quantity: 50_000, price: 1 })
    repo.createTransaction({ ...base, tradeDate: '2024-02-15', instrumentId: 'GLD', type: 'sell', quantity: 50, price: 195, fees: 5 })

    const c = await getComputed()
    const s = buildSummary(c)
    const h = buildHoldings(c)
    expect(s.empty).toBe(false)
    const holdingsValue = h.holdings.reduce((sum, x) => sum + x.value, 0)
    expect(s.nav).toBeCloseTo(holdingsValue + h.totalCash, 6)
    expect(s.totalPnl).toBeCloseTo(s.nav - 150_000, 6)
    expect(h.holdings.find((x) => x.instrumentId === 'GLD')!.quantity).toBe(150)
    const gc = h.holdings.find((x) => x.instrumentId === 'GC')!
    expect(gc.notional).toBeGreaterThan(190_000)
    expect(gc.value).toBeCloseTo(gc.unrealizedPnl, 8)

    const units = repo.listUnits()
    expect(units).toHaveLength(2)
    expect(units[0].navPerUnit).toBe(100)
    expect(repo.listSnapshots().length).toBe(c.run.points.length)
    const art = readArtifact<PortfolioSummaryLite>(ARTIFACTS.portfolioSummary)!.data
    expect(art.nav).toBeCloseTo(s.nav, 6)
    expect(Object.keys(art).sort()).toEqual(
      ['allocation', 'asOf', 'byAsset', 'dayPnl', 'dayReturn', 'mtdReturn', 'nav', 'navPerUnit', 'sinceInceptionReturn', 'unitsOutstanding', 'ytdReturn'].sort(),
    )

    const perf = await buildPerformance(c, 'blend')
    expect(perf.series.length).toBe(c.run.points.length)
    expect(perf.stats.twr).toBeCloseTo(s.sinceInceptionReturn!, 10)
    expect(perf.series[0].benchmark).not.toBeNull()
    expect(perf.stats.irr).not.toBeNull()

    const att = buildAttribution(c)
    expect(att.totalPnl).toBeCloseTo(s.totalPnl, 6)
    expect(att.residual).toBeCloseTo(0, 10)
    const later = buildAttribution(c, '2024-02-01')
    expect(later.residual).toBeCloseTo(0, 10)
    expect(later.byHolding.reduce((sum, r) => sum + r.contribution, 0)).toBeCloseTo(later.twr!, 10)
    expect(att.bySleeve.map((r) => r.key).sort()).toEqual(['cash', 'etf', 'futures'].filter((k) => att.bySleeve.some((r) => r.key === k)).sort())

    const risk = await buildRisk(c)
    expect(risk.var).toHaveLength(2)
    expect(risk.betas.find((b) => b.symbol === 'SPY')!.observations).toBeGreaterThan(10)
  })
})

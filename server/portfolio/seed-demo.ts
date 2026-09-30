// Demo ledger for development and testing ONLY. Never run automatically.
//   npm run portfolio:seed-demo    writes a multi-year ledger (every row noted 'DEMO')
//   npm run portfolio:clear-demo   removes every DEMO row, vault item and account
// Trade prices are real Yahoo closes on each trade date (cached in prices_daily).
import { getDb } from '../db/client.js'
import type { TxnType } from '../../shared/portfolio.js'
import { loadPrices } from './prices.js'
import * as repo from './repo.js'
import { getComputed } from './service.js'

const TAG = 'DEMO'

function note(text: string): string {
  return `${TAG} · ${text}`
}

export function clearDemo(): { transactions: number; items: number; accounts: number } {
  const db = getDb()
  const items = db.prepare(`SELECT id FROM pf_physical_items WHERE notes LIKE 'DEMO%'`).all() as { id: number }[]
  items.forEach((i) => repo.deletePhysical(i.id))
  const txns = db.prepare(`SELECT id FROM pf_transactions WHERE notes LIKE 'DEMO%'`).all() as { id: number }[]
  txns.forEach((t) => repo.deleteTransaction(t.id))
  let accounts = 0
  for (const a of repo.listAccounts().filter((x) => x.notes === TAG)) {
    try {
      repo.deleteAccount(a.id)
      accounts++
    } catch {
      console.warn(`Kept account "${a.name}": it is referenced by non-demo rows.`)
    }
  }
  return { transactions: txns.length, items: items.length, accounts }
}

export async function seedDemo(): Promise<number> {
  const existing = (getDb().prepare(`SELECT COUNT(*) AS n FROM pf_transactions WHERE notes LIKE 'DEMO%'`).get() as { n: number }).n
  if (existing > 0) throw new Error(`Demo data already present (${existing} rows). Run npm run portfolio:clear-demo first.`)

  const symbols = ['GLD', 'IAU', 'SLV', 'GDX', 'PSLV', 'GC=F', 'SI=F', 'MGC=F']
  const { book, errors } = await loadPrices(symbols, '2021-12-20', { force: true })
  const missing = symbols.filter((s) => !book.has(s))
  if (missing.length) throw new Error(`Cannot seed without closes for ${missing.join(', ')}: ${errors.join('; ')}`)

  /** First trading date ≥ `date` for `symbol`, and that day's close. */
  const px = (symbol: string, date: string): { date: string; price: number } => {
    const d = book.dates(symbol).find((x) => x >= date)
    if (!d) throw new Error(`No close for ${symbol} on or after ${date}`)
    return { date: d, price: Math.round(book.close(symbol, d)!.price * 100) / 100 }
  }

  const broker = repo.createAccount({ name: 'Prime Broker (demo)', custody: 'broker', institution: 'Interactive Brokers', notes: TAG })
  const vault = repo.createAccount({ name: 'Bullion Vault (demo)', custody: 'vault', institution: "Brink's Zurich", notes: TAG })
  const bank = repo.createAccount({ name: 'Custody Cash (demo)', custody: 'bank', institution: 'State Street', notes: TAG })

  let n = 0
  const add = (tradeDate: string, type: TxnType, instrumentId: string, quantity: number, price = 1, fees = 0, accountId = broker.id, text = '', counterAccountId: number | null = null) => {
    repo.createTransaction({ tradeDate, settleDate: null, accountId, counterAccountId, instrumentId, type, quantity, price, fees, notes: note(text || type) })
    n++
  }
  const trade = (date: string, type: 'buy' | 'sell', sym: string, qty: number, text = '') => {
    const p = px(sym, date)
    add(p.date, type, sym, qty, p.price, Math.round(qty * 0.005 * 100) / 100, broker.id, text)
    return p
  }

  // Capital and custody set-up
  add('2022-01-03', 'subscription', 'USD', 5_000_000, 1, 0, bank.id, 'Seed capital')
  add('2022-01-04', 'transfer', 'USD', 3_500_000, 1, 0, bank.id, 'Fund prime broker', broker.id)
  add('2022-01-28', 'transfer', 'USD', 100_000, 1, 0, bank.id, 'Fund vault account', vault.id)

  // Core ETF sleeve
  trade('2022-01-05', 'buy', 'GLD', 9_000, 'Core gold ETF')
  trade('2022-01-05', 'buy', 'IAU', 20_000, 'Core gold ETF')
  trade('2022-01-05', 'buy', 'SLV', 30_000, 'Core silver ETF')
  trade('2022-09-01', 'buy', 'GDX', 10_000, 'Miners beta')

  // Allocated physical: 1 kg gold bar and a 1,000 oz good-delivery silver bar
  const g = px('GC=F', '2022-02-01')
  const goldFine = (1000 / 31.1034768) * 0.9999
  repo.createPhysical(
    {
      metal: 'gold', form: 'bar', description: '1 kg cast bar', weight: 1, weightUnit: 'kg', purity: 0.9999, serial: 'VP-2201-8841',
      refiner: 'Valcambi', accountId: vault.id, acquiredDate: g.date, premiumPaid: Math.round(goldFine * 18), storageFeeRateAnnual: 0.0012, status: 'held', notes: TAG,
    },
    { totalCost: Math.round(goldFine * (g.price + 18) * 100) / 100, fees: 75, accountId: vault.id },
  )
  n++
  const s = px('SI=F', '2022-03-01')
  repo.createPhysical(
    {
      metal: 'silver', form: 'bar', description: '1,000 oz good-delivery bar', weight: 1000, weightUnit: 'oz', purity: 0.999, serial: 'SA-7719304',
      refiner: 'Asahi Refining', accountId: vault.id, acquiredDate: s.date, premiumPaid: Math.round(999 * 0.6), storageFeeRateAnnual: 0.0025, status: 'held', notes: TAG,
    },
    { totalCost: Math.round(999 * (s.price + 0.6) * 100) / 100, fees: 60, accountId: vault.id },
  )
  n++

  // GC futures round trip (Mar → May 2023), and an open MGC position
  const o = px('GC=F', '2023-03-01')
  add(o.date, 'futures_open', 'GC', 5, o.price, 12.5, broker.id, 'Long GCJ23 ahead of banking stress')
  const c = px('GC=F', '2023-05-01')
  add(c.date, 'futures_close', 'GC', 5, c.price, 12.5, broker.id, 'Close GCJ23 → take profit')
  const m = px('MGC=F', '2026-08-03')
  add(m.date, 'futures_open', 'MGC', 10, m.price, 10, broker.id, 'Tactical long MGCZ26')

  // Second close, rebalancing, redemption
  add('2023-06-01', 'subscription', 'USD', 2_000_000, 1, 0, bank.id, 'Second close')
  add('2023-06-01', 'transfer', 'USD', 1_500_000, 1, 0, bank.id, 'Fund prime broker', broker.id)
  trade('2023-06-02', 'buy', 'GLD', 5_000, 'Add gold after second close')
  trade('2024-04-15', 'sell', 'GLD', 6_000, 'Trim gold into strength (FIFO across two lots)')
  trade('2024-09-03', 'buy', 'PSLV', 20_000, 'Silver trust diversification')
  trade('2025-03-03', 'sell', 'SLV', 10_000, 'Raise cash for redemption')
  add('2025-03-14', 'transfer', 'USD', 1_000_000, 1, 0, broker.id, 'Cash for redemption', bank.id)
  add('2025-03-17', 'redemption', 'USD', 1_000_000, 1, 0, bank.id, 'Investor redemption')
  trade('2025-09-02', 'buy', 'SLV', 15_000, 'Rebuild silver')
  add('2026-02-02', 'subscription', 'USD', 1_500_000, 1, 0, bank.id, 'Third close')
  add('2026-02-02', 'transfer', 'USD', 1_400_000, 1, 0, bank.id, 'Fund prime broker', broker.id)
  trade('2026-02-03', 'buy', 'IAU', 15_000, 'Deploy third close')

  // Recurring: quarterly management fee, storage, interest; GDX dividends
  for (let y = 2022; y <= 2026; y++) {
    for (const q of [3, 6, 9, 12]) {
      const date = `${y}-${String(q).padStart(2, '0')}-${q === 3 || q === 12 ? '31' : '30'}`
      if (date < '2022-03-31' || !book.dates('GC=F').some((d) => d >= date)) continue
      const weekday = px('GC=F', date).date
      add(weekday, 'fee', 'USD', 12_500, 1, 0, bank.id, `Management fee Q${q / 3} ${y}`)
      const gv = px('GC=F', date).price * goldFine
      const sv = px('SI=F', date).price * 999
      add(weekday, 'storage_fee', 'XAU-PHYS', Math.round((gv * 0.0012) / 4 * 100) / 100, 1, 0, vault.id, `Vault storage Q${q / 3} ${y}`)
      add(weekday, 'storage_fee', 'XAG-PHYS', Math.round((sv * 0.0025) / 4 * 100) / 100, 1, 0, vault.id, `Vault storage Q${q / 3} ${y}`)
      const rate = y === 2022 ? 0.01 : y >= 2025 ? 0.04 : 0.05
      add(weekday, 'interest', 'USD', Math.round((500_000 * rate) / 4 * 100) / 100, 1, 0, bank.id, `Deposit interest Q${q / 3} ${y}`)
    }
  }
  for (const d of ['2022-12-20', '2023-12-20', '2024-12-20', '2025-12-19']) add(px('GDX', d).date, 'dividend', 'GDX', 10_000 * 0.25, 1, 0, broker.id, 'GDX distribution')

  return n
}

// CLI
const isMain = process.argv[1] && /seed-demo\.(ts|js)$/.test(process.argv[1])
if (isMain) {
  const clear = process.argv.includes('--clear')
  ;(async () => {
    if (clear) {
      const r = clearDemo()
      console.log(`Removed ${r.transactions} demo transactions, ${r.items} vault items, ${r.accounts} accounts.`)
    } else {
      const n = await seedDemo()
      console.log(`Wrote ${n} demo ledger rows.`)
    }
    const run = await getComputed({ force: true })
    const last = run.run.points.at(-1)
    console.log(last ? `NAV ${last.nav.toFixed(2)} · NAV/unit ${last.navPerUnit?.toFixed(4)} on ${last.date}` : 'Ledger empty.')
    for (const w of run.run.warnings) console.warn(`warning: ${w}`)
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}

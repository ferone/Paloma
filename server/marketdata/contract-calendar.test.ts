import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contractExpiry } from './contracts.js'
import { getDb, useTestDb } from '../db/client.js'
import { upsertContracts } from '../db/shared-repo.js'
import { runMigrations } from '../db/migrate.js'

const SQL = readFileSync(fileURLToPath(new URL('../db/migrations/032_contract_holiday_calendar.sql', import.meta.url)), 'utf8')
const LINE = /^UPDATE contracts SET last_trade = (NULL|'[\d-]+'), first_notice = (NULL|'[\d-]+') WHERE root = '([A-Z]+)' AND year = (\d+) AND month = (\d+);$/
const val = (s: string) => (s === 'NULL' ? null : s.slice(1, -1))

describe('032_contract_holiday_calendar.sql', () => {
  const updates = SQL.split('\n').filter((l) => l.startsWith('UPDATE'))

  it('every repair line matches the current expiry rule', () => {
    expect(updates.length).toBeGreaterThan(100)
    for (const l of updates) {
      const m = LINE.exec(l)
      expect(m, l).not.toBeNull()
      const [, lt, fn, root, year, month] = m!
      expect({ lastTrade: val(lt), firstNotice: val(fn) }, l).toEqual(contractExpiry(root, Number(month), Number(year)))
    }
  })

  it('repairs a stored BTC Dec-2026 row that predates the holiday calendar', () => {
    useTestDb()
    const db = getDb()
    db.prepare("DELETE FROM _migrations WHERE name = '032_contract_holiday_calendar.sql'").run()
    upsertContracts([{ symbol: 'BTCZ26', root: 'BTC', year: 2026, month: 12, lastTrade: '2026-12-25', firstNotice: null }])
    runMigrations(db)
    expect(db.prepare("SELECT last_trade FROM contracts WHERE symbol = 'BTCZ26'").get()).toEqual({ last_trade: '2026-12-24' })
  })
})

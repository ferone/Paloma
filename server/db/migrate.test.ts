import { describe, expect, it } from 'vitest'
import { useTestDb } from './client.js'

describe('070_assets migration', () => {
  it('accepts any asset id and crypto custody, keeps foreign keys enforced', () => {
    const db = useTestDb()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)

    db.prepare(`INSERT INTO pf_accounts (name, custody) VALUES ('Cold wallet', 'wallet'), ('Exchange', 'exchange')`).run()
    db.prepare(`INSERT INTO pf_instruments (id, name, kind, metal) VALUES ('BTC-SPOT', 'Bitcoin', 'physical', 'btc')`).run()
    db.prepare(
      `INSERT INTO pf_physical_items (metal, form, description, weight, weight_unit, purity, fine_oz) VALUES ('btc', 'coin', 'Cold storage', 1.5, 'BTC', 1, 0)`,
    ).run()
    db.prepare(`INSERT INTO ml_runs (metal, started_at, status) VALUES ('btc', '2026-10-01', 'running')`).run()

    // Constraints that should still hold.
    expect(() => db.prepare(`INSERT INTO pf_accounts (name, custody) VALUES ('X', 'shoebox')`).run()).toThrow(/CHECK/)
    expect(() =>
      db.prepare(`INSERT INTO ml_predictions (run_id, metal, instrument_id, date, horizon_days, p_up, expected_move, validation_status, created_at) VALUES (999, 'btc', 'BTC.out', '2026-10-01', 20, 0.5, 0, 'untested', '2026-10-01')`).run(),
    ).toThrow(/FOREIGN KEY/)

    // The rebuilt tables are still referenced correctly by pf_transactions.
    const fks = db.prepare(`SELECT "table" FROM pragma_foreign_key_list('pf_transactions')`).all() as { table: string }[]
    expect(fks.map((f) => f.table).sort()).toEqual(['pf_accounts', 'pf_accounts', 'pf_import_batches', 'pf_instruments'])
    expect(db.pragma('foreign_key_check')).toEqual([])
  })
})

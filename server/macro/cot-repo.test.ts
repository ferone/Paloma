import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useTestDb } from '../db/client.js'
import { readCot, upsertCot } from '../db/shared-repo.js'
import { readCotReports } from './cot-repo.js'
import { deriveCot, fromCotRow, parseCotRows, type SocrataCotRow } from './cot.js'

describe('migration 073 backfill', () => {
  it('copies existing cot_reports into cot_positions so derived positioning is unchanged', () => {
    const db = useTestDb()
    const fx = JSON.parse(readFileSync(new URL('./__fixtures__/cot-gold-2026-09.json', import.meta.url), 'utf8')) as SocrataCotRow[]
    upsertCot(parseCotRows(fx, 'GOLD'))
    // Re-run the migration's backfill statement against the wide table.
    const sql = readFileSync(new URL('../db/migrations/073_cot_positions.sql', import.meta.url), 'utf8')
    db.exec('DELETE FROM cot_positions')
    db.exec(sql.slice(sql.indexOf('INSERT INTO cot_positions')))
    const fromPositions = readCotReports('GOLD', 'disagg')
    const fromWide = readCot('GOLD').map(fromCotRow)
    expect(fromPositions).toEqual(fromWide)
    expect(deriveCot(fromPositions, 156, 2)).toEqual(deriveCot(fromWide, 156, 2))
  })
})

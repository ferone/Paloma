import type Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url))

// Numbered .sql files applied in order, each once, inside a transaction.
// Ranges are reserved per domain so parallel work never collides:
//   001-009 core · 010-019 portfolio · 020-029 quant · 030-039 market data
//   040-049 macro/ai · 050-059 ml · 060-069 markets
export function runMigrations(db: Database.Database): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  const done = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name),
  )
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
    })()
    applied.push(file)
  }
  return applied
}

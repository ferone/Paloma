import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runMigrations } from './migrate.js'

// One process-wide SQLite connection (better-sqlite3 is synchronous and fast;
// WAL lets the dev server and CLI scripts read while a job writes).
let db: Database.Database | null = null

export function dbPath(): string {
  return resolve(process.env.DB_PATH || 'data/gold.db')
}

export function getDb(): Database.Database {
  if (db) return db
  const file = dbPath()
  mkdirSync(dirname(file), { recursive: true })
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function isDbReady(): boolean {
  try {
    getDb().prepare('SELECT 1').get()
    return true
  } catch {
    return false
  }
}

/**
 * Test helper: swap the process-wide connection for a fresh in-memory DB with
 * all migrations applied. Repositories that call getDb() then hit this DB.
 */
export function useTestDb(): Database.Database {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

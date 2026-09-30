import { getDb } from './client.js'

// Small shared repositories used by several domains.

/** SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC) → ISO-8601. */
export function sqliteToIso(ts: string): string {
  return ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as T) : fallback
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}

export function readArtifact<T>(name: string): { data: T; generatedAt: string } | null {
  const row = getDb().prepare('SELECT data, generated_at FROM artifacts WHERE name = ?').get(name) as
    | { data: string; generated_at: string }
    | undefined
  return row ? { data: JSON.parse(row.data) as T, generatedAt: sqliteToIso(row.generated_at) } : null
}

export function writeArtifact(name: string, data: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO artifacts (name, data, generated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(name) DO UPDATE SET data = excluded.data, generated_at = excluded.generated_at`,
    )
    .run(name, JSON.stringify(data))
}

export interface DailyBar {
  symbol: string
  date: string
  open?: number | null
  high?: number | null
  low?: number | null
  close: number
  volume?: number | null
  openInterest?: number | null
  source: string
}

export function upsertDailyBars(bars: DailyBar[]): number {
  const db = getDb()
  const stmt = db.prepare(
    `INSERT INTO prices_daily (symbol, date, open, high, low, close, volume, open_interest, source)
     VALUES (@symbol, @date, @open, @high, @low, @close, @volume, @openInterest, @source)
     ON CONFLICT(symbol, date, source) DO UPDATE SET
       open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
       volume = excluded.volume, open_interest = excluded.open_interest`,
  )
  db.transaction((rows: DailyBar[]) => {
    for (const b of rows) stmt.run({ open: null, high: null, low: null, volume: null, openInterest: null, ...b })
  })(bars)
  return bars.length
}

export function readDailyBars(symbol: string, opts: { source?: string; from?: string } = {}): DailyBar[] {
  const { source = null, from = null } = opts
  return getDb()
    .prepare(
      `SELECT symbol, date, open, high, low, close, volume, open_interest AS openInterest, source
       FROM prices_daily
       WHERE symbol = ? AND (? IS NULL OR source = ?) AND (? IS NULL OR date >= ?)
       ORDER BY date`,
    )
    .all(symbol, source, source, from, from) as DailyBar[]
}

export interface JobHandle {
  id: number
  succeed(message?: string, detail?: unknown): void
  fail(message: string, detail?: unknown): void
}

/** Record a background job run in job_runs. */
export function startJob(name: string): JobHandle {
  const db = getDb()
  const id = Number(db.prepare(`INSERT INTO job_runs (name, state) VALUES (?, 'running')`).run(name).lastInsertRowid)
  const finish = (state: 'succeeded' | 'failed', message: string | null, detail: unknown) =>
    db
      .prepare(`UPDATE job_runs SET state = ?, finished_at = datetime('now'), message = ?, detail = ? WHERE id = ?`)
      .run(state, message, detail === undefined ? null : JSON.stringify(detail), id)
  return {
    id,
    succeed: (message, detail) => finish('succeeded', message ?? null, detail),
    fail: (message, detail) => finish('failed', message, detail),
  }
}

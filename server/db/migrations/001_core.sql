-- Core, cross-domain tables.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Generic JSON store for derived outputs (engine snapshots, reports, caches).
CREATE TABLE artifacts (
  name         TEXT PRIMARY KEY,
  data         TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily bars for any symbol from any source (yahoo, databento, fred...).
CREATE TABLE prices_daily (
  symbol        TEXT NOT NULL,
  date          TEXT NOT NULL,
  open          REAL,
  high          REAL,
  low           REAL,
  close         REAL NOT NULL,
  volume        REAL,
  open_interest REAL,
  source        TEXT NOT NULL,
  PRIMARY KEY (symbol, date, source)
);
CREATE INDEX idx_prices_daily_symbol_date ON prices_daily (symbol, date);

-- Background job runs (refreshes, backfills, ML training, AI reports).
CREATE TABLE job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed')),
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  message     TEXT,
  detail      TEXT
);
CREATE INDEX idx_job_runs_name ON job_runs (name, started_at);

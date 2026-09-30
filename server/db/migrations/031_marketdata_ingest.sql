-- Market-data ingest bookkeeping (marketdata domain).

-- Audit ledger of every paid Databento download (estimated cost from the free
-- metadata.get_cost call made immediately before the pull).
CREATE TABLE databento_pulls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_run_id     INTEGER,
  root           TEXT NOT NULL,
  schema         TEXT NOT NULL,
  start          TEXT NOT NULL,
  end            TEXT NOT NULL,
  estimated_cost REAL NOT NULL,
  records        INTEGER NOT NULL DEFAULT 0,
  rows_written   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_databento_pulls_root ON databento_pulls (root, schema, end);

-- Freshness and source-aware writes group contract bars by source.
CREATE INDEX idx_contract_bars_source ON contract_bars (source, date);
CREATE INDEX idx_prices_daily_source ON prices_daily (source, date);

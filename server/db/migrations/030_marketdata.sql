-- Market data shared across domains (written by marketdata jobs, read by quant/ml/markets).

-- Individual futures contracts (one row per listed/expired month).
CREATE TABLE contracts (
  symbol       TEXT PRIMARY KEY,        -- e.g. GCZ26 (root + month code + 2-digit year)
  root         TEXT NOT NULL,           -- GC, MGC, SI, SIL
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,        -- 1-12
  last_trade   TEXT,                    -- YYYY-MM-DD
  first_notice TEXT                     -- YYYY-MM-DD
);
CREATE INDEX idx_contracts_root ON contracts (root, year, month);

-- Daily bars per individual contract (Databento GLBX.MDP3 ohlcv-1d + statistics OI, or Yahoo *.CMX).
CREATE TABLE contract_bars (
  symbol        TEXT NOT NULL,
  date          TEXT NOT NULL,
  open          REAL,
  high          REAL,
  low           REAL,
  close         REAL NOT NULL,
  volume        REAL,
  open_interest REAL,
  source        TEXT NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE INDEX idx_contract_bars_date ON contract_bars (date);

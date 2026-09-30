-- migrate:foreign-keys-off
-- Multi-asset expansion: drop the gold/silver-only CHECK constraints so any
-- AssetId from shared/universe.ts can be stored, and allow crypto custody
-- accounts. The column is still named `metal`; it now holds an AssetId.
-- SQLite cannot alter a CHECK, so each table is rebuilt (create, copy, drop,
-- rename) with foreign keys off; the runner verifies foreign_key_check after.

-- pf_accounts: custody gains 'wallet' (self-custody) and 'exchange'.
CREATE TABLE pf_accounts_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  custody     TEXT NOT NULL CHECK (custody IN ('broker', 'vault', 'bank', 'wallet', 'exchange')),
  institution TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO pf_accounts_new SELECT id, name, custody, institution, notes, created_at FROM pf_accounts;
DROP TABLE pf_accounts;
ALTER TABLE pf_accounts_new RENAME TO pf_accounts;

-- pf_instruments: metal holds any AssetId.
CREATE TABLE pf_instruments_new (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('etf', 'future', 'physical', 'cash', 'equity')),
  metal           TEXT,
  price_symbol    TEXT,
  oz_per_contract REAL
);
INSERT INTO pf_instruments_new SELECT id, name, kind, metal, price_symbol, oz_per_contract FROM pf_instruments;
DROP TABLE pf_instruments;
ALTER TABLE pf_instruments_new RENAME TO pf_instruments;

-- pf_physical_items: metal holds any AssetId with a physical spec; 'BTC' joins the weight units.
CREATE TABLE pf_physical_items_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  metal                   TEXT NOT NULL,
  form                    TEXT NOT NULL CHECK (form IN ('bar', 'coin', 'round')),
  description             TEXT NOT NULL,
  weight                  REAL NOT NULL CHECK (weight > 0),
  weight_unit             TEXT NOT NULL CHECK (weight_unit IN ('oz', 'g', 'kg', 'BTC')),
  purity                  REAL NOT NULL CHECK (purity > 0 AND purity <= 1),
  fine_oz                 REAL NOT NULL,
  serial                  TEXT,
  refiner                 TEXT,
  account_id              INTEGER REFERENCES pf_accounts (id),
  acquisition_txn_id      INTEGER REFERENCES pf_transactions (id) ON DELETE SET NULL,
  acquired_date           TEXT,
  premium_paid            REAL,
  storage_fee_rate_annual REAL,
  status                  TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'sold')),
  notes                   TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO pf_physical_items_new SELECT * FROM pf_physical_items;
DROP TABLE pf_physical_items;
ALTER TABLE pf_physical_items_new RENAME TO pf_physical_items;

-- ml_runs / ml_predictions: metal holds any AssetId.
CREATE TABLE ml_runs_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  metal             TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  params            TEXT,
  features_used     TEXT,
  availability      TEXT,
  metrics           TEXT,
  validation_status TEXT CHECK (validation_status IN ('passed', 'failed', 'untested')),
  auc               REAL,
  permutation_p     REAL,
  importance        TEXT,
  calibration       TEXT,
  model_path        TEXT,
  data_through      TEXT,
  trained_at        TEXT,
  error             TEXT
);
INSERT INTO ml_runs_new SELECT * FROM ml_runs;
DROP TABLE ml_runs;
ALTER TABLE ml_runs_new RENAME TO ml_runs;
CREATE INDEX idx_ml_runs_metal ON ml_runs (metal, id);

CREATE TABLE ml_predictions_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            INTEGER NOT NULL REFERENCES ml_runs (id) ON DELETE CASCADE,
  metal             TEXT NOT NULL,
  instrument_id     TEXT NOT NULL,
  date              TEXT NOT NULL,
  horizon_days      INTEGER NOT NULL,
  p_up              REAL NOT NULL,
  p_up_low          REAL,
  p_up_high         REAL,
  expected_move     REAL NOT NULL,
  lower             REAL,
  upper             REAL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'failed', 'untested')),
  reasons           TEXT,
  created_at        TEXT NOT NULL
);
INSERT INTO ml_predictions_new SELECT * FROM ml_predictions;
DROP TABLE ml_predictions;
ALTER TABLE ml_predictions_new RENAME TO ml_predictions;
CREATE INDEX idx_ml_predictions_metal ON ml_predictions (metal, id);

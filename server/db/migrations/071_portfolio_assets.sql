-- migrate:foreign-keys-off
-- Portfolio multi-asset units. Futures instruments carry the universe's
-- dollar multiplier (`point_value`, formerly the troy-oz-only
-- `oz_per_contract`) and the underlying units per contract (`contract_size`,
-- oz / lb / BTC). For every existing gold and silver future both equal the old
-- oz_per_contract, so valuations are unchanged. ensureInstruments() re-seeds
-- both columns from shared/universe.ts on boot.
--
-- pf_physical_items gains the form 'balance': a custody holding (e.g. BTC in a
-- wallet or exchange account) is a plain quantity in the asset's physical
-- unit, not a bar or coin. The column `fine_oz` keeps its name; it now holds
-- the fine quantity in that unit (fine troy oz for bullion).
--
-- Both tables are referenced by pf_transactions / each other, so they are
-- rebuilt with foreign keys off; the runner checks foreign_key_check after.

CREATE TABLE pf_instruments_new (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('etf', 'future', 'physical', 'cash', 'equity')),
  metal         TEXT,
  price_symbol  TEXT,
  point_value   REAL,
  contract_size REAL
);
INSERT INTO pf_instruments_new (id, name, kind, metal, price_symbol, point_value, contract_size)
  SELECT id, name, kind, metal, price_symbol, oz_per_contract, oz_per_contract FROM pf_instruments;
DROP TABLE pf_instruments;
ALTER TABLE pf_instruments_new RENAME TO pf_instruments;

CREATE TABLE pf_physical_items_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  metal                   TEXT NOT NULL,
  form                    TEXT NOT NULL CHECK (form IN ('bar', 'coin', 'round', 'balance')),
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

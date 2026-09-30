-- Portfolio domain: fund ledger, physical register, unitization, NAV snapshots.
-- Tables are prefixed pf_ so they never collide with other domains.

CREATE TABLE pf_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  custody     TEXT NOT NULL CHECK (custody IN ('broker', 'vault', 'bank')),
  institution TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seeded from shared/universe.ts at runtime (ensureInstruments), idempotently.
CREATE TABLE pf_instruments (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('etf', 'future', 'physical', 'cash', 'equity')),
  metal           TEXT CHECK (metal IN ('gold', 'silver')),
  price_symbol    TEXT,
  oz_per_contract REAL
);

CREATE TABLE pf_import_batches (
  id             TEXT PRIMARY KEY,
  filename       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  row_count      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'rolled_back')),
  rolled_back_at TEXT
);

CREATE TABLE pf_transactions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_date         TEXT NOT NULL,
  settle_date        TEXT,
  account_id         INTEGER NOT NULL REFERENCES pf_accounts (id),
  counter_account_id INTEGER REFERENCES pf_accounts (id),
  instrument_id      TEXT NOT NULL REFERENCES pf_instruments (id),
  type               TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'deposit', 'withdrawal', 'subscription', 'redemption',
                       'fee', 'storage_fee', 'dividend', 'interest', 'futures_open', 'futures_close', 'transfer')),
  quantity           REAL NOT NULL,
  price              REAL NOT NULL DEFAULT 1,
  fees               REAL NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'USD',
  notes              TEXT,
  import_batch       TEXT REFERENCES pf_import_batches (id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pf_txn_date ON pf_transactions (trade_date, id);
CREATE INDEX idx_pf_txn_instrument ON pf_transactions (instrument_id);
CREATE INDEX idx_pf_txn_batch ON pf_transactions (import_batch);

CREATE TABLE pf_physical_items (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  metal                   TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  form                    TEXT NOT NULL CHECK (form IN ('bar', 'coin', 'round')),
  description             TEXT NOT NULL,
  weight                  REAL NOT NULL CHECK (weight > 0),
  weight_unit             TEXT NOT NULL CHECK (weight_unit IN ('oz', 'g', 'kg')),
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

-- Unit ledger, derived from subscriptions/redemptions on every NAV recompute.
CREATE TABLE pf_fund_units (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  date              TEXT NOT NULL,
  txn_id            INTEGER NOT NULL,
  type              TEXT NOT NULL,
  amount            REAL NOT NULL,
  units             REAL NOT NULL,
  nav_per_unit      REAL NOT NULL,
  units_outstanding REAL NOT NULL
);
CREATE INDEX idx_pf_units_date ON pf_fund_units (date);

CREATE TABLE pf_nav_snapshots (
  date           TEXT PRIMARY KEY,
  nav            REAL NOT NULL,
  units          REAL NOT NULL,
  nav_per_unit   REAL,
  cash           REAL NOT NULL,
  gross_exposure REAL NOT NULL,
  net_flow       REAL NOT NULL DEFAULT 0,
  by_sleeve      TEXT NOT NULL,
  by_metal       TEXT NOT NULL,
  computed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pf_audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action    TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  before    TEXT,
  after     TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pf_audit_entity ON pf_audit_log (entity, entity_id);

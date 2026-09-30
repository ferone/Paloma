-- Markets domain: one futures-curve snapshot per metal per day (the latest
-- fetch of that day wins). Builds a local history of carry vs rates, which no
-- free source provides.
CREATE TABLE markets_curve_daily (
  metal            TEXT NOT NULL,          -- gold | silver
  date             TEXT NOT NULL,          -- YYYY-MM-DD (UTC) of capture
  reference_symbol TEXT,
  reference_price  REAL,
  term_carry       REAL,                   -- fraction, annualized ACT/360
  rate             REAL,                   -- ^IRX, fraction
  shape            TEXT NOT NULL,
  contracts        TEXT NOT NULL,          -- JSON: [{symbol, expiry, price, openInterest, volume}]
  captured_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (metal, date)
);

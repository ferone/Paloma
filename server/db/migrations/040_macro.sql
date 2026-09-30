-- Macro and positioning data shared across domains (written by macro jobs, read by ml/overview).

-- Any dated scalar series (FRED ids like DFII10, or derived ids like GSR for gold/silver ratio).
CREATE TABLE macro_series (
  series_id TEXT NOT NULL,
  date      TEXT NOT NULL,
  value     REAL NOT NULL,
  source    TEXT NOT NULL,
  PRIMARY KEY (series_id, date)
);

-- CFTC disaggregated futures-only COT, one row per market per report (Tuesday) date.
CREATE TABLE cot_reports (
  market        TEXT NOT NULL,          -- GOLD, SILVER
  report_date   TEXT NOT NULL,          -- positions as of (Tuesday)
  published_at  TEXT,                   -- release timestamp (Friday 15:30 ET) for look-ahead safety
  open_interest REAL,
  prod_long REAL, prod_short REAL,
  swap_long REAL, swap_short REAL,
  mm_long REAL, mm_short REAL,
  other_long REAL, other_short REAL,
  nonrep_long REAL, nonrep_short REAL,
  PRIMARY KEY (market, report_date)
);

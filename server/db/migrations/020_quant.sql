-- Quant Lab engine output (written by the quant.recompute job, read by /api/quant).

-- One row per engine run.
CREATE TABLE quant_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at TEXT NOT NULL,
  data_through TEXT,
  instruments  INTEGER NOT NULL,
  duration_ms  INTEGER,
  summary      TEXT NOT NULL            -- JSON: engine info + counts
);

-- Latest analysis per instrument (replaced wholesale on every run).
CREATE TABLE quant_instruments (
  id          TEXT PRIMARY KEY,         -- e.g. GC.cal.0-1, SI.seas.Z-H, GS.ratio
  metal       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  run_id      INTEGER NOT NULL,
  detail      TEXT NOT NULL,            -- JSON InstrumentDetail (shared/quant.ts)
  seasonality TEXT NOT NULL             -- JSON SeasonalityDetail
);
CREATE INDEX idx_quant_instruments_metal ON quant_instruments (metal, kind);

-- Latest cross-instrument reports: opportunities, relative value, curves,
-- backtests and gate ablations (JSON, keyed by name).
CREATE TABLE quant_reports (
  name   TEXT PRIMARY KEY,              -- e.g. opportunities, relative-value, curve:GC, backtest:gold:conservative, gates:gold
  run_id INTEGER NOT NULL,
  data   TEXT NOT NULL
);

-- ML (Intelligence) domain: training runs with their walk-forward validation,
-- and the predictions scored from each run's saved model.

CREATE TABLE ml_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  metal             TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  params            TEXT,               -- JSON MlRunParams
  features_used     TEXT,               -- JSON string[]
  availability      TEXT,               -- JSON FeatureAvailability[]
  metrics           TEXT,               -- JSON MlMetrics (summary, per-year folds, permutation, gate)
  validation_status TEXT CHECK (validation_status IN ('passed', 'failed', 'untested')),
  auc               REAL,               -- mean walk-forward AUC (denormalized for lists)
  permutation_p     REAL,
  importance        TEXT,               -- JSON MlImportance[]
  calibration       TEXT,               -- JSON MlCalibrationBin[]
  model_path        TEXT,
  data_through      TEXT,
  trained_at        TEXT,
  error             TEXT
);
CREATE INDEX idx_ml_runs_metal ON ml_runs (metal, id);

CREATE TABLE ml_predictions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            INTEGER NOT NULL REFERENCES ml_runs (id) ON DELETE CASCADE,
  metal             TEXT NOT NULL CHECK (metal IN ('gold', 'silver')),
  instrument_id     TEXT NOT NULL,      -- 'GC.out' / 'SI.out'
  date              TEXT NOT NULL,      -- feature row scored
  horizon_days      INTEGER NOT NULL,
  p_up              REAL NOT NULL,
  p_up_low          REAL,
  p_up_high         REAL,
  expected_move     REAL NOT NULL,      -- fraction over the horizon
  lower             REAL,
  upper             REAL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed', 'failed', 'untested')),
  reasons           TEXT,               -- JSON string[]
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_ml_predictions_metal ON ml_predictions (metal, id);

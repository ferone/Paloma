-- AI analyst reports (macro briefs, trade briefs, portfolio commentary, Q&A).
-- request/response/sources/context are JSON text. Advisory only; never fed into scoring.
CREATE TABLE ai_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('macro_brief', 'trade_brief', 'portfolio_commentary', 'ask')),
  metal        TEXT NOT NULL,
  model        TEXT NOT NULL,
  prompt_hash  TEXT NOT NULL,
  request      TEXT NOT NULL,
  response     TEXT,
  sources      TEXT NOT NULL DEFAULT '[]',
  context      TEXT NOT NULL DEFAULT '[]',
  raw_text     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  as_of        TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error        TEXT,
  tokens       INTEGER,
  cost_usd     REAL,                      -- OpenRouter usage.cost (USD) when reported
  online       INTEGER NOT NULL DEFAULT 0,
  dropped_sources INTEGER NOT NULL DEFAULT 0,
  unsourced_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_reports_kind ON ai_reports (kind, metal, created_at);

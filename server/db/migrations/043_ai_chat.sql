-- Site-wide AI assistant: every user question and assistant answer, with the
-- route it was asked on, the context sent (JSON) and the OpenRouter cost.
-- Monthly spend for the assistant budget = SUM(cost_usd) here + ai_reports.
CREATE TABLE ai_chat_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL,
  route        TEXT,
  context_json TEXT,
  model        TEXT,
  tokens       INTEGER,
  cost_usd     REAL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_ai_chat_session ON ai_chat_messages (session_id, id);
CREATE INDEX idx_ai_chat_created ON ai_chat_messages (created_at);

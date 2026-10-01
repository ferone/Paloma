-- API keys entered in Settings, encrypted at rest with AES-256-GCM. The key
-- lives outside the DB in a machine-local file (data/secret.key by default), so
-- a copied database alone does not reveal the secrets. Only the last four
-- characters are kept in clear, for the masked display.
CREATE TABLE secrets (
  name        TEXT PRIMARY KEY,
  iv          TEXT NOT NULL,   -- base64, 12 bytes
  tag         TEXT NOT NULL,   -- base64, 16-byte GCM auth tag
  ciphertext  TEXT NOT NULL,   -- base64
  last4       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

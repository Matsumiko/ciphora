CREATE TABLE IF NOT EXISTS password_reset_email_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_email_tokens_email ON password_reset_email_tokens(email_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_email_tokens_user ON password_reset_email_tokens(user_id, expires_at);

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0006_ops_email_delivery');

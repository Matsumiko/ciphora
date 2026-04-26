CREATE TABLE IF NOT EXISTS opaque_login_challenges (
  challenge_id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  server_login_state TEXT NOT NULL,
  credential_fingerprint TEXT,
  is_fake INTEGER NOT NULL DEFAULT 0 CHECK (is_fake IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_opaque_login_challenges_email ON opaque_login_challenges(email_hash, expires_at);

CREATE TABLE IF NOT EXISTS opaque_credential_epochs (
  user_id TEXT PRIMARY KEY,
  credential_fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS opaque_credential_revocations (
  user_id TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reason TEXT NOT NULL DEFAULT 'password_change',
  PRIMARY KEY (user_id, credential_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_opaque_credential_revocations_user ON opaque_credential_revocations(user_id, revoked_at);

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0005_ops_opaque_auth');

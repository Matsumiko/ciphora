CREATE TABLE IF NOT EXISTS opaque_credential_revocations (
  user_id TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reason TEXT NOT NULL DEFAULT 'password_change',
  PRIMARY KEY (user_id, credential_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_opaque_credential_revocations_user ON opaque_credential_revocations(user_id, revoked_at);

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0013_ops_opaque_credential_revocations');

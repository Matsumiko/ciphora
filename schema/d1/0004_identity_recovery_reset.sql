CREATE TABLE IF NOT EXISTS recovery_verifiers (
  user_id TEXT PRIMARY KEY,
  verifier_version TEXT NOT NULL,
  verifier_algorithm TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO identity_schema_migrations (version) VALUES ('0004_identity_recovery_reset');

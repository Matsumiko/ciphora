CREATE TABLE IF NOT EXISTS opaque_credential_epochs (
  user_id TEXT PRIMARY KEY,
  credential_fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0012_ops_opaque_credential_epochs');

CREATE TABLE IF NOT EXISTS opaque_credentials (
  user_id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  user_identifier_hash TEXT NOT NULL,
  registration_record TEXT NOT NULL,
  server_public_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_opaque_credentials_identifier ON opaque_credentials(user_identifier_hash);

INSERT OR IGNORE INTO identity_schema_migrations (version) VALUES ('0005_identity_opaque_auth');

ALTER TABLE devices ADD COLUMN trusted_at TEXT;

ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

ALTER TABLE sessions ADD COLUMN revoked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at);

INSERT OR IGNORE INTO identity_schema_migrations (version) VALUES ('0010_identity_device_session_management');

CREATE TABLE IF NOT EXISTS ops_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  challenge_id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_email ON email_verification_challenges(email_hash, expires_at);

CREATE TABLE IF NOT EXISTS password_reset_challenges (
  challenge_id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_challenges_email ON password_reset_challenges(email_hash, expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  bucket_scope TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_expires ON rate_limit_buckets(expires_at);

CREATE TABLE IF NOT EXISTS job_outbox (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead')),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_job_outbox_status_next ON job_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS short_audit_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archive_after_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_short_audit_events_created ON short_audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_short_audit_events_archive_after ON short_audit_events(archive_after_at);

CREATE TABLE IF NOT EXISTS provider_health_checks (
  check_id TEXT PRIMARY KEY,
  user_id TEXT,
  profile_id TEXT,
  provider_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'failed')),
  latency_ms INTEGER,
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_health_checks_profile_checked ON provider_health_checks(profile_id, checked_at);

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0003_ops_runtime');

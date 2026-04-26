CREATE TABLE IF NOT EXISTS archive_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_archive (
  archive_id TEXT PRIMARY KEY,
  source_event_id TEXT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata_json TEXT,
  source_created_at TEXT,
  archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_archive_user_archived ON audit_archive(user_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_audit_archive_event_type ON audit_archive(event_type, archived_at);

CREATE TABLE IF NOT EXISTS email_delivery_archive (
  delivery_id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT,
  template_key TEXT NOT NULL,
  provider_message_id TEXT,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('queued', 'sent', 'bounced', 'complained', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_archive_email ON email_delivery_archive(email_hash, created_at);

CREATE TABLE IF NOT EXISTS ops_metrics_daily (
  metric_date TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (metric_date, metric_key)
);

CREATE TABLE IF NOT EXISTS privacy_safe_usage_daily (
  usage_date TEXT NOT NULL,
  usage_key TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (usage_date, usage_key)
);

CREATE TABLE IF NOT EXISTS incident_notes (
  note_id TEXT PRIMARY KEY,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT
);

INSERT OR IGNORE INTO archive_schema_migrations (version) VALUES ('0001_archive');

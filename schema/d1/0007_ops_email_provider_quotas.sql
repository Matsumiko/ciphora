CREATE TABLE IF NOT EXISTS email_provider_daily_quotas (
  provider TEXT NOT NULL CHECK (provider IN ('brevo', 'resend')),
  quota_day TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  daily_limit INTEGER NOT NULL CHECK (daily_limit >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (provider, quota_day)
);

CREATE INDEX IF NOT EXISTS idx_email_provider_daily_quotas_day ON email_provider_daily_quotas(quota_day);

INSERT OR IGNORE INTO ops_schema_migrations (version) VALUES ('0007_ops_email_provider_quotas');

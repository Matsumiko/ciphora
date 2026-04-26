CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_records (
  record_id TEXT PRIMARY KEY,
  record_kind TEXT NOT NULL CHECK (record_kind = 'vault_item'),
  algorithm TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_records_updated_at
  ON vault_records(updated_at);

CREATE INDEX IF NOT EXISTS idx_vault_records_deleted_at
  ON vault_records(deleted_at);

CREATE TABLE IF NOT EXISTS vault_record_versions (
  version_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  algorithm TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_record_versions_record_version
  ON vault_record_versions(record_id, version DESC);

CREATE TABLE IF NOT EXISTS vault_tombstones (
  record_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  content_hash TEXT NOT NULL,
  source_device_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_tombstones_deleted_at
  ON vault_tombstones(deleted_at);

CREATE TABLE IF NOT EXISTS sync_cursors (
  cursor_name TEXT PRIMARY KEY,
  cursor_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_devices (
  device_id TEXT PRIMARY KEY,
  device_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_journal (
  event_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'pull', 'conflict', 'resolve')),
  base_version INTEGER,
  result_version INTEGER,
  base_content_hash TEXT,
  result_content_hash TEXT,
  remote_updated_at TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'skipped', 'conflict', 'resolved')),
  conflict_id TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_journal_created
  ON sync_journal(created_at, event_id);

CREATE INDEX IF NOT EXISTS idx_sync_journal_record_created
  ON sync_journal(record_id, created_at);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  local_content_hash TEXT NOT NULL,
  remote_content_hash TEXT NOT NULL,
  local_version INTEGER,
  remote_version INTEGER,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IN ('keep_local', 'keep_remote', 'keep_both', 'manual_edit'))
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_profile_unresolved
  ON sync_conflicts(provider_profile_id, resolved_at, detected_at);

CREATE TABLE IF NOT EXISTS sync_device_cursors (
  device_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  last_seen_remote_updated_at TEXT,
  last_seen_journal_created_at TEXT,
  last_seen_journal_event_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, provider_profile_id)
);

INSERT OR IGNORE INTO schema_migrations (migration_name, applied_at)
VALUES ('ciphora_d1_user_vault_v1', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO schema_migrations (migration_name, applied_at)
VALUES ('ciphora_d1_user_vault_v2_sync_journal', CURRENT_TIMESTAMP);

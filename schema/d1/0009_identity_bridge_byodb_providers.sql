DROP TABLE IF EXISTS sync_profiles_next;

CREATE TABLE sync_profiles_next (
  profile_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('external_turso', 'external_d1_bridge', 'external_d1_direct', 'external_tidb_bridge', 'external_cockroach_bridge', 'external_aiven_bridge', 'external_supabase_bridge', 'external_mongodb_bridge', 'external_firestore_bridge')),
  provider_hint TEXT,
  label_hint TEXT,
  algorithm TEXT NOT NULL,
  iv TEXT NOT NULL,
  encrypted_config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'rotating', 'error')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  disabled_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT INTO sync_profiles_next (
  profile_id,
  user_id,
  provider_type,
  provider_hint,
  label_hint,
  algorithm,
  iv,
  encrypted_config,
  status,
  created_at,
  updated_at,
  disabled_at
)
SELECT
  profile_id,
  user_id,
  provider_type,
  provider_hint,
  label_hint,
  algorithm,
  iv,
  encrypted_config,
  status,
  created_at,
  updated_at,
  disabled_at
FROM sync_profiles;

DROP TABLE sync_profiles;

ALTER TABLE sync_profiles_next RENAME TO sync_profiles;

CREATE INDEX IF NOT EXISTS idx_sync_profiles_user_status ON sync_profiles(user_id, status);

INSERT OR IGNORE INTO identity_schema_migrations (version) VALUES ('0009_identity_bridge_byodb_providers');

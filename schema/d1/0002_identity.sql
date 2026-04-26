CREATE TABLE IF NOT EXISTS identity_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  primary_email_hash TEXT NOT NULL UNIQUE,
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'pending', 'locked', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_verifiers (
  user_id TEXT PRIMARY KEY,
  verifier_version TEXT NOT NULL,
  verifier_algorithm TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_kdf_params (
  user_id TEXT PRIMARY KEY,
  kdf_algorithm TEXT NOT NULL,
  iterations INTEGER,
  memory_cost INTEGER,
  parallelism INTEGER,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS root_key_wrappers (
  wrapper_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wrapper_type TEXT NOT NULL CHECK (wrapper_type IN ('password', 'recovery')),
  kdf_algorithm TEXT NOT NULL,
  kdf_params_json TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_root_key_wrappers_user_type ON root_key_wrappers(user_id, wrapper_type);

CREATE TABLE IF NOT EXISTS sync_profiles (
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

CREATE INDEX IF NOT EXISTS idx_sync_profiles_user_status ON sync_profiles(user_id, status);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_label TEXT,
  device_public_key TEXT,
  trusted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_user_active ON devices(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  session_token_hash TEXT NOT NULL UNIQUE,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS recovery_metadata (
  user_id TEXT PRIMARY KEY,
  recovery_enabled INTEGER NOT NULL DEFAULT 0 CHECK (recovery_enabled IN (0, 1)),
  recovery_key_hint TEXT,
  recovery_wrapper_id TEXT,
  last_rotated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_severity TEXT NOT NULL DEFAULT 'info' CHECK (event_severity IN ('info', 'warning', 'critical')),
  ip_hash TEXT,
  user_agent_hash TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_events_user_created ON account_events(user_id, created_at);

INSERT OR IGNORE INTO identity_schema_migrations (version) VALUES ('0002_identity');

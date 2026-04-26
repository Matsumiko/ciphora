CREATE TABLE IF NOT EXISTS directory_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS directory_users (
  email_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  shard_id INTEGER NOT NULL CHECK (shard_id BETWEEN 0 AND 7),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'pending', 'locked', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_directory_users_user_id ON directory_users(user_id);
CREATE INDEX IF NOT EXISTS idx_directory_users_shard_status ON directory_users(shard_id, account_status);

CREATE TABLE IF NOT EXISTS directory_email_aliases (
  alias_email_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_directory_email_aliases_user_id ON directory_email_aliases(user_id);

CREATE TABLE IF NOT EXISTS directory_shard_health (
  shard_id INTEGER PRIMARY KEY CHECK (shard_id BETWEEN 0 AND 7),
  binding_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'degraded', 'offline', 'migrating')),
  capacity_weight INTEGER NOT NULL DEFAULT 100,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO directory_shard_health (shard_id, binding_name) VALUES
  (0, 'CIPHORA_IDENTITY_00'),
  (1, 'CIPHORA_IDENTITY_01'),
  (2, 'CIPHORA_IDENTITY_02'),
  (3, 'CIPHORA_IDENTITY_03'),
  (4, 'CIPHORA_IDENTITY_04'),
  (5, 'CIPHORA_IDENTITY_05'),
  (6, 'CIPHORA_IDENTITY_06'),
  (7, 'CIPHORA_IDENTITY_07');

CREATE TABLE IF NOT EXISTS directory_migrations (
  migration_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_shard_id INTEGER NOT NULL,
  to_shard_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'copying', 'verifying', 'switched', 'rolled_back', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO directory_schema_migrations (version) VALUES ('0001_directory');

import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const MIGRATION_NAME = "ciphora_http_bridge_user_vault_v2_sync_journal";
const MAX_BATCH_ITEMS = 2000;
const MAX_CONFLICTS = 500;
const MAX_RESOLVED_CONFLICTS = 500;
const MAX_JOURNAL_EVENTS = 4000;
const MAX_RECORD_FIELD_LENGTH = 262144;
const MAX_METADATA_FIELD_LENGTH = 2048;
const MAX_RECORD_VERSIONS = 8;
const DEFAULT_PORT = 8977;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://ciphora.pages.dev",
  "https://app.ciphora.indevs.in",
]);
const DEFAULT_ALLOWED_SUFFIXES = [".ciphora.pages.dev"];

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function getEnv(name, required = true) {
  const value = process.env[name]?.trim();
  if (!value && required) {
    throw new Error(`missing_env_${name.toLowerCase()}`);
  }
  return value ?? "";
}

function getConfiguredOriginPatterns() {
  return (process.env.CIPHORA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (DEFAULT_ALLOWED_ORIGINS.has(parsed.origin)) return true;
  if (DEFAULT_ALLOWED_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix))) return true;
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") return true;

  for (const pattern of getConfiguredOriginPatterns()) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1).toLowerCase();
      if (parsed.hostname.toLowerCase().endsWith(suffix)) return true;
      continue;
    }
    if (parsed.origin === pattern) return true;
  }

  return false;
}

function corsHeaders(req) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, accept",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
  };

  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function sendJson(req, res, status, body) {
  res.writeHead(status, {
    ...corsHeaders(req),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(status === 204 ? "" : JSON.stringify(body));
}

function readBearerToken(req) {
  const value = req.headers.authorization;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() ?? null;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureAuthorized(req) {
  const expected = getEnv("CIPHORA_BRIDGE_TOKEN");
  if (expected.length < 16) throw new HttpError(503, "bridge_not_configured");
  const bearer = readBearerToken(req);
  if (!bearer || !safeEqual(bearer, expected)) throw new HttpError(401, "unauthorized");
}

function requireMethod(req, expected) {
  if (req.method !== expected) throw new HttpError(405, "method_not_allowed");
}

async function readJsonBody(req) {
  const maxBytes = Number(process.env.CIPHORA_MAX_BODY_BYTES ?? 2_500_000);
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "payload_too_large");
    chunks.push(chunk);
  }

  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function expectObject(value, errorCode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, errorCode);
  }
  return value;
}

function expectString(value, errorCode, maxLength = 256) {
  if (typeof value !== "string") throw new HttpError(400, errorCode);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new HttpError(400, errorCode);
  return trimmed;
}

function expectOptionalString(value, errorCode, maxLength = 256) {
  if (value === null || value === undefined) return null;
  return expectString(value, errorCode, maxLength);
}

function expectVersion(value, errorCode) {
  const version = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(version) || version < 1) throw new HttpError(400, errorCode);
  return version;
}

function expectOptionalVersion(value, errorCode) {
  if (value === null || value === undefined) return null;
  return expectVersion(value, errorCode);
}

function expectArray(value, errorCode, maxLength = MAX_BATCH_ITEMS) {
  if (!Array.isArray(value) || value.length > maxLength) throw new HttpError(400, errorCode);
  return value;
}

function expectEnum(value, allowed, errorCode) {
  const text = expectString(value, errorCode, 64);
  if (!allowed.includes(text)) throw new HttpError(400, errorCode);
  return text;
}

function normalizePushPayload(body) {
  const payload = expectObject(body, "invalid_sync_push_payload");
  const device = expectObject(payload.device, "invalid_bridge_device");
  const cursor = expectObject(payload.cursor, "invalid_bridge_cursor");

  return {
    device: {
      deviceId: expectString(device.deviceId, "invalid_bridge_device_id", 96),
      deviceLabel: expectString(device.deviceLabel, "invalid_bridge_device_label", 120),
      checkedAt: expectString(device.checkedAt, "invalid_bridge_checked_at", 64),
    },
    records: expectArray(payload.records ?? [], "invalid_bridge_records").map((entry) => {
      const record = expectObject(entry, "invalid_bridge_record");
      return {
        recordId: expectString(record.recordId, "invalid_bridge_record_id", 128),
        recordKind: expectString(record.recordKind, "invalid_bridge_record_kind", 32),
        algorithm: expectString(record.algorithm, "invalid_bridge_algorithm", 32),
        iv: expectString(record.iv, "invalid_bridge_iv", 256),
        ciphertext: expectString(record.ciphertext, "invalid_bridge_ciphertext", MAX_RECORD_FIELD_LENGTH),
        contentHash: expectString(record.contentHash, "invalid_bridge_content_hash", 256),
        version: expectVersion(record.version, "invalid_bridge_version"),
        createdAt: expectString(record.createdAt, "invalid_bridge_created_at", 64),
        updatedAt: expectString(record.updatedAt, "invalid_bridge_updated_at", 64),
      };
    }),
    tombstones: expectArray(payload.tombstones ?? [], "invalid_bridge_tombstones").map((entry) => {
      const tombstone = expectObject(entry, "invalid_bridge_tombstone");
      return {
        recordId: expectString(tombstone.recordId, "invalid_bridge_record_id", 128),
        deletedAt: expectString(tombstone.deletedAt, "invalid_bridge_deleted_at", 64),
        version: expectVersion(tombstone.version, "invalid_bridge_version"),
        contentHash: expectString(tombstone.contentHash, "invalid_bridge_content_hash", 256),
        sourceDeviceId: expectString(tombstone.sourceDeviceId, "invalid_bridge_source_device_id", 96),
      };
    }),
    deleteTombstonesForRecordIds: expectArray(payload.deleteTombstonesForRecordIds ?? [], "invalid_bridge_delete_tombstones")
      .map((entry) => expectString(entry, "invalid_bridge_delete_tombstone_record_id", 128)),
    conflicts: expectArray(payload.conflicts ?? [], "invalid_bridge_conflicts", MAX_CONFLICTS).map((entry) => {
      const conflict = expectObject(entry, "invalid_bridge_conflict");
      return {
        conflictId: expectString(conflict.conflictId, "invalid_bridge_conflict_id", 128),
        recordId: expectString(conflict.recordId, "invalid_bridge_conflict_record_id", 128),
        providerProfileId: expectString(conflict.providerProfileId, "invalid_bridge_conflict_profile_id", 128),
        localContentHash: expectString(conflict.localContentHash, "invalid_bridge_conflict_local_hash", 256),
        remoteContentHash: expectString(conflict.remoteContentHash, "invalid_bridge_conflict_remote_hash", 256),
        localVersion: expectOptionalVersion(conflict.localVersion, "invalid_bridge_conflict_local_version"),
        remoteVersion: expectOptionalVersion(conflict.remoteVersion, "invalid_bridge_conflict_remote_version"),
        detectedAt: expectString(conflict.detectedAt, "invalid_bridge_conflict_detected_at", 64),
      };
    }),
    resolvedConflicts: expectArray(payload.resolvedConflicts ?? [], "invalid_bridge_resolved_conflicts", MAX_RESOLVED_CONFLICTS)
      .map((entry) => {
        const conflict = expectObject(entry, "invalid_bridge_resolved_conflict");
        return {
          conflictId: expectString(conflict.conflictId, "invalid_bridge_resolved_conflict_id", 128),
          providerProfileId: expectString(conflict.providerProfileId, "invalid_bridge_resolved_conflict_profile_id", 128),
          resolvedAt: expectString(conflict.resolvedAt, "invalid_bridge_resolved_at", 64),
          resolution: expectEnum(conflict.resolution, ["keep_local", "keep_remote", "keep_both", "manual_edit"], "invalid_bridge_resolution"),
        };
      }),
    journalEvents: expectArray(payload.journalEvents ?? [], "invalid_bridge_journal_events", MAX_JOURNAL_EVENTS).map((entry) => {
      const event = expectObject(entry, "invalid_bridge_journal_event");
      return {
        eventId: expectString(event.eventId, "invalid_bridge_journal_event_id", 128),
        recordId: expectString(event.recordId, "invalid_bridge_journal_record_id", 128),
        providerProfileId: expectString(event.providerProfileId, "invalid_bridge_journal_profile_id", 128),
        sourceDeviceId: expectString(event.sourceDeviceId, "invalid_bridge_journal_source_device_id", 96),
        operation: expectEnum(event.operation, ["upsert", "delete", "pull", "conflict", "resolve"], "invalid_bridge_journal_operation"),
        baseVersion: expectOptionalVersion(event.baseVersion, "invalid_bridge_journal_base_version"),
        resultVersion: expectOptionalVersion(event.resultVersion, "invalid_bridge_journal_result_version"),
        baseContentHash: expectOptionalString(event.baseContentHash, "invalid_bridge_journal_base_hash", 256),
        resultContentHash: expectOptionalString(event.resultContentHash, "invalid_bridge_journal_result_hash", 256),
        remoteUpdatedAt: expectOptionalString(event.remoteUpdatedAt, "invalid_bridge_journal_remote_updated_at", 64),
        createdAt: expectString(event.createdAt, "invalid_bridge_journal_created_at", 64),
        status: expectEnum(event.status, ["applied", "skipped", "conflict", "resolved"], "invalid_bridge_journal_status"),
        conflictId: expectOptionalString(event.conflictId, "invalid_bridge_journal_conflict_id", 128),
        metadataJson: expectOptionalString(event.metadataJson, "invalid_bridge_journal_metadata", MAX_METADATA_FIELD_LENGTH),
      };
    }),
    cursor: {
      name: expectString(cursor.name, "invalid_bridge_cursor_name", 64),
      value: expectString(cursor.value, "invalid_bridge_cursor_value", MAX_RECORD_FIELD_LENGTH),
      updatedAt: expectString(cursor.updatedAt, "invalid_bridge_cursor_updated_at", 64),
    },
  };
}

function serializeRemoteRecord(row) {
  return {
    recordId: String(row.recordId ?? row.record_id ?? row._id ?? ""),
    algorithm: String(row.algorithm ?? ""),
    iv: String(row.iv ?? ""),
    ciphertext: String(row.ciphertext ?? ""),
    contentHash: String(row.contentHash ?? row.content_hash ?? ""),
    version: Number(row.version ?? 0),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? ""),
    deletedAt: row.deletedAt === null || row.deletedAt === undefined
      ? (row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at))
      : String(row.deletedAt),
  };
}

function getReportedProviderType(adapter) {
  const configured = process.env.CIPHORA_BRIDGE_PROVIDER_TYPE?.trim();
  if (configured) return configured;
  if (adapter.provider === "postgres") return "external_cockroach_bridge";
  if (adapter.provider === "mysql") return "external_tidb_bridge";
  if (adapter.provider === "mongodb") return "external_mongodb_bridge";
  if (adapter.provider === "firestore") return "external_firestore_bridge";
  return "external_d1_bridge";
}

const POSTGRES_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (migration_name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS vault_records (record_id TEXT PRIMARY KEY, record_kind TEXT NOT NULL, algorithm TEXT NOT NULL, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, content_hash TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_vault_records_updated_at ON vault_records(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_vault_records_deleted_at ON vault_records(deleted_at)",
  "CREATE TABLE IF NOT EXISTS vault_record_versions (version_id TEXT PRIMARY KEY, record_id TEXT NOT NULL, version INTEGER NOT NULL, algorithm TEXT NOT NULL, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_vault_record_versions_record_version ON vault_record_versions(record_id, version DESC)",
  "CREATE TABLE IF NOT EXISTS vault_tombstones (record_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, version INTEGER NOT NULL, content_hash TEXT NOT NULL, source_device_id TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_vault_tombstones_deleted_at ON vault_tombstones(deleted_at)",
  "CREATE TABLE IF NOT EXISTS sync_cursors (cursor_name TEXT PRIMARY KEY, cursor_value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS provider_devices (device_id TEXT PRIMARY KEY, device_label TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sync_journal (event_id TEXT PRIMARY KEY, record_id TEXT NOT NULL, provider_profile_id TEXT NOT NULL, source_device_id TEXT NOT NULL, operation TEXT NOT NULL, base_version INTEGER, result_version INTEGER, base_content_hash TEXT, result_content_hash TEXT, remote_updated_at TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, conflict_id TEXT, metadata_json TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_sync_journal_created ON sync_journal(created_at, event_id)",
  "CREATE INDEX IF NOT EXISTS idx_sync_journal_record_created ON sync_journal(record_id, created_at)",
  "CREATE TABLE IF NOT EXISTS sync_conflicts (conflict_id TEXT PRIMARY KEY, record_id TEXT NOT NULL, provider_profile_id TEXT NOT NULL, local_content_hash TEXT NOT NULL, remote_content_hash TEXT NOT NULL, local_version INTEGER, remote_version INTEGER, detected_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT)",
  "CREATE INDEX IF NOT EXISTS idx_sync_conflicts_profile_unresolved ON sync_conflicts(provider_profile_id, resolved_at, detected_at)",
  "CREATE TABLE IF NOT EXISTS sync_device_cursors (device_id TEXT NOT NULL, provider_profile_id TEXT NOT NULL, last_seen_remote_updated_at TEXT, last_seen_journal_created_at TEXT, last_seen_journal_event_id TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (device_id, provider_profile_id))",
  "INSERT INTO schema_migrations (migration_name, applied_at) VALUES ($1, $2) ON CONFLICT(migration_name) DO NOTHING",
];

const MYSQL_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (migration_name VARCHAR(128) PRIMARY KEY, applied_at VARCHAR(64) NOT NULL)",
  "CREATE TABLE IF NOT EXISTS vault_records (record_id VARCHAR(128) PRIMARY KEY, record_kind VARCHAR(32) NOT NULL, algorithm VARCHAR(32) NOT NULL, iv VARCHAR(256) NOT NULL, ciphertext LONGTEXT NOT NULL, content_hash VARCHAR(256) NOT NULL, version INT NOT NULL, created_at VARCHAR(64) NOT NULL, updated_at VARCHAR(64) NOT NULL, deleted_at VARCHAR(64) NULL)",
  "CREATE INDEX idx_vault_records_updated_at ON vault_records(updated_at)",
  "CREATE INDEX idx_vault_records_deleted_at ON vault_records(deleted_at)",
  "CREATE TABLE IF NOT EXISTS vault_record_versions (version_id VARCHAR(160) PRIMARY KEY, record_id VARCHAR(128) NOT NULL, version INT NOT NULL, algorithm VARCHAR(32) NOT NULL, iv VARCHAR(256) NOT NULL, ciphertext LONGTEXT NOT NULL, content_hash VARCHAR(256) NOT NULL, created_at VARCHAR(64) NOT NULL)",
  "CREATE INDEX idx_vault_record_versions_record_version ON vault_record_versions(record_id, version DESC)",
  "CREATE TABLE IF NOT EXISTS vault_tombstones (record_id VARCHAR(128) PRIMARY KEY, deleted_at VARCHAR(64) NOT NULL, version INT NOT NULL, content_hash VARCHAR(256) NOT NULL, source_device_id VARCHAR(96))",
  "CREATE INDEX idx_vault_tombstones_deleted_at ON vault_tombstones(deleted_at)",
  "CREATE TABLE IF NOT EXISTS sync_cursors (cursor_name VARCHAR(64) PRIMARY KEY, cursor_value LONGTEXT NOT NULL, updated_at VARCHAR(64) NOT NULL)",
  "CREATE TABLE IF NOT EXISTS provider_devices (device_id VARCHAR(96) PRIMARY KEY, device_label VARCHAR(120) NOT NULL, created_at VARCHAR(64) NOT NULL, last_seen_at VARCHAR(64) NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sync_journal (event_id VARCHAR(128) PRIMARY KEY, record_id VARCHAR(128) NOT NULL, provider_profile_id VARCHAR(128) NOT NULL, source_device_id VARCHAR(96) NOT NULL, operation VARCHAR(32) NOT NULL, base_version INT NULL, result_version INT NULL, base_content_hash VARCHAR(256) NULL, result_content_hash VARCHAR(256) NULL, remote_updated_at VARCHAR(64) NULL, created_at VARCHAR(64) NOT NULL, status VARCHAR(32) NOT NULL, conflict_id VARCHAR(128) NULL, metadata_json TEXT NULL)",
  "CREATE INDEX idx_sync_journal_created ON sync_journal(created_at, event_id)",
  "CREATE INDEX idx_sync_journal_record_created ON sync_journal(record_id, created_at)",
  "CREATE TABLE IF NOT EXISTS sync_conflicts (conflict_id VARCHAR(128) PRIMARY KEY, record_id VARCHAR(128) NOT NULL, provider_profile_id VARCHAR(128) NOT NULL, local_content_hash VARCHAR(256) NOT NULL, remote_content_hash VARCHAR(256) NOT NULL, local_version INT NULL, remote_version INT NULL, detected_at VARCHAR(64) NOT NULL, resolved_at VARCHAR(64) NULL, resolution VARCHAR(32) NULL)",
  "CREATE INDEX idx_sync_conflicts_profile_unresolved ON sync_conflicts(provider_profile_id, resolved_at, detected_at)",
  "CREATE TABLE IF NOT EXISTS sync_device_cursors (device_id VARCHAR(96) NOT NULL, provider_profile_id VARCHAR(128) NOT NULL, last_seen_remote_updated_at VARCHAR(64) NULL, last_seen_journal_created_at VARCHAR(64) NULL, last_seen_journal_event_id VARCHAR(128) NULL, updated_at VARCHAR(64) NOT NULL, PRIMARY KEY (device_id, provider_profile_id))",
  "INSERT IGNORE INTO schema_migrations (migration_name, applied_at) VALUES (?, ?)",
];

class PostgresAdapter {
  constructor(pool) {
    this.pool = pool;
    this.provider = "postgres";
  }

  static async create() {
    const { Pool } = await import("pg");
    return new PostgresAdapter(new Pool({
      connectionString: getEnv("DATABASE_URL"),
      max: Number(process.env.DATABASE_POOL_SIZE ?? 4),
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
    }));
  }

  async ensureSchema() {
    for (const statement of POSTGRES_SCHEMA) {
      const params = statement.includes("$1") ? [MIGRATION_NAME, nowIso()] : [];
      await this.pool.query(statement, params);
    }
  }

  async schemaReady() {
    const result = await this.pool.query("SELECT migration_name FROM schema_migrations WHERE migration_name = $1 LIMIT 1", [MIGRATION_NAME]).catch(() => ({ rows: [] }));
    return !!result.rows?.[0]?.migration_name;
  }

  async listRecords() {
    const result = await this.pool.query(`
      SELECT record_id AS "recordId", algorithm, iv, ciphertext, content_hash AS "contentHash",
        version, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
      FROM vault_records
      ORDER BY record_id ASC
    `);
    return result.rows.map(serializeRemoteRecord);
  }

  async applyPush(payload) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applySqlPush(client, payload, "postgres");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

class MySqlAdapter {
  constructor(pool) {
    this.pool = pool;
    this.provider = "mysql";
  }

  static async create() {
    const mysql = await import("mysql2/promise");
    return new MySqlAdapter(mysql.createPool(getEnv("DATABASE_URL")));
  }

  async ensureSchema() {
    for (const statement of MYSQL_SCHEMA) {
      const params = statement.includes("?") ? [MIGRATION_NAME, nowIso()] : [];
      await this.pool.execute(statement, params).catch((error) => {
        if (String(error?.message ?? "").includes("Duplicate key name")) return undefined;
        throw error;
      });
    }
  }

  async schemaReady() {
    try {
      const [rows] = await this.pool.execute("SELECT migration_name FROM schema_migrations WHERE migration_name = ? LIMIT 1", [MIGRATION_NAME]);
      return !!rows?.[0]?.migration_name;
    } catch {
      return false;
    }
  }

  async listRecords() {
    const [rows] = await this.pool.execute(`
      SELECT record_id AS recordId, algorithm, iv, ciphertext, content_hash AS contentHash,
        version, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM vault_records
      ORDER BY record_id ASC
    `);
    return rows.map(serializeRemoteRecord);
  }

  async applyPush(payload) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await applySqlPush(connection, payload, "mysql");
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

async function sqlExec(client, dialect, sql, params = []) {
  if (dialect === "postgres") return client.query(sql, params);
  return client.execute(sql, params);
}

async function applySqlPush(client, payload, dialect) {
  const placeholder = dialect === "postgres" ? (index) => `$${index}` : () => "?";
  const q = (postgresSql, mysqlSql, params) => sqlExec(client, dialect, dialect === "postgres" ? postgresSql : mysqlSql, params);

  await q(
    "INSERT INTO provider_devices (device_id, device_label, created_at, last_seen_at) VALUES ($1, $2, $3, $4) ON CONFLICT(device_id) DO UPDATE SET device_label = excluded.device_label, last_seen_at = excluded.last_seen_at",
    "INSERT INTO provider_devices (device_id, device_label, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE device_label = VALUES(device_label), last_seen_at = VALUES(last_seen_at)",
    [payload.device.deviceId, payload.device.deviceLabel, payload.device.checkedAt, payload.device.checkedAt],
  );

  for (const record of payload.records) {
    await q(
      "INSERT INTO vault_records (record_id, record_kind, algorithm, iv, ciphertext, content_hash, version, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL) ON CONFLICT(record_id) DO UPDATE SET record_kind = excluded.record_kind, algorithm = excluded.algorithm, iv = excluded.iv, ciphertext = excluded.ciphertext, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at, deleted_at = NULL",
      "INSERT INTO vault_records (record_id, record_kind, algorithm, iv, ciphertext, content_hash, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE record_kind = VALUES(record_kind), algorithm = VALUES(algorithm), iv = VALUES(iv), ciphertext = VALUES(ciphertext), content_hash = VALUES(content_hash), version = VALUES(version), updated_at = VALUES(updated_at), deleted_at = NULL",
      [record.recordId, record.recordKind, record.algorithm, record.iv, record.ciphertext, record.contentHash, record.version, record.createdAt, record.updatedAt],
    );
    await q(
      "INSERT INTO vault_record_versions (version_id, record_id, version, algorithm, iv, ciphertext, content_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(version_id) DO NOTHING",
      "INSERT IGNORE INTO vault_record_versions (version_id, record_id, version, algorithm, iv, ciphertext, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [`${record.recordId}:${record.version}`, record.recordId, record.version, record.algorithm, record.iv, record.ciphertext, record.contentHash, record.updatedAt],
    );
    await q(
      "DELETE FROM vault_record_versions WHERE record_id = $1 AND version_id NOT IN (SELECT version_id FROM vault_record_versions WHERE record_id = $2 ORDER BY version DESC LIMIT $3)",
      "DELETE FROM vault_record_versions WHERE record_id = ? AND version_id NOT IN (SELECT version_id FROM (SELECT version_id FROM vault_record_versions WHERE record_id = ? ORDER BY version DESC LIMIT ?) keep_versions)",
      [record.recordId, record.recordId, MAX_RECORD_VERSIONS],
    );
  }

  for (const recordId of payload.deleteTombstonesForRecordIds) {
    await q("DELETE FROM vault_tombstones WHERE record_id = $1", "DELETE FROM vault_tombstones WHERE record_id = ?", [recordId]);
  }

  for (const tombstone of payload.tombstones) {
    await q(
      "UPDATE vault_records SET version = $1, updated_at = $2, deleted_at = $3 WHERE record_id = $4",
      "UPDATE vault_records SET version = ?, updated_at = ?, deleted_at = ? WHERE record_id = ?",
      [tombstone.version, tombstone.deletedAt, tombstone.deletedAt, tombstone.recordId],
    );
    await q(
      "INSERT INTO vault_tombstones (record_id, deleted_at, version, content_hash, source_device_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(record_id) DO UPDATE SET deleted_at = excluded.deleted_at, version = excluded.version, content_hash = excluded.content_hash, source_device_id = excluded.source_device_id",
      "INSERT INTO vault_tombstones (record_id, deleted_at, version, content_hash, source_device_id) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE deleted_at = VALUES(deleted_at), version = VALUES(version), content_hash = VALUES(content_hash), source_device_id = VALUES(source_device_id)",
      [tombstone.recordId, tombstone.deletedAt, tombstone.version, tombstone.contentHash, tombstone.sourceDeviceId],
    );
  }

  for (const conflict of payload.conflicts) {
    await q(
      "INSERT INTO sync_conflicts (conflict_id, record_id, provider_profile_id, local_content_hash, remote_content_hash, local_version, remote_version, detected_at, resolved_at, resolution) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL) ON CONFLICT(conflict_id) DO NOTHING",
      "INSERT IGNORE INTO sync_conflicts (conflict_id, record_id, provider_profile_id, local_content_hash, remote_content_hash, local_version, remote_version, detected_at, resolved_at, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
      [conflict.conflictId, conflict.recordId, conflict.providerProfileId, conflict.localContentHash, conflict.remoteContentHash, conflict.localVersion, conflict.remoteVersion, conflict.detectedAt],
    );
  }

  for (const conflict of payload.resolvedConflicts) {
    await q(
      "UPDATE sync_conflicts SET resolved_at = $1, resolution = $2 WHERE conflict_id = $3 AND provider_profile_id = $4",
      "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
      [conflict.resolvedAt, conflict.resolution, conflict.conflictId, conflict.providerProfileId],
    );
  }

  await q(
    "INSERT INTO sync_cursors (cursor_name, cursor_value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(cursor_name) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = excluded.updated_at",
    "INSERT INTO sync_cursors (cursor_name, cursor_value, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE cursor_value = VALUES(cursor_value), updated_at = VALUES(updated_at)",
    [payload.cursor.name, payload.cursor.value, payload.cursor.updatedAt],
  );

  for (const event of payload.journalEvents) {
    await q(
      "INSERT INTO sync_journal (event_id, record_id, provider_profile_id, source_device_id, operation, base_version, result_version, base_content_hash, result_content_hash, remote_updated_at, created_at, status, conflict_id, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT(event_id) DO NOTHING",
      "INSERT IGNORE INTO sync_journal (event_id, record_id, provider_profile_id, source_device_id, operation, base_version, result_version, base_content_hash, result_content_hash, remote_updated_at, created_at, status, conflict_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [event.eventId, event.recordId, event.providerProfileId, event.sourceDeviceId, event.operation, event.baseVersion, event.resultVersion, event.baseContentHash, event.resultContentHash, event.remoteUpdatedAt, event.createdAt, event.status, event.conflictId, event.metadataJson],
    );
  }

  const lastJournalEvent = payload.journalEvents[payload.journalEvents.length - 1] ?? null;
  if (lastJournalEvent) {
    await q(
      "INSERT INTO sync_device_cursors (device_id, provider_profile_id, last_seen_remote_updated_at, last_seen_journal_created_at, last_seen_journal_event_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(device_id, provider_profile_id) DO UPDATE SET last_seen_remote_updated_at = excluded.last_seen_remote_updated_at, last_seen_journal_created_at = excluded.last_seen_journal_created_at, last_seen_journal_event_id = excluded.last_seen_journal_event_id, updated_at = excluded.updated_at",
      "INSERT INTO sync_device_cursors (device_id, provider_profile_id, last_seen_remote_updated_at, last_seen_journal_created_at, last_seen_journal_event_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE last_seen_remote_updated_at = VALUES(last_seen_remote_updated_at), last_seen_journal_created_at = VALUES(last_seen_journal_created_at), last_seen_journal_event_id = VALUES(last_seen_journal_event_id), updated_at = VALUES(updated_at)",
      [payload.device.deviceId, lastJournalEvent.providerProfileId, payload.device.checkedAt, lastJournalEvent.createdAt, lastJournalEvent.eventId, payload.device.checkedAt],
    );
  }
}

class MongoAdapter {
  constructor(client, db) {
    this.client = client;
    this.db = db;
    this.provider = "mongodb";
  }

  static async create() {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(getEnv("MONGODB_URI"), { maxPoolSize: Number(process.env.DATABASE_POOL_SIZE ?? 4) });
    await client.connect();
    return new MongoAdapter(client, client.db(getEnv("MONGODB_DATABASE")));
  }

  collection(name) {
    return this.db.collection(name);
  }

  async ensureSchema() {
    await Promise.all([
      this.collection("schema_migrations").updateOne({ _id: MIGRATION_NAME }, { $setOnInsert: { migration_name: MIGRATION_NAME, applied_at: nowIso() } }, { upsert: true }),
      this.collection("vault_records").createIndex({ record_id: 1 }, { unique: true }),
      this.collection("vault_records").createIndex({ updated_at: 1 }),
      this.collection("vault_records").createIndex({ deleted_at: 1 }),
      this.collection("vault_record_versions").createIndex({ record_id: 1, version: -1 }),
      this.collection("vault_tombstones").createIndex({ deleted_at: 1 }),
      this.collection("sync_journal").createIndex({ created_at: 1, event_id: 1 }),
      this.collection("sync_journal").createIndex({ record_id: 1, created_at: 1 }),
      this.collection("sync_conflicts").createIndex({ provider_profile_id: 1, resolved_at: 1, detected_at: 1 }),
      this.collection("sync_device_cursors").createIndex({ device_id: 1, provider_profile_id: 1 }, { unique: true }),
    ]);
  }

  async schemaReady() {
    return !!(await this.collection("schema_migrations").findOne({ _id: MIGRATION_NAME }));
  }

  async listRecords() {
    const rows = await this.collection("vault_records").find({}).sort({ record_id: 1 }).toArray();
    return rows.map(serializeRemoteRecord);
  }

  async applyPush(payload) {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await applyDocumentPush({
          payload,
          write: (collection, id, value) => this.collection(collection).updateOne({ _id: id }, { $set: { ...value, _id: id } }, { upsert: true, session }),
          setOnInsert: (collection, id, value) => this.collection(collection).updateOne({ _id: id }, { $setOnInsert: { ...value, _id: id } }, { upsert: true, session }),
          update: (collection, id, value) => this.collection(collection).updateOne({ _id: id }, { $set: value }, { session }),
          remove: (collection, id) => this.collection(collection).deleteOne({ _id: id }, { session }),
          pruneVersions: async (recordId) => {
            const keep = await this.collection("vault_record_versions")
              .find({ record_id: recordId }, { session })
              .sort({ version: -1 })
              .limit(MAX_RECORD_VERSIONS)
              .project({ _id: 1 })
              .toArray();
            await this.collection("vault_record_versions").deleteMany({ record_id: recordId, _id: { $nin: keep.map((entry) => entry._id) } }, { session });
          },
        });
      });
    } finally {
      await session.endSession();
    }
  }
}

class FirestoreAdapter {
  constructor(firestore) {
    this.firestore = firestore;
    this.provider = "firestore";
  }

  static async create() {
    const { Firestore } = await import("@google-cloud/firestore");
    const serviceAccountJson = process.env.FIRESTORE_SERVICE_ACCOUNT_JSON?.trim();
    const options = {
      projectId: process.env.FIRESTORE_PROJECT_ID?.trim() || undefined,
      databaseId: process.env.FIRESTORE_DATABASE_ID?.trim() || undefined,
    };
    if (serviceAccountJson) options.credentials = JSON.parse(serviceAccountJson);
    return new FirestoreAdapter(new Firestore(options));
  }

  collection(name) {
    return this.firestore.collection(name);
  }

  async ensureSchema() {
    await this.collection("schema_migrations").doc(MIGRATION_NAME).set({
      migration_name: MIGRATION_NAME,
      applied_at: nowIso(),
    }, { merge: true });
  }

  async schemaReady() {
    return (await this.collection("schema_migrations").doc(MIGRATION_NAME).get()).exists;
  }

  async listRecords() {
    const snapshot = await this.collection("vault_records").orderBy("record_id", "asc").get();
    return snapshot.docs.map((doc) => serializeRemoteRecord(doc.data()));
  }

  async applyPush(payload) {
    await applyDocumentPush({
      payload,
      write: (collection, id, value) => this.collection(collection).doc(id).set({ ...value, _id: id }, { merge: true }),
      setOnInsert: async (collection, id, value) => {
        const doc = this.collection(collection).doc(id);
        if (!(await doc.get()).exists) await doc.set({ ...value, _id: id });
      },
      update: (collection, id, value) => this.collection(collection).doc(id).set(value, { merge: true }),
      remove: (collection, id) => this.collection(collection).doc(id).delete(),
      pruneVersions: async (recordId) => {
        const snapshot = await this.collection("vault_record_versions")
          .where("record_id", "==", recordId)
          .orderBy("version", "desc")
          .get();
        const staleDocs = snapshot.docs.slice(MAX_RECORD_VERSIONS);
        for (const doc of staleDocs) await doc.ref.delete();
      },
    });
  }
}

async function applyDocumentPush(store) {
  const { payload } = store;
  await store.write("provider_devices", payload.device.deviceId, {
    device_id: payload.device.deviceId,
    device_label: payload.device.deviceLabel,
    created_at: payload.device.checkedAt,
    last_seen_at: payload.device.checkedAt,
  });

  for (const record of payload.records) {
    await store.write("vault_records", record.recordId, {
      record_id: record.recordId,
      record_kind: record.recordKind,
      algorithm: record.algorithm,
      iv: record.iv,
      ciphertext: record.ciphertext,
      content_hash: record.contentHash,
      version: record.version,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      deleted_at: null,
    });
    await store.setOnInsert("vault_record_versions", `${record.recordId}:${record.version}`, {
      version_id: `${record.recordId}:${record.version}`,
      record_id: record.recordId,
      version: record.version,
      algorithm: record.algorithm,
      iv: record.iv,
      ciphertext: record.ciphertext,
      content_hash: record.contentHash,
      created_at: record.updatedAt,
    });
    await store.pruneVersions(record.recordId);
  }

  for (const recordId of payload.deleteTombstonesForRecordIds) {
    await store.remove("vault_tombstones", recordId);
  }

  for (const tombstone of payload.tombstones) {
    await store.update("vault_records", tombstone.recordId, {
      version: tombstone.version,
      updated_at: tombstone.deletedAt,
      deleted_at: tombstone.deletedAt,
    });
    await store.write("vault_tombstones", tombstone.recordId, {
      record_id: tombstone.recordId,
      deleted_at: tombstone.deletedAt,
      version: tombstone.version,
      content_hash: tombstone.contentHash,
      source_device_id: tombstone.sourceDeviceId,
    });
  }

  for (const conflict of payload.conflicts) {
    await store.setOnInsert("sync_conflicts", conflict.conflictId, {
      conflict_id: conflict.conflictId,
      record_id: conflict.recordId,
      provider_profile_id: conflict.providerProfileId,
      local_content_hash: conflict.localContentHash,
      remote_content_hash: conflict.remoteContentHash,
      local_version: conflict.localVersion,
      remote_version: conflict.remoteVersion,
      detected_at: conflict.detectedAt,
      resolved_at: null,
      resolution: null,
    });
  }

  for (const conflict of payload.resolvedConflicts) {
    await store.update("sync_conflicts", conflict.conflictId, {
      resolved_at: conflict.resolvedAt,
      resolution: conflict.resolution,
    });
  }

  await store.write("sync_cursors", payload.cursor.name, {
    cursor_name: payload.cursor.name,
    cursor_value: payload.cursor.value,
    updated_at: payload.cursor.updatedAt,
  });

  for (const event of payload.journalEvents) {
    await store.setOnInsert("sync_journal", event.eventId, {
      event_id: event.eventId,
      record_id: event.recordId,
      provider_profile_id: event.providerProfileId,
      source_device_id: event.sourceDeviceId,
      operation: event.operation,
      base_version: event.baseVersion,
      result_version: event.resultVersion,
      base_content_hash: event.baseContentHash,
      result_content_hash: event.resultContentHash,
      remote_updated_at: event.remoteUpdatedAt,
      created_at: event.createdAt,
      status: event.status,
      conflict_id: event.conflictId,
      metadata_json: event.metadataJson,
    });
  }

  const lastJournalEvent = payload.journalEvents[payload.journalEvents.length - 1] ?? null;
  if (lastJournalEvent) {
    await store.write("sync_device_cursors", `${payload.device.deviceId}:${lastJournalEvent.providerProfileId}`, {
      device_id: payload.device.deviceId,
      provider_profile_id: lastJournalEvent.providerProfileId,
      last_seen_remote_updated_at: payload.device.checkedAt,
      last_seen_journal_created_at: lastJournalEvent.createdAt,
      last_seen_journal_event_id: lastJournalEvent.eventId,
      updated_at: payload.device.checkedAt,
    });
  }
}

let adapterPromise;

async function getAdapter() {
  if (adapterPromise) return adapterPromise;
  adapterPromise = (async () => {
    const provider = (process.env.CIPHORA_BRIDGE_PROVIDER ?? "postgres").trim().toLowerCase();
    if (provider === "postgres") return PostgresAdapter.create();
    if (provider === "mysql" || provider === "tidb") return MySqlAdapter.create();
    if (provider === "mongodb" || provider === "mongo") return MongoAdapter.create();
    if (provider === "firestore" || provider === "firebase") return FirestoreAdapter.create();
    throw new Error("unsupported_bridge_provider");
  })();
  return adapterPromise;
}

async function handleHealth(req, res) {
  requireMethod(req, "GET");
  ensureAuthorized(req);
  const adapter = await getAdapter();
  const schemaReady = await adapter.schemaReady();
  sendJson(req, res, 200, {
    ok: true,
    status: schemaReady ? "ready" : "foundation_ready",
    provider: getReportedProviderType(adapter),
    schemaReady,
    migrationName: MIGRATION_NAME,
  });
}

async function handleApplySchema(req, res) {
  requireMethod(req, "POST");
  ensureAuthorized(req);
  const adapter = await getAdapter();
  await adapter.ensureSchema();
  sendJson(req, res, 200, {
    ok: true,
    status: "schema_applied",
    migrationName: MIGRATION_NAME,
    appliedAt: nowIso(),
  });
}

async function handleRecords(req, res) {
  requireMethod(req, "GET");
  ensureAuthorized(req);
  const adapter = await getAdapter();
  const records = await adapter.listRecords();
  sendJson(req, res, 200, {
    ok: true,
    records,
    checkedAt: nowIso(),
  });
}

async function handleSyncPush(req, res) {
  requireMethod(req, "POST");
  ensureAuthorized(req);
  const payload = normalizePushPayload(await readJsonBody(req));
  const adapter = await getAdapter();
  await adapter.applyPush(payload);
  sendJson(req, res, 200, {
    ok: true,
    status: "applied",
    appliedAt: payload.cursor.updatedAt,
    recordsApplied: payload.records.length,
    tombstonesApplied: payload.tombstones.length,
    conflictsApplied: payload.conflicts.length,
    conflictsResolved: payload.resolvedConflicts.length,
    journalEventsApplied: payload.journalEvents.length,
  });
}

async function routeRequest(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(req, res, 204, { ok: true });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (pathname === "/health") return await handleHealth(req, res);
    if (pathname === "/schema/apply") return await handleApplySchema(req, res);
    if (pathname === "/records") return await handleRecords(req, res);
    if (pathname === "/sync/push") return await handleSyncPush(req, res);
    sendJson(req, res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(req, res, error.status, { ok: false, error: error.code });
      return;
    }

    console.error("ciphora_http_bridge_internal_error", {
      path: pathname,
      name: error instanceof Error ? error.name : "UnknownError",
    });

    sendJson(req, res, 500, { ok: false, error: "internal_error" });
  }
}

const port = Number(process.env.CIPHORA_BRIDGE_PORT ?? DEFAULT_PORT);
http.createServer((req, res) => {
  routeRequest(req, res).catch((error) => {
    console.error("ciphora_http_bridge_unhandled_error", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    sendJson(req, res, 500, { ok: false, error: "internal_error" });
  });
}).listen(port, () => {
  const provider = process.env.CIPHORA_BRIDGE_PROVIDER ?? "postgres";
  console.log(`Ciphora HTTP Bridge listening on :${port} (${provider})`);
});

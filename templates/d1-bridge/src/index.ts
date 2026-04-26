import { USER_VAULT_SCHEMA_SQL } from "./user-vault-schema";

interface Env {
  USER_VAULT_DB: D1Database;
  CIPHORA_BRIDGE_TOKEN: string;
  CIPHORA_ALLOWED_ORIGINS?: string;
}

const MIGRATION_NAME = "ciphora_d1_user_vault_v2_sync_journal";
const MAX_BATCH_ITEMS = 2000;
const MAX_CONFLICTS = 500;
const MAX_RESOLVED_CONFLICTS = 500;
const MAX_JOURNAL_EVENTS = 4000;
const MAX_RECORD_FIELD_LENGTH = 262144;
const MAX_METADATA_FIELD_LENGTH = 2048;
const MAX_RECORD_VERSIONS = 8;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://ciphora.pages.dev",
  "https://app.ciphora.indevs.in",
]);
const DEFAULT_ALLOWED_SUFFIXES = [
  ".ciphora.pages.dev",
];

type JsonRecord = Record<string, unknown>;

function json(request: Request, env: Env, status: number, body: JsonRecord) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  applyCorsHeaders(headers, request, env);
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function applyCorsHeaders(headers: Headers, request: Request, env: Env) {
  headers.set("vary", "Origin");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-allow-headers", "authorization, content-type, accept");
  headers.set("access-control-max-age", "86400");

  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (!isAllowedOrigin(origin, env)) return;

  headers.set("access-control-allow-origin", origin);
}

function getConfiguredOriginPatterns(env: Env) {
  return (env.CIPHORA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string, env: Env) {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  if (DEFAULT_ALLOWED_ORIGINS.has(parsed.origin)) {
    return true;
  }

  if (DEFAULT_ALLOWED_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix))) {
    return true;
  }

  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") {
    return true;
  }

  for (const pattern of getConfiguredOriginPatterns(env)) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1).toLowerCase();
      if (parsed.hostname.toLowerCase().endsWith(suffix)) {
        return true;
      }
      continue;
    }

    if (parsed.origin === pattern) {
      return true;
    }
  }

  return false;
}

function readBearerToken(request: Request) {
  const value = request.headers.get("Authorization") ?? request.headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() ?? null;
}

function ensureAuthorized(request: Request, env: Env) {
  if (!env.CIPHORA_BRIDGE_TOKEN || env.CIPHORA_BRIDGE_TOKEN.trim().length < 16) {
    throw new Response(JSON.stringify({ ok: false, error: "bridge_not_configured" }), { status: 503 });
  }

  const bearer = readBearerToken(request);
  if (!bearer || bearer !== env.CIPHORA_BRIDGE_TOKEN) {
    throw new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }
}

function requireMethod(request: Request, expected: string) {
  if (request.method !== expected) {
    throw new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }
}

async function readJsonBody(request: Request) {
  try {
    return await request.json() as JsonRecord;
  } catch {
    throw new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400 });
  }
}

function expectObject(value: unknown, errorCode: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Response(JSON.stringify({ ok: false, error: errorCode }), { status: 400 });
  }
  return value as JsonRecord;
}

function expectString(value: unknown, errorCode: string, maxLength = 256) {
  if (typeof value !== "string") {
    throw new Response(JSON.stringify({ ok: false, error: errorCode }), { status: 400 });
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new Response(JSON.stringify({ ok: false, error: errorCode }), { status: 400 });
  }
  return trimmed;
}

function expectOptionalString(value: unknown, errorCode: string, maxLength = 256): string | null {
  if (value === null || value === undefined) return null;
  return expectString(value, errorCode, maxLength);
}

function expectVersion(value: unknown, errorCode: string) {
  const version = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(version) || version < 1) {
    throw new Response(JSON.stringify({ ok: false, error: errorCode }), { status: 400 });
  }
  return version;
}

function expectOptionalVersion(value: unknown, errorCode: string): number | null {
  if (value === null || value === undefined) return null;
  return expectVersion(value, errorCode);
}

function expectArray(value: unknown, errorCode: string, maxLength = MAX_BATCH_ITEMS) {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Response(JSON.stringify({ ok: false, error: errorCode }), { status: 400 });
  }
  return value;
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], errorCode: string): T {
  const text = expectString(value, errorCode, 64);
  if (!allowed.includes(text as T)) {
    throw new Response(JSON.stringify({ ok: false, error: errorCode }), { status: 400 });
  }
  return text as T;
}

function serializeRemoteRecord(row: JsonRecord) {
  return {
    recordId: String(row.recordId ?? ""),
    algorithm: String(row.algorithm ?? ""),
    iv: String(row.iv ?? ""),
    ciphertext: String(row.ciphertext ?? ""),
    contentHash: String(row.contentHash ?? ""),
    version: Number(row.version ?? 0),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
    deletedAt: row.deletedAt === null || row.deletedAt === undefined ? null : String(row.deletedAt),
  };
}

function buildSchemaStatements(env: Env) {
  return USER_VAULT_SCHEMA_SQL
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => env.USER_VAULT_DB.prepare(statement));
}

async function handleHealth(request: Request, env: Env) {
  requireMethod(request, "GET");
  ensureAuthorized(request, env);

  const result = await env.USER_VAULT_DB
    .prepare("SELECT migration_name FROM schema_migrations WHERE migration_name = ? LIMIT 1")
    .bind(MIGRATION_NAME)
    .first<JsonRecord>()
    .catch(() => null);

  const schemaReady = !!result?.migration_name;
  return json(request, env, 200, {
    ok: true,
    status: schemaReady ? "ready" : "foundation_ready",
    provider: "external_d1_bridge",
    schemaReady,
    migrationName: MIGRATION_NAME,
  });
}

async function handleApplySchema(request: Request, env: Env) {
  requireMethod(request, "POST");
  ensureAuthorized(request, env);
  await env.USER_VAULT_DB.batch(buildSchemaStatements(env));

  return json(request, env, 200, {
    ok: true,
    status: "schema_applied",
    migrationName: MIGRATION_NAME,
    appliedAt: new Date().toISOString(),
  });
}

async function handleRecords(request: Request, env: Env) {
  requireMethod(request, "GET");
  ensureAuthorized(request, env);

  const result = await env.USER_VAULT_DB
    .prepare(`
      SELECT
        record_id AS recordId,
        algorithm AS algorithm,
        iv AS iv,
        ciphertext AS ciphertext,
        content_hash AS contentHash,
        version AS version,
        created_at AS createdAt,
        updated_at AS updatedAt,
        deleted_at AS deletedAt
      FROM vault_records
      ORDER BY record_id ASC
    `)
    .all<JsonRecord>();

  return json(request, env, 200, {
    ok: true,
    records: (result.results ?? []).map(serializeRemoteRecord),
    checkedAt: new Date().toISOString(),
  });
}

async function handleSyncPush(request: Request, env: Env) {
  requireMethod(request, "POST");
  ensureAuthorized(request, env);

  const body = expectObject(await readJsonBody(request), "invalid_sync_push_payload");
  const device = expectObject(body.device, "invalid_bridge_device");
  const deviceId = expectString(device.deviceId, "invalid_bridge_device_id", 96);
  const deviceLabel = expectString(device.deviceLabel, "invalid_bridge_device_label", 120);
  const checkedAt = expectString(device.checkedAt, "invalid_bridge_checked_at", 64);

  const records = expectArray(body.records, "invalid_bridge_records").map((entry) => {
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
  });

  const tombstones = expectArray(body.tombstones, "invalid_bridge_tombstones").map((entry) => {
    const tombstone = expectObject(entry, "invalid_bridge_tombstone");
    return {
      recordId: expectString(tombstone.recordId, "invalid_bridge_record_id", 128),
      deletedAt: expectString(tombstone.deletedAt, "invalid_bridge_deleted_at", 64),
      version: expectVersion(tombstone.version, "invalid_bridge_version"),
      contentHash: expectString(tombstone.contentHash, "invalid_bridge_content_hash", 256),
      sourceDeviceId: expectString(tombstone.sourceDeviceId, "invalid_bridge_source_device_id", 96),
    };
  });

  const deleteTombstonesForRecordIds = expectArray(body.deleteTombstonesForRecordIds, "invalid_bridge_delete_tombstones")
    .map((entry) => expectString(entry, "invalid_bridge_delete_tombstone_record_id", 128));

  const conflicts = expectArray(body.conflicts ?? [], "invalid_bridge_conflicts", MAX_CONFLICTS)
    .map((entry) => {
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
    });

  const resolvedConflicts = expectArray(body.resolvedConflicts ?? [], "invalid_bridge_resolved_conflicts", MAX_RESOLVED_CONFLICTS)
    .map((entry) => {
      const conflict = expectObject(entry, "invalid_bridge_resolved_conflict");
      return {
        conflictId: expectString(conflict.conflictId, "invalid_bridge_resolved_conflict_id", 128),
        providerProfileId: expectString(conflict.providerProfileId, "invalid_bridge_resolved_conflict_profile_id", 128),
        resolvedAt: expectString(conflict.resolvedAt, "invalid_bridge_resolved_at", 64),
        resolution: expectEnum(
          conflict.resolution,
          ["keep_local", "keep_remote", "keep_both", "manual_edit"] as const,
          "invalid_bridge_resolution",
        ),
      };
    });

  const journalEvents = expectArray(body.journalEvents ?? [], "invalid_bridge_journal_events", MAX_JOURNAL_EVENTS)
    .map((entry) => {
      const event = expectObject(entry, "invalid_bridge_journal_event");
      return {
        eventId: expectString(event.eventId, "invalid_bridge_journal_event_id", 128),
        recordId: expectString(event.recordId, "invalid_bridge_journal_record_id", 128),
        providerProfileId: expectString(event.providerProfileId, "invalid_bridge_journal_profile_id", 128),
        sourceDeviceId: expectString(event.sourceDeviceId, "invalid_bridge_journal_source_device_id", 96),
        operation: expectEnum(event.operation, ["upsert", "delete", "pull", "conflict", "resolve"] as const, "invalid_bridge_journal_operation"),
        baseVersion: expectOptionalVersion(event.baseVersion, "invalid_bridge_journal_base_version"),
        resultVersion: expectOptionalVersion(event.resultVersion, "invalid_bridge_journal_result_version"),
        baseContentHash: expectOptionalString(event.baseContentHash, "invalid_bridge_journal_base_hash", 256),
        resultContentHash: expectOptionalString(event.resultContentHash, "invalid_bridge_journal_result_hash", 256),
        remoteUpdatedAt: expectOptionalString(event.remoteUpdatedAt, "invalid_bridge_journal_remote_updated_at", 64),
        createdAt: expectString(event.createdAt, "invalid_bridge_journal_created_at", 64),
        status: expectEnum(event.status, ["applied", "skipped", "conflict", "resolved"] as const, "invalid_bridge_journal_status"),
        conflictId: expectOptionalString(event.conflictId, "invalid_bridge_journal_conflict_id", 128),
        metadataJson: expectOptionalString(event.metadataJson, "invalid_bridge_journal_metadata", MAX_METADATA_FIELD_LENGTH),
      };
    });

  const cursor = expectObject(body.cursor, "invalid_bridge_cursor");
  const cursorName = expectString(cursor.name, "invalid_bridge_cursor_name", 64);
  const cursorValue = expectString(cursor.value, "invalid_bridge_cursor_value", MAX_RECORD_FIELD_LENGTH);
  const cursorUpdatedAt = expectString(cursor.updatedAt, "invalid_bridge_cursor_updated_at", 64);

  const statements: D1PreparedStatement[] = [
    env.USER_VAULT_DB
      .prepare("INSERT INTO provider_devices (device_id, device_label, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET device_label = excluded.device_label, last_seen_at = excluded.last_seen_at")
      .bind(deviceId, deviceLabel, checkedAt, checkedAt),
  ];

  for (const record of records) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("INSERT INTO vault_records (record_id, record_kind, algorithm, iv, ciphertext, content_hash, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(record_id) DO UPDATE SET record_kind = excluded.record_kind, algorithm = excluded.algorithm, iv = excluded.iv, ciphertext = excluded.ciphertext, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at, deleted_at = NULL")
        .bind(record.recordId, record.recordKind, record.algorithm, record.iv, record.ciphertext, record.contentHash, record.version, record.createdAt, record.updatedAt),
      env.USER_VAULT_DB
        .prepare("INSERT INTO vault_record_versions (version_id, record_id, version, algorithm, iv, ciphertext, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(`${record.recordId}:${record.version}`, record.recordId, record.version, record.algorithm, record.iv, record.ciphertext, record.contentHash, record.updatedAt),
      env.USER_VAULT_DB
        .prepare("DELETE FROM vault_record_versions WHERE record_id = ? AND version_id NOT IN (SELECT version_id FROM vault_record_versions WHERE record_id = ? ORDER BY version DESC LIMIT ?)")
        .bind(record.recordId, record.recordId, MAX_RECORD_VERSIONS),
    );
  }

  for (const recordId of deleteTombstonesForRecordIds) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("DELETE FROM vault_tombstones WHERE record_id = ?")
        .bind(recordId),
    );
  }

  for (const tombstone of tombstones) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("UPDATE vault_records SET version = ?, updated_at = ?, deleted_at = ? WHERE record_id = ?")
        .bind(tombstone.version, tombstone.deletedAt, tombstone.deletedAt, tombstone.recordId),
      env.USER_VAULT_DB
        .prepare("INSERT INTO vault_tombstones (record_id, deleted_at, version, content_hash, source_device_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET deleted_at = excluded.deleted_at, version = excluded.version, content_hash = excluded.content_hash, source_device_id = excluded.source_device_id")
        .bind(tombstone.recordId, tombstone.deletedAt, tombstone.version, tombstone.contentHash, tombstone.sourceDeviceId),
    );
  }

  for (const conflict of conflicts) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("INSERT INTO sync_conflicts (conflict_id, record_id, provider_profile_id, local_content_hash, remote_content_hash, local_version, remote_version, detected_at, resolved_at, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(conflict_id) DO NOTHING")
        .bind(
          conflict.conflictId,
          conflict.recordId,
          conflict.providerProfileId,
          conflict.localContentHash,
          conflict.remoteContentHash,
          conflict.localVersion,
          conflict.remoteVersion,
          conflict.detectedAt,
        ),
    );
  }

  for (const conflict of resolvedConflicts) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?")
        .bind(conflict.resolvedAt, conflict.resolution, conflict.conflictId, conflict.providerProfileId),
    );
  }

  statements.push(
    env.USER_VAULT_DB
      .prepare("INSERT INTO sync_cursors (cursor_name, cursor_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(cursor_name) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = excluded.updated_at")
      .bind(cursorName, cursorValue, cursorUpdatedAt),
  );

  for (const event of journalEvents) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("INSERT INTO sync_journal (event_id, record_id, provider_profile_id, source_device_id, operation, base_version, result_version, base_content_hash, result_content_hash, remote_updated_at, created_at, status, conflict_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(
          event.eventId,
          event.recordId,
          event.providerProfileId,
          event.sourceDeviceId,
          event.operation,
          event.baseVersion,
          event.resultVersion,
          event.baseContentHash,
          event.resultContentHash,
          event.remoteUpdatedAt,
          event.createdAt,
          event.status,
          event.conflictId,
          event.metadataJson,
        ),
    );
  }

  const lastJournalEvent = journalEvents[journalEvents.length - 1] ?? null;
  const providerProfileId = lastJournalEvent?.providerProfileId;
  if (providerProfileId) {
    statements.push(
      env.USER_VAULT_DB
        .prepare("INSERT INTO sync_device_cursors (device_id, provider_profile_id, last_seen_remote_updated_at, last_seen_journal_created_at, last_seen_journal_event_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, provider_profile_id) DO UPDATE SET last_seen_remote_updated_at = excluded.last_seen_remote_updated_at, last_seen_journal_created_at = excluded.last_seen_journal_created_at, last_seen_journal_event_id = excluded.last_seen_journal_event_id, updated_at = excluded.updated_at")
        .bind(deviceId, providerProfileId, checkedAt, lastJournalEvent.createdAt, lastJournalEvent.eventId, checkedAt),
    );
  }

  await env.USER_VAULT_DB.batch(statements);

  return json(request, env, 200, {
    ok: true,
    status: "applied",
    appliedAt: cursorUpdatedAt,
    recordsApplied: records.length,
    tombstonesApplied: tombstones.length,
    conflictsApplied: conflicts.length,
    conflictsResolved: resolvedConflicts.length,
    journalEventsApplied: journalEvents.length,
  });
}

function withCorsFromThrownResponse(request: Request, env: Env, response: Response) {
  const headers = new Headers(response.headers);
  applyCorsHeaders(headers, request, env);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return json(request, env, 204, { ok: true });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (pathname === "/health") {
        return await handleHealth(request, env);
      }
      if (pathname === "/schema/apply") {
        return await handleApplySchema(request, env);
      }
      if (pathname === "/records") {
        return await handleRecords(request, env);
      }
      if (pathname === "/sync/push") {
        return await handleSyncPush(request, env);
      }

      return json(request, env, 404, {
        ok: false,
        error: "not_found",
      });
    } catch (error) {
      if (error instanceof Response) {
        return withCorsFromThrownResponse(request, env, error);
      }

      console.error("ciphora_d1_bridge_internal_error", {
        path: pathname,
        error: error instanceof Error ? error.message : String(error),
      });

      return json(request, env, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  },
};

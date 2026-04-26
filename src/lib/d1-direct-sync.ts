import { decryptCiphoraSyncProfileConfig, type SyncProfile } from "./account-client";
import {
  D1DirectHttpError,
  executeD1DirectQuery,
  executeD1DirectStatements,
  sanitizeD1DirectErrorMessage,
  type D1DirectStatement,
  type D1DirectSqlArg,
} from "./d1-direct-client";
import {
  chooseMergedItem,
  decryptVaultItemRecord,
  encryptVaultItemRecord,
  getItemModifiedMs,
  getManualSyncDeviceId,
  getManualSyncRecordId,
  parseSyncTimestamp,
  toKnownRemoteRecord,
  type ManualSyncRemoteRecord,
} from "./manual-vault-sync-core";
import {
  applySyncConflictResolution,
  findResolvedLocalOverwriteGrant,
  type SyncConflictResolution,
} from "./sync-conflict-resolution";
import {
  createVaultSyncConflict,
  mergeVaultSyncConflicts,
  type VaultData,
  type VaultKnownRemoteRecord,
  type VaultSyncConflict,
  type VaultSyncState,
} from "./vault-storage";
import type { VaultItem } from "../sections/ItemModal";
import userVaultSchemaSql from "../../schema/d1/user_vault.sql?raw";

const CURSOR_NAME = "manual_snapshot";
const MAX_RECORD_VERSIONS = 8;
const SYNC_JOURNAL_METADATA_MAX_CHARS = 2048;

type SyncJournalOperation = "upsert" | "delete" | "pull" | "conflict" | "resolve";
type SyncJournalStatus = "applied" | "skipped" | "conflict" | "resolved";

interface SyncJournalEventRow {
  eventId: string;
  recordId: string;
  providerProfileId: string;
  sourceDeviceId: string;
  operation: SyncJournalOperation;
  baseVersion: number | null;
  resultVersion: number | null;
  baseContentHash: string | null;
  resultContentHash: string | null;
  remoteUpdatedAt: string | null;
  createdAt: string;
  status: SyncJournalStatus;
  conflictId: string | null;
  metadataJson: string | null;
}

export interface D1DirectPushResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  pushedCount: number;
  tombstoneCount: number;
  preservedRemoteCount: number;
  conflictCount: number;
  syncState: VaultSyncState;
}

export interface D1DirectPullResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  items: VaultItem[];
  remoteActiveCount: number;
  mergedCount: number;
  deletedCount: number;
  preservedLocalCount: number;
  syncState: VaultSyncState;
}

function getD1DirectState(syncState: VaultSyncState, profileId: string) {
  return syncState.d1Direct?.profileId === profileId ? syncState.d1Direct : null;
}

function buildNextSyncState(input: {
  currentSyncState: VaultSyncState;
  profileId: string;
  remoteRecords: Iterable<Pick<ManualSyncRemoteRecord, "recordId" | "version" | "updatedAt" | "deletedAt" | "contentHash">>;
  lastPulledAt?: string;
  lastPushedAt?: string;
  lastMergedAt?: string;
  clearedDeleteIds?: Set<string>;
  conflicts?: VaultSyncConflict[];
}): VaultSyncState {
  const currentD1Direct = getD1DirectState(input.currentSyncState, input.profileId);
  const knownRemoteRecords = Array.from(input.remoteRecords, toKnownRemoteRecord)
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  const pendingLocalDeletes = input.currentSyncState.pendingLocalDeletes
    .filter((entry) => !input.clearedDeleteIds?.has(entry.recordId))
    .slice(0, 512);

  return {
    pendingLocalDeletes,
    conflicts: mergeVaultSyncConflicts(input.currentSyncState.conflicts, input.conflicts ?? []),
    turso: input.currentSyncState.turso,
    d1Bridge: input.currentSyncState.d1Bridge,
    d1Direct: {
      profileId: input.profileId,
      knownRemoteRecords,
      lastPulledAt: input.lastPulledAt ?? currentD1Direct?.lastPulledAt,
      lastPushedAt: input.lastPushedAt ?? currentD1Direct?.lastPushedAt,
      lastMergedAt: input.lastMergedAt ?? currentD1Direct?.lastMergedAt,
    },
  };
}

function hasRemoteChangedSinceKnown(
  knownRecord: VaultKnownRemoteRecord | undefined,
  remoteRecord: Pick<ManualSyncRemoteRecord, "version" | "updatedAt" | "deletedAt" | "contentHash">,
) {
  return !knownRecord
    || knownRecord.version !== remoteRecord.version
    || knownRecord.updatedAt !== remoteRecord.updatedAt
    || knownRecord.deletedAt !== remoteRecord.deletedAt
    || knownRecord.contentHash !== remoteRecord.contentHash;
}

function createD1DirectSyncConflict(input: {
  profileId: string;
  recordId: string;
  operation: "upsert" | "delete";
  reason: VaultSyncConflict["reason"];
  localContentHash: string;
  knownRemote: VaultKnownRemoteRecord | undefined;
  remoteRecord: Pick<ManualSyncRemoteRecord, "version" | "updatedAt" | "deletedAt" | "contentHash">;
  detectedAt: string;
}) {
  return createVaultSyncConflict({
    providerType: "external_d1_direct",
    providerProfileId: input.profileId,
    recordId: input.recordId,
    operation: input.operation,
    reason: input.reason,
    localContentHash: input.localContentHash,
    remoteContentHash: input.remoteRecord.contentHash,
    localVersion: input.knownRemote?.version ?? null,
    remoteVersion: input.remoteRecord.version,
    remoteUpdatedAt: input.remoteRecord.deletedAt ?? input.remoteRecord.updatedAt,
    detectedAt: input.detectedAt,
  });
}

function createSyncJournalEvent(input: {
  recordId: string;
  providerProfileId: string;
  sourceDeviceId: string;
  operation: SyncJournalOperation;
  status: SyncJournalStatus;
  createdAt: string;
  baseVersion?: number | null;
  resultVersion?: number | null;
  baseContentHash?: string | null;
  resultContentHash?: string | null;
  remoteUpdatedAt?: string | null;
  conflictId?: string | null;
  metadata?: Record<string, unknown>;
}): SyncJournalEventRow {
  return {
    eventId: crypto.randomUUID(),
    recordId: input.recordId,
    providerProfileId: input.providerProfileId,
    sourceDeviceId: input.sourceDeviceId,
    operation: input.operation,
    baseVersion: input.baseVersion ?? null,
    resultVersion: input.resultVersion ?? null,
    baseContentHash: input.baseContentHash ?? null,
    resultContentHash: input.resultContentHash ?? null,
    remoteUpdatedAt: input.remoteUpdatedAt ?? null,
    createdAt: input.createdAt,
    status: input.status,
    conflictId: input.conflictId ?? null,
    metadataJson: input.metadata ? JSON.stringify(input.metadata).slice(0, SYNC_JOURNAL_METADATA_MAX_CHARS) : null,
  };
}

function appendSyncJournalStatement(statements: D1DirectStatement[], event: SyncJournalEventRow) {
  statements.push({
    sql: "INSERT INTO sync_journal (event_id, record_id, provider_profile_id, source_device_id, operation, base_version, result_version, base_content_hash, result_content_hash, remote_updated_at, created_at, status, conflict_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
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
    ],
  });
}

function appendSyncConflictStatement(statements: D1DirectStatement[], conflict: VaultSyncConflict) {
  statements.push({
    sql: "INSERT INTO sync_conflicts (conflict_id, record_id, provider_profile_id, local_content_hash, remote_content_hash, local_version, remote_version, detected_at, resolved_at, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL) ON CONFLICT(conflict_id) DO NOTHING",
    args: [
      conflict.conflictId,
      conflict.recordId,
      conflict.providerProfileId,
      conflict.localContentHash,
      conflict.remoteContentHash,
      conflict.localVersion,
      conflict.remoteVersion,
      conflict.detectedAt,
    ],
  });
}

function appendSyncDeviceCursorStatement(input: {
  statements: D1DirectStatement[];
  deviceId: string;
  profileId: string;
  lastRemoteUpdatedAt: string | null;
  lastJournalEvent: SyncJournalEventRow | null;
  updatedAt: string;
}) {
  input.statements.push({
    sql: "INSERT INTO sync_device_cursors (device_id, provider_profile_id, last_seen_remote_updated_at, last_seen_journal_created_at, last_seen_journal_event_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, provider_profile_id) DO UPDATE SET last_seen_remote_updated_at = excluded.last_seen_remote_updated_at, last_seen_journal_created_at = excluded.last_seen_journal_created_at, last_seen_journal_event_id = excluded.last_seen_journal_event_id, updated_at = excluded.updated_at",
    args: [
      input.deviceId,
      input.profileId,
      input.lastRemoteUpdatedAt,
      input.lastJournalEvent?.createdAt ?? null,
      input.lastJournalEvent?.eventId ?? null,
      input.updatedAt,
    ],
  });
}

async function createD1DirectClient(rootKeyBase64: string, syncProfile: SyncProfile) {
  const config = await decryptCiphoraSyncProfileConfig({
    rootKeyBase64,
    syncProfile,
  });

  if (config.providerType !== "external_d1_direct") {
    throw new Error("Manual vault sync is only available for D1 Direct profiles in this build.");
  }

  return {
    endpoint: config.endpoint,
    accessToken: config.accessToken,
  };
}

function splitSqlStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));
}

async function ensureD1DirectSchema(endpoint: string, accessToken: string) {
  await executeD1DirectStatements({
    endpoint,
    accessToken,
    statements: splitSqlStatements(userVaultSchemaSql).map((sql) => ({ sql })),
  });
}

function normalizeSqlRowValue(row: Record<string, unknown>, key: string) {
  return row[key] ?? row[key.toLowerCase()] ?? row[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
}

async function listRemoteRecords(endpoint: string, accessToken: string): Promise<ManualSyncRemoteRecord[]> {
  const rows = await executeD1DirectQuery({
    endpoint,
    accessToken,
    sql: "SELECT record_id AS recordId, algorithm, iv, ciphertext, content_hash AS contentHash, version, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt FROM vault_records ORDER BY record_id ASC",
  });

  return rows
    .map((row) => ({
      recordId: String(normalizeSqlRowValue(row, "recordId") ?? ""),
      algorithm: String(normalizeSqlRowValue(row, "algorithm") ?? ""),
      iv: String(normalizeSqlRowValue(row, "iv") ?? ""),
      ciphertext: String(normalizeSqlRowValue(row, "ciphertext") ?? ""),
      contentHash: String(normalizeSqlRowValue(row, "contentHash") ?? ""),
      version: Number(normalizeSqlRowValue(row, "version") ?? 0),
      createdAt: String(normalizeSqlRowValue(row, "createdAt") ?? ""),
      updatedAt: String(normalizeSqlRowValue(row, "updatedAt") ?? ""),
      deletedAt: normalizeSqlRowValue(row, "deletedAt") == null ? null : String(normalizeSqlRowValue(row, "deletedAt")),
    }))
    .filter((row) => row.recordId && row.algorithm && row.iv && row.ciphertext && row.contentHash && row.createdAt && row.updatedAt && row.version >= 1)
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
}

function mapD1DirectSyncError(action: "push" | "pull", error: unknown, endpoint: string, accessToken: string) {
  const message = sanitizeD1DirectErrorMessage(error, endpoint, accessToken);
  const lowerMessage = message.toLowerCase();

  if (error instanceof D1DirectHttpError) {
    if (error.status === 401 || error.status === 403) {
      return "Cloudflare D1 token ditolak saat sinkronisasi. Pastikan token scoped ke D1 Read/Write untuk account/database ini.";
    }
    if (error.status === 404) {
      return "D1 Direct endpoint tidak menemukan account/database. Cek account ID, database ID, dan endpoint Cloudflare API.";
    }
  }

  if (lowerMessage.includes("abort") || lowerMessage.includes("timeout")) {
    return `Sinkronisasi D1 Direct habis waktu saat ${action === "push" ? "push" : "pull"}. Coba lagi sebentar lagi.`;
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network") || lowerMessage.includes("cors")) {
    return "Browser tidak bisa menjangkau Cloudflare D1 REST API. Jika CORS diblokir, gunakan D1 Bridge sebagai fallback.";
  }
  if (lowerMessage.includes("official cloudflare api") || lowerMessage.includes("endpoint path")) {
    return "Endpoint D1 Direct harus memakai URL resmi Cloudflare D1 REST API.";
  }
  if (lowerMessage.includes("invalid") || lowerMessage.includes("decrypt")) {
    return "Data sync D1 Direct tidak valid atau gagal didekripsi dengan vault key aktif.";
  }

  return `Sinkronisasi D1 Direct gagal: ${message}`;
}

function statement(sql: string, args?: D1DirectSqlArg[]): D1DirectStatement {
  return { sql, args };
}

export async function pushVaultSnapshotToD1Direct(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}): Promise<D1DirectPushResult> {
  const checkedAt = new Date().toISOString();
  const { endpoint, accessToken } = await createD1DirectClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureD1DirectSchema(endpoint, accessToken);
    const remoteRecords = await listRemoteRecords(endpoint, accessToken);
    const activeRemoteRecords = remoteRecords.filter((record) => record.deletedAt === null);
    const localItems = input.vaultData.items.map((item) => item);
    const localRecordIds = new Set(localItems.map((item) => getManualSyncRecordId(item)));
    const deviceId = getManualSyncDeviceId();
    const currentD1DirectState = getD1DirectState(input.vaultData.syncState, input.syncProfile.profileId);
    const knownRemoteMap = new Map(
      (currentD1DirectState?.knownRemoteRecords ?? []).map((record) => [record.recordId, record] as const),
    );
    const existingConflicts = input.vaultData.syncState.conflicts
      .filter((conflict) =>
        conflict.status === "unresolved"
        && conflict.providerType === "external_d1_direct"
        && conflict.providerProfileId === input.syncProfile.profileId,
      );
    const existingConflictIds = new Set(existingConflicts.map((conflict) => conflict.conflictId));
    const existingConflictByRecordId = new Map(existingConflicts.map((conflict) => [conflict.recordId, conflict] as const));
    const knownActiveRemoteIds = new Set(
      (currentD1DirectState?.knownRemoteRecords ?? [])
        .filter((record) => record.deletedAt === null)
        .map((record) => record.recordId),
    );
    const pendingDeleteMap = new Map(input.vaultData.syncState.pendingLocalDeletes.map((entry) => [entry.recordId, entry] as const));
    const deletableRemoteRecords = activeRemoteRecords.filter((record) =>
      !localRecordIds.has(record.recordId)
      && pendingDeleteMap.has(record.recordId)
      && knownActiveRemoteIds.has(record.recordId),
    );

    if (localItems.length === 0 && activeRemoteRecords.length > 0 && deletableRemoteRecords.length === 0) {
      return {
        ok: false,
        message: "Vault lokal kosong dan browser ini belum punya delete yang aman untuk disinkronkan. Pull dulu agar item remote tidak terhapus diam-diam.",
        checkedAt,
        pushedCount: 0,
        tombstoneCount: 0,
        preservedRemoteCount: activeRemoteRecords.length,
        conflictCount: 0,
        syncState: input.vaultData.syncState,
      };
    }

    const remoteRecordMap = new Map(remoteRecords.map((record) => [record.recordId, record] as const));
    const nextRemoteStateMap = new Map(remoteRecords.map((record) => [record.recordId, toKnownRemoteRecord(record)] as const));
    const statements: D1DirectStatement[] = [];
    const journalEvents: SyncJournalEventRow[] = [];
    const detectedConflicts: VaultSyncConflict[] = [];
    const newConflictRows: VaultSyncConflict[] = [];
    let pushedCount = 0;
    let tombstoneCount = 0;

    for (const item of localItems) {
      const encryptedRecord = await encryptVaultItemRecord(input.rootKeyBase64, item);
      const currentRecord = remoteRecordMap.get(encryptedRecord.recordId);
      const existingConflict = existingConflictByRecordId.get(encryptedRecord.recordId);
      if (existingConflict) {
        detectedConflicts.push(existingConflict);
        if (currentRecord) {
          nextRemoteStateMap.set(encryptedRecord.recordId, toKnownRemoteRecord(currentRecord));
        }
        continue;
      }

      const knownRemote = knownRemoteMap.get(encryptedRecord.recordId);
      const remoteChangedSinceKnown = currentRecord ? hasRemoteChangedSinceKnown(knownRemote, currentRecord) : false;
      const overwriteGrant = currentRecord
        ? findResolvedLocalOverwriteGrant({
          conflicts: input.vaultData.syncState.conflicts,
          providerType: "external_d1_direct",
          providerProfileId: input.syncProfile.profileId,
          recordId: encryptedRecord.recordId,
          remoteContentHash: currentRecord.contentHash,
          remoteVersion: currentRecord.version,
        })
        : undefined;
      const hasUnsafeRemoteChange = !!currentRecord
        && currentRecord.contentHash !== encryptedRecord.contentHash
        && (currentRecord.deletedAt !== null || !knownRemote || remoteChangedSinceKnown)
        && !overwriteGrant;

      if (currentRecord && hasUnsafeRemoteChange) {
        const conflict = createD1DirectSyncConflict({
          profileId: input.syncProfile.profileId,
          recordId: encryptedRecord.recordId,
          operation: "upsert",
          reason: currentRecord.deletedAt ? "remote_deleted_before_push" : "remote_changed_before_push",
          localContentHash: encryptedRecord.contentHash,
          knownRemote,
          remoteRecord: currentRecord,
          detectedAt: checkedAt,
        });
        detectedConflicts.push(conflict);
        if (!existingConflictIds.has(conflict.conflictId)) {
          newConflictRows.push(conflict);
          journalEvents.push(createSyncJournalEvent({
            recordId: conflict.recordId,
            providerProfileId: conflict.providerProfileId,
            sourceDeviceId: deviceId,
            operation: "conflict",
            status: "conflict",
            createdAt: checkedAt,
            baseVersion: conflict.localVersion,
            resultVersion: conflict.remoteVersion,
            baseContentHash: conflict.localContentHash,
            resultContentHash: conflict.remoteContentHash,
            remoteUpdatedAt: conflict.remoteUpdatedAt,
            conflictId: conflict.conflictId,
            metadata: {
              provider: "external_d1_direct",
              reason: conflict.reason,
              blockedOperation: "upsert",
            },
          }));
          existingConflictIds.add(conflict.conflictId);
        }
        nextRemoteStateMap.set(encryptedRecord.recordId, toKnownRemoteRecord(currentRecord));
        continue;
      }

      if (currentRecord && currentRecord.deletedAt === null && currentRecord.contentHash === encryptedRecord.contentHash) {
        nextRemoteStateMap.set(encryptedRecord.recordId, toKnownRemoteRecord(currentRecord));
        continue;
      }

      pushedCount += 1;
      const nextVersion = (currentRecord?.version ?? 0) + 1;
      const createdAt = currentRecord?.createdAt || checkedAt;
      const journalEvent = createSyncJournalEvent({
        recordId: encryptedRecord.recordId,
        providerProfileId: input.syncProfile.profileId,
        sourceDeviceId: deviceId,
        operation: "upsert",
        status: "applied",
        createdAt: checkedAt,
        baseVersion: currentRecord?.version ?? null,
        resultVersion: nextVersion,
        baseContentHash: currentRecord?.contentHash ?? null,
        resultContentHash: encryptedRecord.contentHash,
        remoteUpdatedAt: checkedAt,
        metadata: {
          provider: "external_d1_direct",
          syncMode: "manual_or_auto_delta",
        },
      });
      journalEvents.push(journalEvent);
      if (overwriteGrant) {
        journalEvents.push(createSyncJournalEvent({
          recordId: encryptedRecord.recordId,
          providerProfileId: input.syncProfile.profileId,
          sourceDeviceId: deviceId,
          operation: "resolve",
          status: "resolved",
          createdAt: checkedAt,
          baseVersion: overwriteGrant.remoteVersion,
          resultVersion: nextVersion,
          baseContentHash: overwriteGrant.remoteContentHash,
          resultContentHash: encryptedRecord.contentHash,
          remoteUpdatedAt: checkedAt,
          conflictId: overwriteGrant.conflictId,
          metadata: {
            provider: "external_d1_direct",
            resolution: overwriteGrant.resolution,
            appliedBy: "local_overwrite_grant",
          },
        }));
        statements.push(statement(
          "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
          [checkedAt, overwriteGrant.resolution ?? "keep_local", overwriteGrant.conflictId, input.syncProfile.profileId],
        ));
      }
      statements.push(statement(
        "INSERT INTO vault_records (record_id, record_kind, algorithm, iv, ciphertext, content_hash, version, created_at, updated_at, deleted_at) VALUES (?, 'vault_item', ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(record_id) DO UPDATE SET record_kind = excluded.record_kind, algorithm = excluded.algorithm, iv = excluded.iv, ciphertext = excluded.ciphertext, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at, deleted_at = NULL",
        [
          encryptedRecord.recordId,
          encryptedRecord.algorithm,
          encryptedRecord.iv,
          encryptedRecord.ciphertext,
          encryptedRecord.contentHash,
          nextVersion,
          createdAt,
          checkedAt,
        ],
      ));
      statements.push(statement(
        "INSERT INTO vault_record_versions (version_id, record_id, version, algorithm, iv, ciphertext, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(version_id) DO NOTHING",
        [
          `${encryptedRecord.recordId}:${nextVersion}`,
          encryptedRecord.recordId,
          nextVersion,
          encryptedRecord.algorithm,
          encryptedRecord.iv,
          encryptedRecord.ciphertext,
          encryptedRecord.contentHash,
          checkedAt,
        ],
      ));
      statements.push(statement(
        "DELETE FROM vault_record_versions WHERE record_id = ? AND version_id NOT IN (SELECT version_id FROM vault_record_versions WHERE record_id = ? ORDER BY version DESC LIMIT ?)",
        [encryptedRecord.recordId, encryptedRecord.recordId, MAX_RECORD_VERSIONS],
      ));
      statements.push(statement("DELETE FROM vault_tombstones WHERE record_id = ?", [encryptedRecord.recordId]));
      nextRemoteStateMap.set(encryptedRecord.recordId, {
        recordId: encryptedRecord.recordId,
        version: nextVersion,
        updatedAt: checkedAt,
        deletedAt: null,
        contentHash: encryptedRecord.contentHash,
      });
    }

    const clearedDeleteIds = new Set<string>();
    for (const remoteRecord of deletableRemoteRecords) {
      const existingConflict = existingConflictByRecordId.get(remoteRecord.recordId);
      if (existingConflict) {
        detectedConflicts.push(existingConflict);
        nextRemoteStateMap.set(remoteRecord.recordId, toKnownRemoteRecord(remoteRecord));
        continue;
      }

      const knownRemote = knownRemoteMap.get(remoteRecord.recordId);
      const overwriteGrant = findResolvedLocalOverwriteGrant({
        conflicts: input.vaultData.syncState.conflicts,
        providerType: "external_d1_direct",
        providerProfileId: input.syncProfile.profileId,
        recordId: remoteRecord.recordId,
        remoteContentHash: remoteRecord.contentHash,
        remoteVersion: remoteRecord.version,
      });
      if (hasRemoteChangedSinceKnown(knownRemote, remoteRecord)) {
        if (overwriteGrant) {
          // The user explicitly resolved this conflict as a local delete.
        } else {
        const pendingDelete = pendingDeleteMap.get(remoteRecord.recordId);
        const conflict = createD1DirectSyncConflict({
          profileId: input.syncProfile.profileId,
          recordId: remoteRecord.recordId,
          operation: "delete",
          reason: "remote_changed_before_delete",
          localContentHash: knownRemote?.contentHash ?? pendingDelete?.deletedAt ?? "local-delete",
          knownRemote,
          remoteRecord,
          detectedAt: checkedAt,
        });
        detectedConflicts.push(conflict);
        if (!existingConflictIds.has(conflict.conflictId)) {
          newConflictRows.push(conflict);
          journalEvents.push(createSyncJournalEvent({
            recordId: conflict.recordId,
            providerProfileId: conflict.providerProfileId,
            sourceDeviceId: deviceId,
            operation: "conflict",
            status: "conflict",
            createdAt: checkedAt,
            baseVersion: conflict.localVersion,
            resultVersion: conflict.remoteVersion,
            baseContentHash: conflict.localContentHash,
            resultContentHash: conflict.remoteContentHash,
            remoteUpdatedAt: conflict.remoteUpdatedAt,
            conflictId: conflict.conflictId,
            metadata: {
              provider: "external_d1_direct",
              reason: conflict.reason,
              blockedOperation: "delete",
            },
          }));
          existingConflictIds.add(conflict.conflictId);
        }
        nextRemoteStateMap.set(remoteRecord.recordId, toKnownRemoteRecord(remoteRecord));
        continue;
        }
      }

      tombstoneCount += 1;
      const nextVersion = remoteRecord.version + 1;
      const journalEvent = createSyncJournalEvent({
        recordId: remoteRecord.recordId,
        providerProfileId: input.syncProfile.profileId,
        sourceDeviceId: deviceId,
        operation: "delete",
        status: "applied",
        createdAt: checkedAt,
        baseVersion: remoteRecord.version,
        resultVersion: nextVersion,
        baseContentHash: remoteRecord.contentHash,
        resultContentHash: remoteRecord.contentHash,
        remoteUpdatedAt: checkedAt,
        metadata: {
          provider: "external_d1_direct",
          syncMode: "known_delete_tombstone",
        },
      });
      journalEvents.push(journalEvent);
      if (overwriteGrant) {
        journalEvents.push(createSyncJournalEvent({
          recordId: remoteRecord.recordId,
          providerProfileId: input.syncProfile.profileId,
          sourceDeviceId: deviceId,
          operation: "resolve",
          status: "resolved",
          createdAt: checkedAt,
          baseVersion: overwriteGrant.remoteVersion,
          resultVersion: nextVersion,
          baseContentHash: overwriteGrant.remoteContentHash,
          resultContentHash: remoteRecord.contentHash,
          remoteUpdatedAt: checkedAt,
          conflictId: overwriteGrant.conflictId,
          metadata: {
            provider: "external_d1_direct",
            resolution: overwriteGrant.resolution,
            appliedBy: "local_delete_grant",
          },
        }));
        statements.push(statement(
          "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
          [checkedAt, overwriteGrant.resolution ?? "keep_local", overwriteGrant.conflictId, input.syncProfile.profileId],
        ));
      }
      statements.push(statement(
        "UPDATE vault_records SET version = ?, updated_at = ?, deleted_at = ? WHERE record_id = ?",
        [nextVersion, checkedAt, checkedAt, remoteRecord.recordId],
      ));
      statements.push(statement(
        "INSERT INTO vault_tombstones (record_id, deleted_at, version, content_hash, source_device_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET deleted_at = excluded.deleted_at, version = excluded.version, content_hash = excluded.content_hash, source_device_id = excluded.source_device_id",
        [remoteRecord.recordId, checkedAt, nextVersion, remoteRecord.contentHash, deviceId],
      ));
      nextRemoteStateMap.set(remoteRecord.recordId, {
        recordId: remoteRecord.recordId,
        version: nextVersion,
        updatedAt: checkedAt,
        deletedAt: checkedAt,
        contentHash: remoteRecord.contentHash,
      });
      clearedDeleteIds.add(remoteRecord.recordId);
    }

    const preservedRemoteCount = activeRemoteRecords.filter((record) =>
      !localRecordIds.has(record.recordId)
      && !clearedDeleteIds.has(record.recordId),
    ).length;

    const nextSyncState = buildNextSyncState({
      currentSyncState: input.vaultData.syncState,
      profileId: input.syncProfile.profileId,
      remoteRecords: nextRemoteStateMap.values(),
      lastPushedAt: checkedAt,
      clearedDeleteIds,
      conflicts: detectedConflicts,
    });

    if (pushedCount === 0 && tombstoneCount === 0 && newConflictRows.length === 0) {
      let message = "Push ke D1 Direct selesai. Tidak ada delta lokal yang perlu dikirim.";
      if (preservedRemoteCount > 0) {
        message += ` ${preservedRemoteCount} item remote yang belum pernah ditarik ke browser ini dibiarkan aman sampai kamu pull.`;
      }
      if (detectedConflicts.length > 0) {
        message += ` ${detectedConflicts.length} konflik remote masih menunggu review.`;
      }

      return {
        ok: true,
        message,
        checkedAt,
        pushedCount,
        tombstoneCount,
        preservedRemoteCount,
        conflictCount: detectedConflicts.length,
        syncState: nextSyncState,
      };
    }

    statements.push(statement(
      "INSERT INTO sync_cursors (cursor_name, cursor_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(cursor_name) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = excluded.updated_at",
      [
        CURSOR_NAME,
        JSON.stringify({
          syncedAt: checkedAt,
          pushedCount,
          tombstoneCount,
          preservedRemoteCount,
          conflictCount: detectedConflicts.length,
          sourceDeviceId: deviceId,
        }),
        checkedAt,
      ],
    ));
    for (const conflict of newConflictRows) {
      appendSyncConflictStatement(statements, conflict);
    }
    for (const event of journalEvents) {
      appendSyncJournalStatement(statements, event);
    }
    appendSyncDeviceCursorStatement({
      statements,
      deviceId,
      profileId: input.syncProfile.profileId,
      lastRemoteUpdatedAt: checkedAt,
      lastJournalEvent: journalEvents[journalEvents.length - 1] ?? null,
      updatedAt: checkedAt,
    });

    await executeD1DirectStatements({ endpoint, accessToken, statements });

    let message = pushedCount === 0 && tombstoneCount > 0
      ? `Push ke D1 Direct selesai. ${tombstoneCount} delete lokal yang sudah diketahui provider diterapkan dengan aman.`
      : `Push ke D1 Direct selesai. ${pushedCount} item delta terenkripsi dikirim${tombstoneCount > 0 ? ` dan ${tombstoneCount} tombstone diperbarui` : ""}.`;

    if (preservedRemoteCount > 0) {
      message += ` ${preservedRemoteCount} item remote yang belum pernah ditarik ke browser ini dibiarkan aman sampai kamu pull.`;
    }
    if (detectedConflicts.length > 0) {
      message += ` ${detectedConflicts.length} konflik remote terdeteksi dan push berisiko diblokir untuk record tersebut.`;
    }

    return {
      ok: true,
      message,
      checkedAt,
      pushedCount,
      tombstoneCount,
      preservedRemoteCount,
      conflictCount: detectedConflicts.length,
      syncState: nextSyncState,
    };
  } catch (error) {
    return {
      ok: false,
      message: mapD1DirectSyncError("push", error, endpoint, accessToken),
      checkedAt,
      pushedCount: 0,
      tombstoneCount: 0,
      preservedRemoteCount: 0,
      conflictCount: 0,
      syncState: input.vaultData.syncState,
    };
  }
}

export interface D1DirectConflictResolutionResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  items: VaultItem[];
  syncState: VaultSyncState;
}

export async function resolveD1DirectSyncConflict(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
  conflictId: string;
  resolution: SyncConflictResolution;
}): Promise<D1DirectConflictResolutionResult> {
  const checkedAt = new Date().toISOString();
  const { endpoint, accessToken } = await createD1DirectClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureD1DirectSchema(endpoint, accessToken);
    const remoteRecords = await listRemoteRecords(endpoint, accessToken);
    const conflict = input.vaultData.syncState.conflicts.find((entry) =>
      entry.conflictId === input.conflictId
      && entry.status === "unresolved"
      && entry.providerType === "external_d1_direct"
      && entry.providerProfileId === input.syncProfile.profileId,
    );
    const remoteRecord = conflict ? remoteRecords.find((record) => record.recordId === conflict.recordId) ?? null : null;
    const remoteItem = remoteRecord?.deletedAt === null
      ? await decryptVaultItemRecord(input.rootKeyBase64, remoteRecord)
      : null;
    const result = applySyncConflictResolution({
      vaultData: input.vaultData,
      providerType: "external_d1_direct",
      profileId: input.syncProfile.profileId,
      conflictId: input.conflictId,
      resolution: input.resolution,
      remoteRecords,
      remoteItem,
      checkedAt,
    });

    if (!result.ok || !result.resolvedConflict) {
      return {
        ok: false,
        message: result.message,
        checkedAt,
        items: input.vaultData.items,
        syncState: input.vaultData.syncState,
      };
    }

    const deviceId = getManualSyncDeviceId();
    const journalEvent = createSyncJournalEvent({
      recordId: result.resolvedConflict.recordId,
      providerProfileId: input.syncProfile.profileId,
      sourceDeviceId: deviceId,
      operation: "resolve",
      status: "resolved",
      createdAt: checkedAt,
      baseVersion: conflict?.localVersion ?? null,
      resultVersion: remoteRecord?.version ?? conflict?.remoteVersion ?? null,
      baseContentHash: conflict?.localContentHash ?? null,
      resultContentHash: remoteRecord?.contentHash ?? conflict?.remoteContentHash ?? null,
      remoteUpdatedAt: remoteRecord?.deletedAt ?? remoteRecord?.updatedAt ?? conflict?.remoteUpdatedAt ?? null,
      conflictId: result.resolvedConflict.conflictId,
      metadata: {
        provider: "external_d1_direct",
        resolution: input.resolution,
        appliedBy: "explicit_sync_conflict_action",
      },
    });
    const statements: D1DirectStatement[] = [
      statement(
        "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
        [checkedAt, input.resolution, result.resolvedConflict.conflictId, input.syncProfile.profileId],
      ),
    ];
    appendSyncJournalStatement(statements, journalEvent);
    appendSyncDeviceCursorStatement({
      statements,
      deviceId,
      profileId: input.syncProfile.profileId,
      lastRemoteUpdatedAt: remoteRecord ? (remoteRecord.deletedAt ?? remoteRecord.updatedAt) : null,
      lastJournalEvent: journalEvent,
      updatedAt: checkedAt,
    });
    await executeD1DirectStatements({ endpoint, accessToken, statements });

    return {
      ok: true,
      message: result.message,
      checkedAt,
      items: result.items,
      syncState: result.syncState,
    };
  } catch (error) {
    return {
      ok: false,
      message: mapD1DirectSyncError("pull", error, endpoint, accessToken),
      checkedAt,
      items: input.vaultData.items,
      syncState: input.vaultData.syncState,
    };
  }
}

export async function pullVaultSnapshotFromD1Direct(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}): Promise<D1DirectPullResult> {
  const checkedAt = new Date().toISOString();
  const { endpoint, accessToken } = await createD1DirectClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureD1DirectSchema(endpoint, accessToken);
    const remoteRecords = await listRemoteRecords(endpoint, accessToken);
    const deviceId = getManualSyncDeviceId();
    const remoteItemMap = new Map<string, VaultItem>();
    const remoteActiveRecords = remoteRecords
      .filter((record) => record.deletedAt === null)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.recordId.localeCompare(right.recordId));

    for (const record of remoteActiveRecords) {
      remoteItemMap.set(record.recordId, await decryptVaultItemRecord(input.rootKeyBase64, record));
    }

    const localItems = input.vaultData.items.map((item) => item);
    const localItemMap = new Map(localItems.map((item) => [getManualSyncRecordId(item), item] as const));
    const currentD1DirectState = getD1DirectState(input.vaultData.syncState, input.syncProfile.profileId);
    const knownRemoteMap = new Map((currentD1DirectState?.knownRemoteRecords ?? []).map((record) => [record.recordId, record] as const));
    const existingConflictIds = new Set(
      input.vaultData.syncState.conflicts
        .filter((conflict) =>
          conflict.status === "unresolved"
          && conflict.providerType === "external_d1_direct"
          && conflict.providerProfileId === input.syncProfile.profileId,
        )
        .map((conflict) => conflict.conflictId),
    );
    const knownRemoteIds = new Set(knownRemoteMap.keys());
    const pullJournalEvents: SyncJournalEventRow[] = [];
    const detectedConflicts: VaultSyncConflict[] = [];
    const newConflictRows: VaultSyncConflict[] = [];

    const orderedRecordIds: string[] = [];
    const seenRecordIds = new Set<string>();
    for (const item of localItems) {
      const recordId = getManualSyncRecordId(item);
      if (!seenRecordIds.has(recordId)) {
        orderedRecordIds.push(recordId);
        seenRecordIds.add(recordId);
      }
    }
    for (const record of remoteRecords) {
      if (!seenRecordIds.has(record.recordId)) {
        orderedRecordIds.push(record.recordId);
        seenRecordIds.add(record.recordId);
      }
    }

    const mergedItems: VaultItem[] = [];
    let mergedCount = 0;
    let deletedCount = 0;
    let preservedLocalCount = 0;

    for (const recordId of orderedRecordIds) {
      const localItem = localItemMap.get(recordId);
      const remoteRecord = remoteRecords.find((entry) => entry.recordId === recordId);
      const remoteItem = remoteItemMap.get(recordId);

      if (localItem && remoteItem && remoteRecord) {
        const merged = chooseMergedItem(localItem, remoteItem, remoteRecord);
        const knownRemote = knownRemoteMap.get(recordId);
        const remoteChangedSinceKnown = hasRemoteChangedSinceKnown(knownRemote, remoteRecord);
        mergedItems.push(merged.item);
        if (merged.winner === "remote") {
          mergedCount += 1;
          if (remoteChangedSinceKnown) {
            pullJournalEvents.push(createSyncJournalEvent({
              recordId,
              providerProfileId: input.syncProfile.profileId,
              sourceDeviceId: deviceId,
              operation: "pull",
              status: "applied",
              createdAt: checkedAt,
              baseVersion: knownRemote?.version ?? null,
              resultVersion: remoteRecord.version,
              baseContentHash: knownRemote?.contentHash ?? null,
              resultContentHash: remoteRecord.contentHash,
              remoteUpdatedAt: remoteRecord.updatedAt,
              metadata: {
                provider: "external_d1_direct",
                mergeWinner: "remote",
              },
            }));
          }
        } else {
          preservedLocalCount += 1;
          if (remoteChangedSinceKnown) {
            const conflict = createD1DirectSyncConflict({
              profileId: input.syncProfile.profileId,
              recordId,
              operation: "upsert",
              reason: "remote_changed_before_push",
              localContentHash: knownRemote?.contentHash ?? getManualSyncRecordId(localItem),
              knownRemote,
              remoteRecord,
              detectedAt: checkedAt,
            });
            detectedConflicts.push(conflict);
            if (!existingConflictIds.has(conflict.conflictId)) {
              newConflictRows.push(conflict);
              existingConflictIds.add(conflict.conflictId);
            }
            pullJournalEvents.push(createSyncJournalEvent({
              recordId,
              providerProfileId: input.syncProfile.profileId,
              sourceDeviceId: deviceId,
              operation: "pull",
              status: "skipped",
              createdAt: checkedAt,
              baseVersion: knownRemote?.version ?? null,
              resultVersion: remoteRecord.version,
              baseContentHash: knownRemote?.contentHash ?? null,
              resultContentHash: remoteRecord.contentHash,
              remoteUpdatedAt: remoteRecord.updatedAt,
              metadata: {
                provider: "external_d1_direct",
                mergeWinner: "local",
              },
            }));
          }
        }
        continue;
      }

      if (remoteItem) {
        mergedItems.push(remoteItem);
        mergedCount += 1;
        if (remoteRecord && hasRemoteChangedSinceKnown(knownRemoteMap.get(recordId), remoteRecord)) {
          pullJournalEvents.push(createSyncJournalEvent({
            recordId,
            providerProfileId: input.syncProfile.profileId,
            sourceDeviceId: deviceId,
            operation: "pull",
            status: "applied",
            createdAt: checkedAt,
            baseVersion: null,
            resultVersion: remoteRecord.version,
            baseContentHash: null,
            resultContentHash: remoteRecord.contentHash,
            remoteUpdatedAt: remoteRecord.updatedAt,
            metadata: {
              provider: "external_d1_direct",
              mergeWinner: "remote_new",
            },
          }));
        }
        continue;
      }

      if (!localItem) {
        continue;
      }

      if (remoteRecord?.deletedAt) {
        const knownRemote = knownRemoteMap.get(recordId);
        const remoteChangedSinceKnown = hasRemoteChangedSinceKnown(knownRemote, remoteRecord);
        const localModifiedMs = getItemModifiedMs(localItem);
        const remoteDeletedMs = parseSyncTimestamp(remoteRecord.deletedAt);
        if ((knownRemoteIds.has(recordId) || input.vaultData.syncState.pendingLocalDeletes.some((entry) => entry.recordId === recordId))
          && remoteDeletedMs >= localModifiedMs) {
          deletedCount += 1;
          if (remoteChangedSinceKnown) {
            pullJournalEvents.push(createSyncJournalEvent({
              recordId,
              providerProfileId: input.syncProfile.profileId,
              sourceDeviceId: deviceId,
              operation: "pull",
              status: "applied",
              createdAt: checkedAt,
              baseVersion: knownRemote?.version ?? null,
              resultVersion: remoteRecord.version,
              baseContentHash: knownRemote?.contentHash ?? null,
              resultContentHash: remoteRecord.contentHash,
              remoteUpdatedAt: remoteRecord.deletedAt,
              metadata: {
                provider: "external_d1_direct",
                remoteOperation: "delete",
              },
            }));
          }
          continue;
        }

        if (remoteChangedSinceKnown) {
          const conflict = createD1DirectSyncConflict({
            profileId: input.syncProfile.profileId,
            recordId,
            operation: "upsert",
            reason: "remote_deleted_before_push",
            localContentHash: knownRemote?.contentHash ?? getManualSyncRecordId(localItem),
            knownRemote,
            remoteRecord,
            detectedAt: checkedAt,
          });
          detectedConflicts.push(conflict);
          if (!existingConflictIds.has(conflict.conflictId)) {
            newConflictRows.push(conflict);
            existingConflictIds.add(conflict.conflictId);
          }
          pullJournalEvents.push(createSyncJournalEvent({
            recordId,
            providerProfileId: input.syncProfile.profileId,
            sourceDeviceId: deviceId,
            operation: "pull",
            status: "skipped",
            createdAt: checkedAt,
            baseVersion: knownRemote?.version ?? null,
            resultVersion: remoteRecord.version,
            baseContentHash: knownRemote?.contentHash ?? null,
            resultContentHash: remoteRecord.contentHash,
            remoteUpdatedAt: remoteRecord.deletedAt,
            metadata: {
              provider: "external_d1_direct",
              remoteOperation: "delete",
              mergeWinner: "local",
            },
          }));
        }
      }

      mergedItems.push(localItem);
      preservedLocalCount += 1;
    }

    const clearedDeleteIds = new Set(remoteRecords.filter((record) => record.deletedAt !== null).map((record) => record.recordId));
    const nextSyncState = buildNextSyncState({
      currentSyncState: input.vaultData.syncState,
      profileId: input.syncProfile.profileId,
      remoteRecords,
      lastPulledAt: checkedAt,
      lastMergedAt: checkedAt,
      clearedDeleteIds,
      conflicts: detectedConflicts,
    });

    if (pullJournalEvents.length > 0 || newConflictRows.length > 0) {
      const statements: D1DirectStatement[] = [];
      for (const conflict of newConflictRows) {
        appendSyncConflictStatement(statements, conflict);
      }
      for (const event of pullJournalEvents) {
        appendSyncJournalStatement(statements, event);
      }
      const newestRemoteRecord = [...remoteRecords].sort((left, right) =>
        (right.deletedAt ?? right.updatedAt).localeCompare(left.deletedAt ?? left.updatedAt),
      )[0];
      appendSyncDeviceCursorStatement({
        statements,
        deviceId,
        profileId: input.syncProfile.profileId,
        lastRemoteUpdatedAt: newestRemoteRecord ? (newestRemoteRecord.deletedAt ?? newestRemoteRecord.updatedAt) : null,
        lastJournalEvent: pullJournalEvents[pullJournalEvents.length - 1] ?? null,
        updatedAt: checkedAt,
      });
      await executeD1DirectStatements({ endpoint, accessToken, statements });
    }

    let message: string;
    if (remoteActiveRecords.length === 0 && mergedItems.length === input.vaultData.items.length) {
      message = mergedItems.length > 0
        ? "Vault D1 Direct belum berisi item aktif. Item lokal dipertahankan di browser ini."
        : "Vault D1 Direct belum berisi item aktif.";
    } else {
      message = `Pull dari D1 Direct selesai. ${mergedCount} item remote dimuat${deletedCount > 0 ? `, ${deletedCount} delete remote diterapkan` : ""}${preservedLocalCount > 0 ? `, ${preservedLocalCount} item lokal dipertahankan` : ""}.`;
    }

    return {
      ok: true,
      message,
      checkedAt,
      items: mergedItems,
      remoteActiveCount: remoteActiveRecords.length,
      mergedCount,
      deletedCount,
      preservedLocalCount,
      syncState: nextSyncState,
    };
  } catch (error) {
    return {
      ok: false,
      message: mapD1DirectSyncError("pull", error, endpoint, accessToken),
      checkedAt,
      items: input.vaultData.items,
      remoteActiveCount: 0,
      mergedCount: 0,
      deletedCount: 0,
      preservedLocalCount: 0,
      syncState: input.vaultData.syncState,
    };
  }
}

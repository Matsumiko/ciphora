import { decryptCiphoraSyncProfileConfig, type SyncProfile } from "./account-client";
import { fetchD1BridgeJson, sanitizeD1BridgeErrorMessage } from "./d1-bridge-client";
import {
  chooseMergedItem,
  decryptVaultItemRecord,
  encryptVaultItemRecord,
  getItemModifiedMs,
  getManualSyncDeviceId,
  getManualSyncRecordId,
  normalizeVaultItem,
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
import { getSyncProviderDisplayLabel, isBridgeSyncProvider, type SyncProviderType } from "./sync-providers";
import type { VaultItem } from "../sections/ItemModal";

const CURSOR_NAME = "manual_snapshot";
const SYNC_JOURNAL_METADATA_MAX_CHARS = 2048;

class D1BridgeSyncHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "D1BridgeSyncHttpError";
    this.status = status;
  }
}

interface D1BridgePushRecord {
  recordId: string;
  recordKind: string;
  algorithm: string;
  iv: string;
  ciphertext: string;
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface D1BridgePushTombstone {
  recordId: string;
  deletedAt: string;
  version: number;
  contentHash: string;
  sourceDeviceId: string;
}

interface D1BridgeJournalEvent {
  eventId: string;
  recordId: string;
  providerProfileId: string;
  sourceDeviceId: string;
  operation: "upsert" | "delete" | "pull" | "conflict" | "resolve";
  baseVersion: number | null;
  resultVersion: number | null;
  baseContentHash: string | null;
  resultContentHash: string | null;
  remoteUpdatedAt: string | null;
  createdAt: string;
  status: "applied" | "skipped" | "conflict" | "resolved";
  conflictId: string | null;
  metadataJson: string | null;
}

interface D1BridgeConflictPayload {
  conflictId: string;
  recordId: string;
  providerProfileId: string;
  localContentHash: string;
  remoteContentHash: string;
  localVersion: number | null;
  remoteVersion: number | null;
  detectedAt: string;
}

interface D1BridgeResolvedConflictPayload {
  conflictId: string;
  providerProfileId: string;
  resolvedAt: string;
  resolution: SyncConflictResolution;
}

export interface D1BridgePushResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  pushedCount: number;
  tombstoneCount: number;
  preservedRemoteCount: number;
  conflictCount: number;
  syncState: VaultSyncState;
}

export interface D1BridgePullResult {
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

function getD1BridgeState(syncState: VaultSyncState, profileId: string) {
  return syncState.d1Bridge?.profileId === profileId ? syncState.d1Bridge : null;
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
  const currentD1Bridge = getD1BridgeState(input.currentSyncState, input.profileId);
  const knownRemoteRecords = Array.from(input.remoteRecords, toKnownRemoteRecord)
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  const pendingLocalDeletes = input.currentSyncState.pendingLocalDeletes
    .filter((entry) => !input.clearedDeleteIds?.has(entry.recordId))
    .slice(0, 512);

  return {
    pendingLocalDeletes,
    conflicts: mergeVaultSyncConflicts(input.currentSyncState.conflicts, input.conflicts ?? []),
    turso: input.currentSyncState.turso,
    d1Direct: input.currentSyncState.d1Direct,
    d1Bridge: {
      profileId: input.profileId,
      knownRemoteRecords,
      lastPulledAt: input.lastPulledAt ?? currentD1Bridge?.lastPulledAt,
      lastPushedAt: input.lastPushedAt ?? currentD1Bridge?.lastPushedAt,
      lastMergedAt: input.lastMergedAt ?? currentD1Bridge?.lastMergedAt,
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

function createD1BridgeSyncConflict(input: {
  providerType: SyncProviderType;
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
    providerType: input.providerType,
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

function toD1BridgeConflictPayload(conflict: VaultSyncConflict): D1BridgeConflictPayload {
  return {
    conflictId: conflict.conflictId,
    recordId: conflict.recordId,
    providerProfileId: conflict.providerProfileId,
    localContentHash: conflict.localContentHash,
    remoteContentHash: conflict.remoteContentHash,
    localVersion: conflict.localVersion,
    remoteVersion: conflict.remoteVersion,
    detectedAt: conflict.detectedAt,
  };
}

function createBridgeJournalEvent(input: {
  recordId: string;
  providerProfileId: string;
  sourceDeviceId: string;
  operation: D1BridgeJournalEvent["operation"];
  status: D1BridgeJournalEvent["status"];
  createdAt: string;
  baseVersion?: number | null;
  resultVersion?: number | null;
  baseContentHash?: string | null;
  resultContentHash?: string | null;
  remoteUpdatedAt?: string | null;
  conflictId?: string | null;
  metadata?: Record<string, unknown>;
}): D1BridgeJournalEvent {
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

async function createD1BridgeClient(rootKeyBase64: string, syncProfile: SyncProfile) {
  const config = await decryptCiphoraSyncProfileConfig({
    rootKeyBase64,
    syncProfile,
  });

  if (!isBridgeSyncProvider(config.providerType)) {
    throw new Error("Manual vault sync is only available for Ciphora HTTP Bridge profiles in this build.");
  }

  return {
    endpoint: config.endpoint,
    accessToken: config.accessToken,
  };
}

async function ensureD1BridgeSchema(endpoint: string, accessToken: string) {
  const { response, body } = await fetchD1BridgeJson({
    endpoint,
    accessToken,
    routePath: "/schema/apply",
    method: "POST",
    body: {},
  });

  if (!response.ok || body?.ok === false) {
    throw new D1BridgeSyncHttpError(response.status, typeof body?.error === "string" ? body.error : "schema_apply_failed");
  }
}

function validateRemoteRecord(record: Record<string, unknown>): ManualSyncRemoteRecord | null {
  const recordId = typeof record.recordId === "string" ? record.recordId : "";
  const algorithm = typeof record.algorithm === "string" ? record.algorithm : "";
  const iv = typeof record.iv === "string" ? record.iv : "";
  const ciphertext = typeof record.ciphertext === "string" ? record.ciphertext : "";
  const contentHash = typeof record.contentHash === "string" ? record.contentHash : "";
  const version = typeof record.version === "number" ? record.version : Number(record.version ?? 0);
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : "";
  const deletedAt = record.deletedAt === null || record.deletedAt === undefined
    ? null
    : typeof record.deletedAt === "string"
      ? record.deletedAt
      : null;

  if (!recordId || !algorithm || !iv || !ciphertext || !contentHash || !createdAt || !updatedAt || !Number.isFinite(version) || version < 1) {
    return null;
  }

  return {
    recordId,
    algorithm,
    iv,
    ciphertext,
    contentHash,
    version,
    createdAt,
    updatedAt,
    deletedAt,
  };
}

async function listRemoteRecords(endpoint: string, accessToken: string) {
  const { response, body } = await fetchD1BridgeJson({
    endpoint,
    accessToken,
    routePath: "/records",
  });

  if (!response.ok || body?.ok === false) {
    throw new D1BridgeSyncHttpError(response.status, typeof body?.error === "string" ? body.error : "records_fetch_failed");
  }

  if (!body || !Array.isArray(body.records)) {
    throw new Error("invalid_records_payload");
  }

  return body.records
    .map((entry) => (entry && typeof entry === "object" ? validateRemoteRecord(entry as Record<string, unknown>) : null))
    .filter((entry): entry is ManualSyncRemoteRecord => !!entry)
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
}

async function pushBridgeChanges(input: {
  endpoint: string;
  accessToken: string;
  checkedAt: string;
  deviceId: string;
  records: D1BridgePushRecord[];
  tombstones: D1BridgePushTombstone[];
  deleteTombstonesForRecordIds: string[];
  conflicts: D1BridgeConflictPayload[];
  resolvedConflicts?: D1BridgeResolvedConflictPayload[];
  journalEvents: D1BridgeJournalEvent[];
  preservedRemoteCount: number;
}) {
  const { response, body } = await fetchD1BridgeJson({
    endpoint: input.endpoint,
    accessToken: input.accessToken,
    routePath: "/sync/push",
    method: "POST",
    body: {
      device: {
        deviceId: input.deviceId,
        deviceLabel: "Ciphora Web Vault",
        checkedAt: input.checkedAt,
      },
      records: input.records,
      tombstones: input.tombstones,
      deleteTombstonesForRecordIds: input.deleteTombstonesForRecordIds,
      conflicts: input.conflicts,
      resolvedConflicts: input.resolvedConflicts ?? [],
      journalEvents: input.journalEvents,
      cursor: {
        name: CURSOR_NAME,
        value: JSON.stringify({
          syncedAt: input.checkedAt,
          pushedCount: input.records.length,
          tombstoneCount: input.tombstones.length,
          preservedRemoteCount: input.preservedRemoteCount,
          conflictCount: input.conflicts.length,
          sourceDeviceId: input.deviceId,
        }),
        updatedAt: input.checkedAt,
      },
    },
  });

  if (!response.ok || body?.ok === false) {
    throw new D1BridgeSyncHttpError(response.status, typeof body?.error === "string" ? body.error : "sync_push_failed");
  }
}

function mapD1BridgeSyncError(action: "push" | "pull", error: unknown, endpoint: string, accessToken: string, providerLabel: string) {
  const message = sanitizeD1BridgeErrorMessage(error, endpoint, accessToken);
  const lowerMessage = message.toLowerCase();

  if (error instanceof D1BridgeSyncHttpError) {
    if (error.status === 401 || error.status === 403) {
      return `Token ${providerLabel} ditolak saat sinkronisasi. Periksa Bearer token worker bridge.`;
    }
    if (error.status === 404) {
      return `Kontrak endpoint ${providerLabel} belum lengkap. Pastikan bridge memakai route /health, /schema/apply, /records, dan /sync/push.`;
    }
  }

  if (lowerMessage.includes("abort") || lowerMessage.includes("timeout")) {
    return `Sinkronisasi ${providerLabel} habis waktu saat ${action === "push" ? "push" : "pull"}. Coba lagi sebentar lagi.`;
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network") || lowerMessage.includes("cors")) {
    return `Browser tidak bisa menjangkau ${providerLabel} untuk sinkronisasi. Cek URL bridge, jaringan, atau aturan CORS.`;
  }
  if (lowerMessage.includes("http or https")) {
    return `URL ${providerLabel} harus memakai http atau https.`;
  }
  if (lowerMessage.includes("invalid") || lowerMessage.includes("decrypt")) {
    return `Data sync ${providerLabel} tidak valid atau gagal didekripsi dengan vault key aktif.`;
  }

  return `Sinkronisasi ${providerLabel} gagal: ${message}`;
}

export async function pushVaultSnapshotToD1Bridge(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}): Promise<D1BridgePushResult> {
  const checkedAt = new Date().toISOString();
  const providerType = input.syncProfile.providerType;
  const providerLabel = getSyncProviderDisplayLabel(providerType);
  const { endpoint, accessToken } = await createD1BridgeClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureD1BridgeSchema(endpoint, accessToken);
    const remoteRecords = await listRemoteRecords(endpoint, accessToken);
    const activeRemoteRecords = remoteRecords.filter((record) => record.deletedAt === null);
    const localItems = input.vaultData.items.map(normalizeVaultItem);
    const localRecordIds = new Set(localItems.map((item) => getManualSyncRecordId(item)));
    const deviceId = getManualSyncDeviceId();
    const currentD1BridgeState = getD1BridgeState(input.vaultData.syncState, input.syncProfile.profileId);
    const knownRemoteMap = new Map(
      (currentD1BridgeState?.knownRemoteRecords ?? []).map((record) => [record.recordId, record] as const),
    );
    const existingConflicts = input.vaultData.syncState.conflicts
      .filter((conflict) =>
        conflict.status === "unresolved"
        && conflict.providerType === providerType
        && conflict.providerProfileId === input.syncProfile.profileId,
      );
    const existingConflictIds = new Set(existingConflicts.map((conflict) => conflict.conflictId));
    const existingConflictByRecordId = new Map(
      existingConflicts.map((conflict) => [conflict.recordId, conflict] as const),
    );
    const knownActiveRemoteIds = new Set(
      (currentD1BridgeState?.knownRemoteRecords ?? [])
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
    const records: D1BridgePushRecord[] = [];
    const tombstones: D1BridgePushTombstone[] = [];
    const deleteTombstonesForRecordIds: string[] = [];
    const journalEvents: D1BridgeJournalEvent[] = [];
    const resolvedConflicts: D1BridgeResolvedConflictPayload[] = [];
    const detectedConflicts: VaultSyncConflict[] = [];
    const newConflictRows: VaultSyncConflict[] = [];

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
          providerType,
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
        const conflict = createD1BridgeSyncConflict({
          providerType,
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
          journalEvents.push(createBridgeJournalEvent({
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
              provider: providerType,
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
        nextRemoteStateMap.set(encryptedRecord.recordId, {
          recordId: encryptedRecord.recordId,
          version: currentRecord.version,
          updatedAt: currentRecord.updatedAt,
          deletedAt: null,
          contentHash: currentRecord.contentHash,
        });
        continue;
      }

      const nextVersion = (currentRecord?.version ?? 0) + 1;
      const createdAt = currentRecord?.createdAt || checkedAt;
      journalEvents.push(createBridgeJournalEvent({
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
          provider: providerType,
          syncMode: "manual_or_auto_delta",
        },
      }));
      if (overwriteGrant) {
        journalEvents.push(createBridgeJournalEvent({
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
            provider: providerType,
            resolution: overwriteGrant.resolution,
            appliedBy: "local_overwrite_grant",
          },
        }));
        resolvedConflicts.push({
          conflictId: overwriteGrant.conflictId,
          providerProfileId: input.syncProfile.profileId,
          resolvedAt: checkedAt,
          resolution: overwriteGrant.resolution ?? "keep_local",
        });
      }

      records.push({
        recordId: encryptedRecord.recordId,
        recordKind: "vault_item",
        algorithm: encryptedRecord.algorithm,
        iv: encryptedRecord.iv,
        ciphertext: encryptedRecord.ciphertext,
        contentHash: encryptedRecord.contentHash,
        version: nextVersion,
        createdAt,
        updatedAt: checkedAt,
      });
      deleteTombstonesForRecordIds.push(encryptedRecord.recordId);
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
        providerType,
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
        const conflict = createD1BridgeSyncConflict({
          providerType,
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
          journalEvents.push(createBridgeJournalEvent({
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
              provider: providerType,
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

      const nextVersion = remoteRecord.version + 1;
      journalEvents.push(createBridgeJournalEvent({
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
          provider: providerType,
          syncMode: "known_delete_tombstone",
        },
      }));
      if (overwriteGrant) {
        journalEvents.push(createBridgeJournalEvent({
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
            provider: providerType,
            resolution: overwriteGrant.resolution,
            appliedBy: "local_delete_grant",
          },
        }));
        resolvedConflicts.push({
          conflictId: overwriteGrant.conflictId,
          providerProfileId: input.syncProfile.profileId,
          resolvedAt: checkedAt,
          resolution: overwriteGrant.resolution ?? "keep_local",
        });
      }
      tombstones.push({
        recordId: remoteRecord.recordId,
        deletedAt: checkedAt,
        version: nextVersion,
        contentHash: remoteRecord.contentHash,
        sourceDeviceId: deviceId,
      });
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

    if (records.length === 0 && tombstones.length === 0 && newConflictRows.length === 0) {
      let message = `Push ke ${providerLabel} selesai. Tidak ada delta lokal yang perlu dikirim.`;
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
        pushedCount: 0,
        tombstoneCount: 0,
        preservedRemoteCount,
        conflictCount: detectedConflicts.length,
        syncState: nextSyncState,
      };
    }

    await pushBridgeChanges({
      endpoint,
      accessToken,
      checkedAt,
      deviceId,
      records,
      tombstones,
      deleteTombstonesForRecordIds,
      conflicts: newConflictRows.map(toD1BridgeConflictPayload),
      resolvedConflicts,
      journalEvents,
      preservedRemoteCount,
    });

    let message = records.length === 0 && tombstones.length > 0
      ? `Push ke ${providerLabel} selesai. ${tombstones.length} delete lokal yang sudah diketahui provider diterapkan dengan aman.`
      : `Push ke ${providerLabel} selesai. ${records.length} item delta terenkripsi dikirim${tombstones.length > 0 ? ` dan ${tombstones.length} tombstone diperbarui` : ""}.`;

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
      pushedCount: records.length,
      tombstoneCount: tombstones.length,
      preservedRemoteCount,
      conflictCount: detectedConflicts.length,
      syncState: nextSyncState,
    };
  } catch (error) {
    return {
      ok: false,
      message: mapD1BridgeSyncError("push", error, endpoint, accessToken, providerLabel),
      checkedAt,
      pushedCount: 0,
      tombstoneCount: 0,
      preservedRemoteCount: 0,
      conflictCount: 0,
      syncState: input.vaultData.syncState,
    };
  }
}

export interface D1BridgeConflictResolutionResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  items: VaultItem[];
  syncState: VaultSyncState;
}

export async function resolveD1BridgeSyncConflict(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
  conflictId: string;
  resolution: SyncConflictResolution;
}): Promise<D1BridgeConflictResolutionResult> {
  const checkedAt = new Date().toISOString();
  const providerType = input.syncProfile.providerType;
  const providerLabel = getSyncProviderDisplayLabel(providerType);
  const { endpoint, accessToken } = await createD1BridgeClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureD1BridgeSchema(endpoint, accessToken);
    const remoteRecords = await listRemoteRecords(endpoint, accessToken);
    const conflict = input.vaultData.syncState.conflicts.find((entry) =>
      entry.conflictId === input.conflictId
      && entry.status === "unresolved"
      && entry.providerType === providerType
      && entry.providerProfileId === input.syncProfile.profileId,
    );
    const remoteRecord = conflict ? remoteRecords.find((record) => record.recordId === conflict.recordId) ?? null : null;
    const remoteItem = remoteRecord?.deletedAt === null
      ? await decryptVaultItemRecord(input.rootKeyBase64, remoteRecord)
      : null;
    const result = applySyncConflictResolution({
      vaultData: input.vaultData,
      providerType,
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
    const journalEvent = createBridgeJournalEvent({
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
        provider: providerType,
        resolution: input.resolution,
        appliedBy: "explicit_sync_conflict_action",
      },
    });
    await pushBridgeChanges({
      endpoint,
      accessToken,
      checkedAt,
      deviceId,
      records: [],
      tombstones: [],
      deleteTombstonesForRecordIds: [],
      conflicts: [],
      resolvedConflicts: [
        {
          conflictId: result.resolvedConflict.conflictId,
          providerProfileId: input.syncProfile.profileId,
          resolvedAt: checkedAt,
          resolution: input.resolution,
        },
      ],
      journalEvents: [journalEvent],
      preservedRemoteCount: 0,
    });

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
      message: mapD1BridgeSyncError("pull", error, endpoint, accessToken, providerLabel),
      checkedAt,
      items: input.vaultData.items,
      syncState: input.vaultData.syncState,
    };
  }
}

export async function pullVaultSnapshotFromD1Bridge(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}): Promise<D1BridgePullResult> {
  const checkedAt = new Date().toISOString();
  const providerType = input.syncProfile.providerType;
  const providerLabel = getSyncProviderDisplayLabel(providerType);
  const { endpoint, accessToken } = await createD1BridgeClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureD1BridgeSchema(endpoint, accessToken);
    const remoteRecords = await listRemoteRecords(endpoint, accessToken);
    const remoteItemMap = new Map<string, VaultItem>();
    const remoteActiveRecords = remoteRecords
      .filter((record) => record.deletedAt === null)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.recordId.localeCompare(right.recordId));

    for (const record of remoteActiveRecords) {
      remoteItemMap.set(record.recordId, await decryptVaultItemRecord(input.rootKeyBase64, record));
    }

    const localItems = input.vaultData.items.map(normalizeVaultItem);
    const localItemMap = new Map(localItems.map((item) => [getManualSyncRecordId(item), item] as const));
    const currentD1BridgeState = getD1BridgeState(input.vaultData.syncState, input.syncProfile.profileId);
    const knownRemoteMap = new Map((currentD1BridgeState?.knownRemoteRecords ?? []).map((record) => [record.recordId, record] as const));
    const existingConflictIds = new Set(
      input.vaultData.syncState.conflicts
        .filter((conflict) =>
          conflict.status === "unresolved"
          && conflict.providerType === providerType
          && conflict.providerProfileId === input.syncProfile.profileId,
        )
        .map((conflict) => conflict.conflictId),
    );
    const knownRemoteIds = new Set(knownRemoteMap.keys());
    const detectedConflicts: VaultSyncConflict[] = [];

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
        } else {
          preservedLocalCount += 1;
          if (remoteChangedSinceKnown) {
            const conflict = createD1BridgeSyncConflict({
              providerType,
              profileId: input.syncProfile.profileId,
              recordId,
              operation: "upsert",
              reason: "remote_changed_before_push",
              localContentHash: knownRemote?.contentHash ?? getManualSyncRecordId(localItem),
              knownRemote,
              remoteRecord,
              detectedAt: checkedAt,
            });
            if (!existingConflictIds.has(conflict.conflictId)) {
              detectedConflicts.push(conflict);
              existingConflictIds.add(conflict.conflictId);
            }
          }
        }
        continue;
      }

      if (remoteItem) {
        mergedItems.push(remoteItem);
        mergedCount += 1;
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
          continue;
        }
        if (remoteChangedSinceKnown) {
          const conflict = createD1BridgeSyncConflict({
            providerType,
            profileId: input.syncProfile.profileId,
            recordId,
            operation: "upsert",
            reason: "remote_deleted_before_push",
            localContentHash: knownRemote?.contentHash ?? getManualSyncRecordId(localItem),
            knownRemote,
            remoteRecord,
            detectedAt: checkedAt,
          });
          if (!existingConflictIds.has(conflict.conflictId)) {
            detectedConflicts.push(conflict);
            existingConflictIds.add(conflict.conflictId);
          }
        }
      }

      mergedItems.push(localItem);
      preservedLocalCount += 1;
    }

    const clearedDeleteIds = new Set(
      remoteRecords
        .filter((record) => record.deletedAt !== null)
        .map((record) => record.recordId),
    );
    const nextSyncState = buildNextSyncState({
      currentSyncState: input.vaultData.syncState,
      profileId: input.syncProfile.profileId,
      remoteRecords,
      lastPulledAt: checkedAt,
      lastMergedAt: checkedAt,
      clearedDeleteIds,
      conflicts: detectedConflicts,
    });

    let message: string;
    if (remoteActiveRecords.length === 0 && mergedItems.length === input.vaultData.items.length) {
      message = mergedItems.length > 0
        ? `Vault ${providerLabel} belum berisi item aktif. Item lokal dipertahankan di browser ini.`
        : `Vault ${providerLabel} belum berisi item aktif.`;
    } else {
      message = `Pull dari ${providerLabel} selesai. ${mergedCount} item remote dimuat${deletedCount > 0 ? `, ${deletedCount} delete remote diterapkan` : ""}${preservedLocalCount > 0 ? `, ${preservedLocalCount} item lokal dipertahankan` : ""}.`;
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
      message: mapD1BridgeSyncError("pull", error, endpoint, accessToken, providerLabel),
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

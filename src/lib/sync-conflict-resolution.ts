import {
  getManualSyncRecordId,
  normalizeVaultItem,
  toKnownRemoteRecord,
  type ManualSyncRemoteRecord,
} from "./manual-vault-sync-core";
import {
  generateVaultId,
  type VaultData,
  type VaultSyncConflict,
  type VaultSyncConflictProvider,
  type VaultSyncConflictResolution,
  type VaultSyncState,
} from "./vault-storage";
import type { SyncProviderType } from "./account-client";
import { isBridgeSyncProvider } from "./sync-providers";
import type { VaultItem } from "../sections/ItemModal";

export type SyncConflictResolution = VaultSyncConflictResolution;

export interface ApplySyncConflictResolutionResult {
  ok: boolean;
  message: string;
  items: VaultItem[];
  syncState: VaultSyncState;
  resolvedConflict?: VaultSyncConflict;
}

function getProviderStateKey(providerType: SyncProviderType) {
  if (providerType === "external_turso") return "turso";
  if (isBridgeSyncProvider(providerType)) return "d1Bridge";
  return "d1Direct";
}

function updateProviderKnownState(input: {
  syncState: VaultSyncState;
  providerType: SyncProviderType;
  profileId: string;
  remoteRecords: ManualSyncRemoteRecord[];
  checkedAt: string;
  markMerged: boolean;
}) {
  const providerKey = getProviderStateKey(input.providerType);
  const currentProviderState = input.syncState[providerKey];
  const knownRemoteRecords = input.remoteRecords
    .map(toKnownRemoteRecord)
    .sort((left, right) => left.recordId.localeCompare(right.recordId));

  return {
    ...input.syncState,
    [providerKey]: {
      profileId: input.profileId,
      knownRemoteRecords,
      lastPulledAt: currentProviderState?.lastPulledAt,
      lastPushedAt: currentProviderState?.lastPushedAt,
      lastMergedAt: input.markMerged ? input.checkedAt : currentProviderState?.lastMergedAt,
    },
  } satisfies VaultSyncState;
}

function markConflictResolved(input: {
  syncState: VaultSyncState;
  conflict: VaultSyncConflict;
  resolution: SyncConflictResolution;
  checkedAt: string;
}) {
  return {
    ...input.syncState,
    conflicts: input.syncState.conflicts.map((entry) =>
      entry.conflictId === input.conflict.conflictId
        ? {
          ...entry,
          status: "resolved",
          resolvedAt: input.checkedAt,
          resolution: input.resolution,
        }
        : entry,
    ),
  } satisfies VaultSyncState;
}

function removePendingDelete(syncState: VaultSyncState, recordId: string) {
  return {
    ...syncState,
    pendingLocalDeletes: syncState.pendingLocalDeletes.filter((entry) => entry.recordId !== recordId),
  } satisfies VaultSyncState;
}

function createLocalDuplicate(item: VaultItem, checkedAt: string) {
  return normalizeVaultItem({
    ...item,
    id: generateVaultId(),
    modifiedAt: checkedAt,
    updatedAt: item.type === "note" ? "just now" : item.updatedAt,
  });
}

function findConflict(input: {
  syncState: VaultSyncState;
  providerType: SyncProviderType;
  profileId: string;
  conflictId: string;
}) {
  return input.syncState.conflicts.find((conflict) =>
    conflict.conflictId === input.conflictId
    && conflict.status === "unresolved"
    && conflict.providerType === input.providerType
    && conflict.providerProfileId === input.profileId,
  );
}

export function applySyncConflictResolution(input: {
  vaultData: VaultData;
  providerType: SyncProviderType;
  profileId: string;
  conflictId: string;
  resolution: SyncConflictResolution;
  remoteRecords: ManualSyncRemoteRecord[];
  remoteItem: VaultItem | null;
  checkedAt: string;
}): ApplySyncConflictResolutionResult {
  const conflict = findConflict({
    syncState: input.vaultData.syncState,
    providerType: input.providerType,
    profileId: input.profileId,
    conflictId: input.conflictId,
  });

  if (!conflict) {
    return {
      ok: false,
      message: "Konflik tidak ditemukan atau sudah pernah di-resolve.",
      items: input.vaultData.items,
      syncState: input.vaultData.syncState,
    };
  }

  const remoteRecord = input.remoteRecords.find((record) => record.recordId === conflict.recordId) ?? null;
  const remoteIsActive = !!remoteRecord && remoteRecord.deletedAt === null && !!input.remoteItem;
  const localIndex = input.vaultData.items.findIndex((item) => getManualSyncRecordId(item) === conflict.recordId);
  const localItem = localIndex >= 0 ? input.vaultData.items[localIndex] : null;

  let nextItems = input.vaultData.items.map(normalizeVaultItem);
  let nextSyncState = updateProviderKnownState({
    syncState: input.vaultData.syncState,
    providerType: input.providerType,
    profileId: input.profileId,
    remoteRecords: input.remoteRecords,
    checkedAt: input.checkedAt,
    markMerged: input.resolution === "keep_remote" || input.resolution === "keep_both",
  });
  let message: string;

  if (input.resolution === "keep_remote") {
    nextSyncState = removePendingDelete(nextSyncState, conflict.recordId);

    if (remoteIsActive && input.remoteItem) {
      if (localIndex >= 0) {
        nextItems[localIndex] = normalizeVaultItem(input.remoteItem);
      } else {
        nextItems = [...nextItems, normalizeVaultItem(input.remoteItem)];
      }
      message = "Konflik di-resolve: versi remote dipakai sebagai item utama di browser ini.";
    } else {
      nextItems = nextItems.filter((item) => getManualSyncRecordId(item) !== conflict.recordId);
      message = "Konflik di-resolve: delete remote diterapkan ke browser ini.";
    }
  } else if (input.resolution === "keep_both") {
    if (!remoteIsActive || !input.remoteItem) {
      return {
        ok: false,
        message: "Keep both butuh record remote aktif. Untuk remote delete, pilih Keep Local atau Keep Remote.",
        items: input.vaultData.items,
        syncState: input.vaultData.syncState,
      };
    }

    nextSyncState = removePendingDelete(nextSyncState, conflict.recordId);

    if (localItem) {
      const localDuplicate = createLocalDuplicate(localItem, input.checkedAt);
      if (localIndex >= 0) {
        nextItems[localIndex] = normalizeVaultItem(input.remoteItem);
        nextItems = [...nextItems, localDuplicate];
      } else {
        nextItems = [...nextItems, normalizeVaultItem(input.remoteItem), localDuplicate];
      }
      message = "Konflik di-resolve: versi remote dipakai sebagai item utama dan versi lokal disimpan sebagai salinan baru.";
    } else {
      nextItems = [...nextItems, normalizeVaultItem(input.remoteItem)];
      message = "Konflik di-resolve: item remote dipulihkan ke browser ini.";
    }
  } else {
    const label = input.resolution === "manual_edit" ? "Manual edit" : "Keep local";
    if (input.resolution === "manual_edit" && !localItem) {
      return {
        ok: false,
        message: "Manual edit hanya tersedia untuk item lokal yang masih ada di browser ini.",
        items: input.vaultData.items,
        syncState: input.vaultData.syncState,
      };
    }
    message = `${label} dicatat. Push berikutnya boleh menulis versi lokal untuk record konflik ini jika remote masih sama dengan snapshot konflik.`;
  }

  nextSyncState = markConflictResolved({
    syncState: nextSyncState,
    conflict,
    resolution: input.resolution,
    checkedAt: input.checkedAt,
  });

  const resolvedConflict = nextSyncState.conflicts.find((entry) => entry.conflictId === conflict.conflictId);

  return {
    ok: true,
    message,
    items: nextItems,
    syncState: nextSyncState,
    resolvedConflict,
  };
}

export function findResolvedLocalOverwriteGrant(input: {
  conflicts: VaultSyncConflict[];
  providerType: VaultSyncConflictProvider;
  providerProfileId: string;
  recordId: string;
  remoteContentHash: string;
  remoteVersion: number | null;
}) {
  return input.conflicts.find((conflict) =>
    conflict.status === "resolved"
    && (conflict.resolution === "keep_local" || conflict.resolution === "manual_edit")
    && conflict.providerType === input.providerType
    && conflict.providerProfileId === input.providerProfileId
    && conflict.recordId === input.recordId
    && conflict.remoteContentHash === input.remoteContentHash
    && (conflict.remoteVersion === null || input.remoteVersion === null || conflict.remoteVersion === input.remoteVersion),
  );
}

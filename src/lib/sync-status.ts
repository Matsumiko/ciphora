import type { SyncProfile, SyncProviderType } from "./account-client";
import { getItemModifiedMs, getManualSyncRecordId } from "./manual-vault-sync-core";
import { getSyncProviderDisplayLabel, isBridgeSyncProvider } from "./sync-providers";
import type { VaultKnownRemoteRecord, VaultSyncConflict, VaultSyncState } from "./vault-storage";
import type { VaultItem } from "../sections/ItemModal";

type SyncStatusTone = "neutral" | "warning" | "success";
export type AutoSyncRuntimeStatus = "disabled" | "ready" | "scheduled" | "syncing" | "paused" | "error";

export interface AutoSyncRuntimeState {
  enabled: boolean;
  status: AutoSyncRuntimeStatus;
  message: string;
  lastAction?: "push" | "pull";
  lastActionAt?: string;
}

export interface SyncStatusSummary {
  mode: "local_only" | "connected_sync";
  providerType: SyncProviderType | null;
  providerLabel: string;
  profileLabelHint: string | null;
  statusTone: SyncStatusTone;
  statusLabel: string;
  statusDetail: string;
  syncBehaviorLabel: string;
  hint: string;
  localItemCount: number;
  remoteActiveCount: number;
  remoteTombstoneCount: number;
  pendingLocalItemCount: number;
  pendingLocalDeleteCount: number;
  unresolvedConflictCount: number;
  unresolvedConflicts: VaultSyncConflict[];
  lastPushedAt?: string;
  lastPulledAt?: string;
  lastMergedAt?: string;
}

function getProviderLabel(providerType: SyncProviderType | null) {
  if (providerType) return getSyncProviderDisplayLabel(providerType);
  return "Local Only";
}

function getProviderState(syncProfile: SyncProfile | null, syncState: VaultSyncState) {
  if (!syncProfile) return null;
  const providerState = syncProfile.providerType === "external_turso"
    ? syncState.turso
    : isBridgeSyncProvider(syncProfile.providerType)
      ? syncState.d1Bridge
      : syncState.d1Direct;

  if (!providerState || providerState.profileId !== syncProfile.profileId) {
    return null;
  }

  return providerState;
}

function countPendingLocalItems(items: VaultItem[], knownRemoteRecords: VaultKnownRemoteRecord[]) {
  const knownRemoteMap = new Map(knownRemoteRecords.map((record) => [record.recordId, record] as const));
  let pendingCount = 0;

  for (const item of items) {
    const recordId = getManualSyncRecordId(item);
    const knownRemote = knownRemoteMap.get(recordId);

    if (!knownRemote || knownRemote.deletedAt) {
      pendingCount += 1;
      continue;
    }

    if (getItemModifiedMs(item) > Date.parse(knownRemote.updatedAt)) {
      pendingCount += 1;
    }
  }

  return pendingCount;
}

function getPendingStatusDetail(providerLabel: string, pendingLocalItemCount: number, pendingLocalDeleteCount: number) {
  if (pendingLocalItemCount > 0 && pendingLocalDeleteCount > 0) {
    return `${pendingLocalItemCount} item lokal dan ${pendingLocalDeleteCount} delete lokal masih menunggu push manual ke ${providerLabel}.`;
  }
  if (pendingLocalItemCount > 0) {
    return `${pendingLocalItemCount} item lokal masih menunggu push manual ke ${providerLabel}.`;
  }
  return `${pendingLocalDeleteCount} delete lokal masih menunggu push manual ke ${providerLabel}.`;
}

function getUnresolvedProviderConflicts(input: {
  syncProfile: SyncProfile;
  syncState: VaultSyncState;
}) {
  return input.syncState.conflicts
    .filter((conflict) =>
      conflict.status === "unresolved"
      && conflict.providerType === input.syncProfile.providerType
      && conflict.providerProfileId === input.syncProfile.profileId,
    )
    .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt) || left.recordId.localeCompare(right.recordId));
}

export function buildSyncStatusSummary(input: {
  syncProfile: SyncProfile | null;
  syncState: VaultSyncState;
  items: VaultItem[];
  autoSyncEnabled?: boolean;
}): SyncStatusSummary {
  const providerLabel = getProviderLabel(input.syncProfile?.providerType ?? null);
  const syncBehaviorLabel = input.syncProfile
    ? input.autoSyncEnabled
      ? "SMART AUTO-SYNC"
      : "MANUAL PUSH/PULL"
    : input.autoSyncEnabled
      ? "AUTO-SYNC ARMED"
      : "NO REMOTE SYNC";

  if (!input.syncProfile) {
    return {
      mode: "local_only",
      providerType: null,
      providerLabel,
      profileLabelHint: null,
      statusTone: "neutral",
      statusLabel: "LOCAL ONLY",
      statusDetail: "Vault ini masih berjalan lokal di browser ini. Tambahkan encrypted sync profile jika ingin replikasi terenkripsi ke provider milik user.",
      syncBehaviorLabel,
      hint: "Tidak ada provider aktif. Semua perubahan tetap lokal sampai kamu menyimpan sync profile.",
      localItemCount: input.items.length,
      remoteActiveCount: 0,
      remoteTombstoneCount: 0,
      pendingLocalItemCount: 0,
      pendingLocalDeleteCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
    };
  }

  const providerState = getProviderState(input.syncProfile, input.syncState);
  const unresolvedConflicts = getUnresolvedProviderConflicts({
    syncProfile: input.syncProfile,
    syncState: input.syncState,
  });
  const knownRemoteRecords = providerState?.knownRemoteRecords ?? [];
  const remoteActiveCount = knownRemoteRecords.filter((record) => record.deletedAt === null).length;
  const remoteTombstoneCount = knownRemoteRecords.filter((record) => record.deletedAt !== null).length;
  const pendingLocalDeleteCount = input.syncState.pendingLocalDeletes.length;
  const pendingLocalItemCount = countPendingLocalItems(input.items, knownRemoteRecords);
  const pendingTotal = pendingLocalItemCount + pendingLocalDeleteCount;
  const hasSyncHistory = !!providerState?.lastPushedAt || !!providerState?.lastPulledAt || !!providerState?.lastMergedAt || knownRemoteRecords.length > 0;

  if (unresolvedConflicts.length > 0) {
    return {
      mode: "connected_sync",
      providerType: input.syncProfile.providerType,
      providerLabel,
      profileLabelHint: input.syncProfile.labelHint ?? null,
      statusTone: "warning",
      statusLabel: "SYNC CONFLICTS",
      statusDetail: `${unresolvedConflicts.length} konflik sync belum terselesaikan. Push yang berisiko menimpa remote diblokir sampai konflik direview.`,
      syncBehaviorLabel,
      hint: "Konflik ini metadata-only. Ciphora tidak menyimpan plaintext vault item di provider atau database internal.",
      localItemCount: input.items.length,
      remoteActiveCount,
      remoteTombstoneCount,
      pendingLocalItemCount,
      pendingLocalDeleteCount,
      unresolvedConflictCount: unresolvedConflicts.length,
      unresolvedConflicts,
      lastPushedAt: providerState?.lastPushedAt,
      lastPulledAt: providerState?.lastPulledAt,
      lastMergedAt: providerState?.lastMergedAt,
    };
  }

  if (pendingTotal > 0) {
    return {
      mode: "connected_sync",
      providerType: input.syncProfile.providerType,
      providerLabel,
      profileLabelHint: input.syncProfile.labelHint ?? null,
      statusTone: "warning",
      statusLabel: "PENDING LOCAL SYNC",
      statusDetail: getPendingStatusDetail(providerLabel, pendingLocalItemCount, pendingLocalDeleteCount),
      syncBehaviorLabel,
      hint: "Panel ini hanya tahu drift lokal di browser ini. Perubahan device lain tetap tidak terlihat sampai kamu pull.",
      localItemCount: input.items.length,
      remoteActiveCount,
      remoteTombstoneCount,
      pendingLocalItemCount,
      pendingLocalDeleteCount,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
      lastPushedAt: providerState?.lastPushedAt,
      lastPulledAt: providerState?.lastPulledAt,
      lastMergedAt: providerState?.lastMergedAt,
    };
  }

  if (!hasSyncHistory) {
    return {
      mode: "connected_sync",
      providerType: input.syncProfile.providerType,
      providerLabel,
      profileLabelHint: input.syncProfile.labelHint ?? null,
      statusTone: "neutral",
      statusLabel: "PROFILE READY",
      statusDetail: `Encrypted sync profile ${providerLabel} sudah aktif, tapi browser ini belum punya riwayat push atau pull ke provider tersebut.`,
      syncBehaviorLabel,
      hint: "Push pertama akan mengirim item lokal terenkripsi. Pull pertama akan membaca snapshot provider yang diketahui browser ini.",
      localItemCount: input.items.length,
      remoteActiveCount,
      remoteTombstoneCount,
      pendingLocalItemCount,
      pendingLocalDeleteCount,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
      lastPushedAt: providerState?.lastPushedAt,
      lastPulledAt: providerState?.lastPulledAt,
      lastMergedAt: providerState?.lastMergedAt,
    };
  }

  return {
    mode: "connected_sync",
    providerType: input.syncProfile.providerType,
    providerLabel,
    profileLabelHint: input.syncProfile.labelHint ?? null,
    statusTone: "success",
    statusLabel: "NO LOCAL PENDING CHANGES",
    statusDetail: `Tidak ada perubahan lokal yang belum disinkronkan ke ${providerLabel} pada browser ini sejak snapshot provider terakhir yang diketahui.`,
    syncBehaviorLabel,
    hint: "Status ini tidak berarti remote sudah pasti terbaru. Device lain bisa saja mengubah provider sampai browser ini melakukan pull lagi.",
    localItemCount: input.items.length,
    remoteActiveCount,
    remoteTombstoneCount,
    pendingLocalItemCount,
    pendingLocalDeleteCount,
    unresolvedConflictCount: 0,
    unresolvedConflicts: [],
    lastPushedAt: providerState?.lastPushedAt,
    lastPulledAt: providerState?.lastPulledAt,
    lastMergedAt: providerState?.lastMergedAt,
  };
}

export function hasPendingLocalSync(summary: SyncStatusSummary) {
  return summary.pendingLocalItemCount + summary.pendingLocalDeleteCount > 0;
}

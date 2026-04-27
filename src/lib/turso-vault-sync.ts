import { STORAGE_KEYS, readStorageValue, writeStorageValue } from "./app-config";
import { decryptCiphoraSyncProfileConfig, type SyncProfile } from "./account-client";
import {
  applySyncConflictResolution,
  findResolvedLocalOverwriteGrant,
  type SyncConflictResolution,
} from "./sync-conflict-resolution";
import type { VaultItem } from "../sections/ItemModal";
import {
  createVaultSyncConflict,
  mergeVaultSyncConflicts,
  type VaultData,
  type VaultKnownRemoteRecord,
  type VaultSyncConflict,
  type VaultSyncState,
} from "./vault-storage";
import userVaultSchemaSql from "../../schema/turso/user_vault.sql?raw";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const RECORD_KIND = "vault_item";
const RECORD_PAYLOAD_VERSION = "ciphora-sync-record-v1";
const CONNECTION_TIMEOUT_MS = 10000;
const CURSOR_NAME = "manual_snapshot";
const SYNC_JOURNAL_METADATA_MAX_CHARS = 2048;

interface TursoRemoteRecord {
  recordId: string;
  algorithm: string;
  iv: string;
  ciphertext: string;
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface EncryptedVaultRecordPayload {
  kind: typeof RECORD_KIND;
  version: typeof RECORD_PAYLOAD_VERSION;
  item: VaultItem;
}

const MAX_RECORD_VERSIONS = 8;
type SqlArg = string | number | null;
type SyncJournalOperation = "upsert" | "delete" | "pull" | "conflict" | "resolve";
type SyncJournalStatus = "applied" | "skipped" | "conflict" | "resolved";

interface SyncJournalEventInput {
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
}

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

export interface TursoPushResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  pushedCount: number;
  tombstoneCount: number;
  preservedRemoteCount: number;
  conflictCount: number;
  syncState: VaultSyncState;
}

export interface TursoPullResult {
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

function hasWindow() {
  return typeof window !== "undefined";
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Browser crypto is unavailable.");
  }
  return globalThis.crypto;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importVaultKey(rawKeyBase64: string, usages: KeyUsage[]) {
  return requireCrypto().subtle.importKey(
    "raw",
    base64UrlToBytes(rawKeyBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")),
    "AES-GCM",
    false,
    usages,
  );
}

async function sha256Base64Url(value: string) {
  const digest = await requireCrypto().subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function createTimedFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  };
}

function normalizeVaultItem(item: VaultItem): VaultItem {
  return {
    id: item.id,
    type: item.type,
    site: item.site,
    username: item.username,
    password: item.password,
    url: item.url,
    notes: item.notes,
    favicon: item.favicon,
    strength: item.strength,
    account: item.account,
    issuer: item.issuer,
    secret: item.secret,
    title: item.title,
    preview: item.preview,
    updatedAt: item.updatedAt,
    modifiedAt: item.modifiedAt,
    cardholder: item.cardholder,
    number: item.number,
    expiry: item.expiry,
    cvv: item.cvv,
    brand: item.brand,
    sshName: item.sshName,
    sshUsername: item.sshUsername,
    sshHost: item.sshHost,
    sshPort: item.sshPort,
    sshPrivateKey: item.sshPrivateKey,
    sshPublicKey: item.sshPublicKey,
    sshPassphrase: item.sshPassphrase,
    sshFingerprint: item.sshFingerprint,
    identityLabel: item.identityLabel,
    fullName: item.fullName,
    email: item.email,
    phone: item.phone,
    company: item.company,
    jobTitle: item.jobTitle,
    address: item.address,
    city: item.city,
    region: item.region,
    postalCode: item.postalCode,
    country: item.country,
    documentId: item.documentId,
    apiName: item.apiName,
    apiProvider: item.apiProvider,
    apiKey: item.apiKey,
    apiSecret: item.apiSecret,
    apiScopes: item.apiScopes,
    apiExpiry: item.apiExpiry,
    wifiName: item.wifiName,
    ssid: item.ssid,
    wifiPassword: item.wifiPassword,
    wifiSecurity: item.wifiSecurity,
    wifiNotes: item.wifiNotes,
    recoveryName: item.recoveryName,
    recoveryService: item.recoveryService,
    recoveryAccount: item.recoveryAccount,
    recoveryCodes: item.recoveryCodes,
    recoveryNotes: item.recoveryNotes,
    softwareName: item.softwareName,
    softwareVendor: item.softwareVendor,
    licenseKey: item.licenseKey,
    licenseEmail: item.licenseEmail,
    licenseSeats: item.licenseSeats,
    licenseExpiry: item.licenseExpiry,
    licenseNotes: item.licenseNotes,
    dbName: item.dbName,
    dbEngine: item.dbEngine,
    dbHost: item.dbHost,
    dbPort: item.dbPort,
    dbDatabase: item.dbDatabase,
    dbUsername: item.dbUsername,
    dbPassword: item.dbPassword,
    dbConnectionUrl: item.dbConnectionUrl,
    dbNotes: item.dbNotes,
    emailAccountName: item.emailAccountName,
    emailAddress: item.emailAddress,
    emailProvider: item.emailProvider,
    emailUsername: item.emailUsername,
    emailPassword: item.emailPassword,
    emailRecoveryEmail: item.emailRecoveryEmail,
    emailRecoveryPhone: item.emailRecoveryPhone,
    emailImapHost: item.emailImapHost,
    emailSmtpHost: item.emailSmtpHost,
    emailNotes: item.emailNotes,
    bankLabel: item.bankLabel,
    bankName: item.bankName,
    bankAccountHolder: item.bankAccountHolder,
    bankAccountNumber: item.bankAccountNumber,
    bankRoutingNumber: item.bankRoutingNumber,
    bankSwift: item.bankSwift,
    bankIban: item.bankIban,
    bankBranch: item.bankBranch,
    bankPin: item.bankPin,
    bankLoginUrl: item.bankLoginUrl,
    bankNotes: item.bankNotes,
    cryptoWalletName: item.cryptoWalletName,
    cryptoNetwork: item.cryptoNetwork,
    cryptoPublicAddress: item.cryptoPublicAddress,
    cryptoSeedPhrase: item.cryptoSeedPhrase,
    cryptoPrivateKey: item.cryptoPrivateKey,
    cryptoDerivationPath: item.cryptoDerivationPath,
    cryptoHardwareWallet: item.cryptoHardwareWallet,
    cryptoNotes: item.cryptoNotes,
    domainName: item.domainName,
    domainRegistrar: item.domainRegistrar,
    domainDnsProvider: item.domainDnsProvider,
    domainNameservers: item.domainNameservers,
    domainExpires: item.domainExpires,
    domainRenewalEmail: item.domainRenewalEmail,
    domainEppCode: item.domainEppCode,
    domainNotes: item.domainNotes,
    serverName: item.serverName,
    serverProvider: item.serverProvider,
    serverHost: item.serverHost,
    serverIp: item.serverIp,
    serverUsername: item.serverUsername,
    serverPassword: item.serverPassword,
    serverPanelUrl: item.serverPanelUrl,
    serverSshReference: item.serverSshReference,
    serverExpires: item.serverExpires,
    serverNotes: item.serverNotes,
  };
}

function getRecordId(item: VaultItem) {
  return `item:${item.id}`;
}

function getRecordIdFromItemId(id: number) {
  return `item:${id}`;
}

function getSyncDeviceId() {
  if (!hasWindow()) {
    return "ciphora-sync-runtime";
  }

  const existing = readStorageValue(window.localStorage, STORAGE_KEYS.accountDeviceId);
  if (existing && /^[A-Za-z0-9_-]{16,96}$/.test(existing)) {
    return existing;
  }

  const next = crypto.randomUUID();
  writeStorageValue(window.localStorage, STORAGE_KEYS.accountDeviceId, next);
  return next;
}

function parseTimestamp(value?: string | null) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function getItemModifiedAt(item: VaultItem, fallback?: string | null) {
  if (typeof item.modifiedAt === "string" && item.modifiedAt.length > 0) {
    return item.modifiedAt;
  }
  if (typeof item.updatedAt === "string" && item.updatedAt.includes("T")) {
    return item.updatedAt;
  }
  return fallback ?? "";
}

function getItemModifiedMs(item: VaultItem, fallback?: string | null) {
  return parseTimestamp(getItemModifiedAt(item, fallback));
}

function getTursoState(syncState: VaultSyncState, profileId: string) {
  return syncState.turso?.profileId === profileId ? syncState.turso : null;
}

function toKnownRemoteRecord(record: Pick<TursoRemoteRecord, "recordId" | "version" | "updatedAt" | "deletedAt" | "contentHash">): VaultKnownRemoteRecord {
  return {
    recordId: record.recordId,
    version: record.version,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    contentHash: record.contentHash,
  };
}

function hasRemoteChangedSinceKnown(
  knownRecord: VaultKnownRemoteRecord | undefined,
  remoteRecord: Pick<TursoRemoteRecord, "version" | "updatedAt" | "deletedAt" | "contentHash">,
) {
  return !knownRecord
    || knownRecord.version !== remoteRecord.version
    || knownRecord.updatedAt !== remoteRecord.updatedAt
    || knownRecord.deletedAt !== remoteRecord.deletedAt
    || knownRecord.contentHash !== remoteRecord.contentHash;
}

function createTursoSyncConflict(input: {
  profileId: string;
  recordId: string;
  operation: "upsert" | "delete";
  reason: VaultSyncConflict["reason"];
  localContentHash: string;
  knownRemote: VaultKnownRemoteRecord | undefined;
  remoteRecord: Pick<TursoRemoteRecord, "version" | "updatedAt" | "deletedAt" | "contentHash">;
  detectedAt: string;
}) {
  return createVaultSyncConflict({
    providerType: "external_turso",
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

function createSyncJournalEvent(input: SyncJournalEventInput): SyncJournalEventRow {
  const metadataJson = input.metadata
    ? JSON.stringify(input.metadata).slice(0, SYNC_JOURNAL_METADATA_MAX_CHARS)
    : null;

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
    metadataJson,
  };
}

function appendSyncJournalStatement(statements: Array<{ sql: string; args?: SqlArg[] }>, event: SyncJournalEventRow) {
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

function appendSyncConflictStatement(statements: Array<{ sql: string; args?: SqlArg[] }>, conflict: VaultSyncConflict) {
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
  statements: Array<{ sql: string; args?: SqlArg[] }>;
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

function buildNextSyncState(input: {
  currentSyncState: VaultSyncState;
  profileId: string;
  remoteRecords: Iterable<Pick<TursoRemoteRecord, "recordId" | "version" | "updatedAt" | "deletedAt" | "contentHash">>;
  lastPulledAt?: string;
  lastPushedAt?: string;
  lastMergedAt?: string;
  clearedDeleteIds?: Set<string>;
  conflicts?: VaultSyncConflict[];
}): VaultSyncState {
  const currentTurso = getTursoState(input.currentSyncState, input.profileId);
  const knownRemoteRecords = Array.from(input.remoteRecords, toKnownRemoteRecord)
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  const pendingLocalDeletes = input.currentSyncState.pendingLocalDeletes
    .filter((entry) => !input.clearedDeleteIds?.has(entry.recordId))
    .slice(0, 512);

  return {
    pendingLocalDeletes,
    conflicts: mergeVaultSyncConflicts(input.currentSyncState.conflicts, input.conflicts ?? []),
    d1Bridge: input.currentSyncState.d1Bridge,
    d1Direct: input.currentSyncState.d1Direct,
    turso: {
      profileId: input.profileId,
      knownRemoteRecords,
      lastPulledAt: input.lastPulledAt ?? currentTurso?.lastPulledAt,
      lastPushedAt: input.lastPushedAt ?? currentTurso?.lastPushedAt,
      lastMergedAt: input.lastMergedAt ?? currentTurso?.lastMergedAt,
    },
  };
}

async function encryptVaultItemRecord(rootKeyBase64: string, item: VaultItem) {
  const normalizedItem = normalizeVaultItem(item);
  const payload: EncryptedVaultRecordPayload = {
    kind: RECORD_KIND,
    version: RECORD_PAYLOAD_VERSION,
    item: normalizedItem,
  };
  const plaintext = JSON.stringify(payload);
  const ivBytes = new Uint8Array(12);
  requireCrypto().getRandomValues(ivBytes);
  const key = await importVaultKey(rootKeyBase64, ["encrypt"]);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    key,
    textEncoder.encode(plaintext),
  );

  return {
    recordId: getRecordId(normalizedItem),
    algorithm: "AES-GCM-256",
    iv: bytesToBase64Url(ivBytes),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    contentHash: await sha256Base64Url(plaintext),
  };
}

async function decryptVaultItemRecord(rootKeyBase64: string, record: TursoRemoteRecord) {
  const key = await importVaultKey(rootKeyBase64, ["decrypt"]);
  const plaintext = await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(record.iv),
    },
    key,
    base64UrlToBytes(record.ciphertext),
  );
  const parsed = JSON.parse(textDecoder.decode(plaintext)) as Partial<EncryptedVaultRecordPayload>;
  const item = parsed.item;

  if (
    parsed.kind !== RECORD_KIND
    || parsed.version !== RECORD_PAYLOAD_VERSION
    || !item
    || typeof item !== "object"
    || typeof item.id !== "number"
    || getRecordId(item as VaultItem) !== record.recordId
  ) {
    throw new Error(`Stored Turso record ${record.recordId} is invalid.`);
  }

  const normalized = normalizeVaultItem(item as VaultItem);
  if (!normalized.modifiedAt) {
    normalized.modifiedAt = record.updatedAt;
  }
  return normalized;
}

async function createTursoClient(rootKeyBase64: string, syncProfile: SyncProfile) {
  const config = await decryptCiphoraSyncProfileConfig({
    rootKeyBase64,
    syncProfile,
  });

  if (config.providerType !== "external_turso") {
    throw new Error("Manual vault sync is only available for Turso profiles in this build.");
  }

  const { createClient } = await import("@libsql/client/web");
  const client = createClient({
    url: config.endpoint,
    authToken: config.accessToken,
    fetch: createTimedFetch(),
  });

  return {
    client,
    endpoint: config.endpoint,
    accessToken: config.accessToken,
  };
}

async function ensureTursoVaultSchema(client: Awaited<ReturnType<typeof createTursoClient>>["client"]) {
  await client.executeMultiple(userVaultSchemaSql);
}

async function listRemoteRecords(client: Awaited<ReturnType<typeof createTursoClient>>["client"]) {
  const result = await client.execute(
    "SELECT record_id, algorithm, iv, ciphertext, content_hash, version, created_at, updated_at, deleted_at FROM vault_records ORDER BY record_id ASC",
  );

  return result.rows.map((row) => ({
    recordId: String(row.record_id ?? ""),
    algorithm: String(row.algorithm ?? ""),
    iv: String(row.iv ?? ""),
    ciphertext: String(row.ciphertext ?? ""),
    contentHash: String(row.content_hash ?? ""),
    version: Number(row.version ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : String(row.deleted_at),
  })).filter((row) => row.recordId && row.version >= 1);
}

function sanitizeErrorMessage(error: unknown, endpoint: string, accessToken: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, " ").trim() || "unknown_error";
  return compact
    .replaceAll(accessToken, "[REDACTED_TOKEN]")
    .replaceAll(endpoint, "[REDACTED_ENDPOINT]")
    .slice(0, 180);
}

function mapTursoSyncError(action: "push" | "pull", error: unknown, endpoint: string, accessToken: string) {
  const message = sanitizeErrorMessage(error, endpoint, accessToken);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("unauthorized") || lowerMessage.includes("401") || lowerMessage.includes("403")) {
    return "Token Turso ditolak saat sinkronisasi. Periksa auth token dan hak akses databasenya.";
  }
  if (lowerMessage.includes("abort") || lowerMessage.includes("timeout")) {
    return `Sinkronisasi Turso habis waktu saat ${action === "push" ? "push" : "pull"}. Coba lagi sebentar lagi.`;
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network")) {
    return "Browser tidak bisa menjangkau Turso untuk sinkronisasi. Cek jaringan, CORS, atau URL database.";
  }
  if (lowerMessage.includes("invalid") || lowerMessage.includes("decrypt")) {
    return "Data sync Turso tidak valid atau gagal didekripsi dengan vault key aktif.";
  }

  return `Sinkronisasi Turso gagal: ${message}`;
}

function chooseMergedItem(localItem: VaultItem, remoteItem: VaultItem, remoteRecord: TursoRemoteRecord) {
  const localMs = getItemModifiedMs(localItem);
  const remoteMs = getItemModifiedMs(remoteItem, remoteRecord.updatedAt);

  if (remoteMs > localMs) return { item: remoteItem, winner: "remote" as const };
  if (localMs > remoteMs) return { item: localItem, winner: "local" as const };

  if (!localItem.modifiedAt && remoteItem.modifiedAt) {
    return { item: remoteItem, winner: "remote" as const };
  }

  return { item: localItem, winner: "local" as const };
}

export async function pushVaultSnapshotToTurso(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}): Promise<TursoPushResult> {
  const checkedAt = new Date().toISOString();
  const { client, endpoint, accessToken } = await createTursoClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureTursoVaultSchema(client);
    const remoteRecords = await listRemoteRecords(client);
    const activeRemoteRecords = remoteRecords.filter((record) => record.deletedAt === null);
    const localItems = input.vaultData.items.map(normalizeVaultItem);
    const localRecordIds = new Set(localItems.map((item) => getRecordId(item)));
    const deviceId = getSyncDeviceId();
    const currentTursoState = getTursoState(input.vaultData.syncState, input.syncProfile.profileId);
    const knownRemoteMap = new Map(
      (currentTursoState?.knownRemoteRecords ?? []).map((record) => [record.recordId, record] as const),
    );
    const existingConflicts = input.vaultData.syncState.conflicts
      .filter((conflict) =>
        conflict.status === "unresolved"
        && conflict.providerType === "external_turso"
        && conflict.providerProfileId === input.syncProfile.profileId,
      );
    const existingConflictIds = new Set(existingConflicts.map((conflict) => conflict.conflictId));
    const existingConflictByRecordId = new Map(
      existingConflicts.map((conflict) => [conflict.recordId, conflict] as const),
    );
    const knownActiveRemoteIds = new Set(
      (currentTursoState?.knownRemoteRecords ?? [])
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
    const statements: Array<{ sql: string; args?: SqlArg[] }> = [
      {
        sql: "INSERT INTO provider_devices (device_id, device_label, created_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET device_label = excluded.device_label, last_seen_at = excluded.last_seen_at",
        args: [deviceId, "Ciphora Web Vault", checkedAt, checkedAt],
      },
    ];
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
          providerType: "external_turso",
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
        const conflict = createTursoSyncConflict({
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
              provider: "external_turso",
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
          provider: "external_turso",
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
            provider: "external_turso",
            resolution: overwriteGrant.resolution,
            appliedBy: "local_overwrite_grant",
          },
        }));
        statements.push({
          sql: "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
          args: [checkedAt, overwriteGrant.resolution ?? "keep_local", overwriteGrant.conflictId, input.syncProfile.profileId],
        });
      }
      pushedCount += 1;

      statements.push({
        sql: "INSERT INTO vault_records (record_id, record_kind, algorithm, iv, ciphertext, content_hash, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(record_id) DO UPDATE SET record_kind = excluded.record_kind, algorithm = excluded.algorithm, iv = excluded.iv, ciphertext = excluded.ciphertext, content_hash = excluded.content_hash, version = excluded.version, updated_at = excluded.updated_at, deleted_at = NULL",
        args: [
          encryptedRecord.recordId,
          RECORD_KIND,
          encryptedRecord.algorithm,
          encryptedRecord.iv,
          encryptedRecord.ciphertext,
          encryptedRecord.contentHash,
          nextVersion,
          createdAt,
          checkedAt,
        ],
      });
      statements.push({
        sql: "INSERT INTO vault_record_versions (version_id, record_id, version, algorithm, iv, ciphertext, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          `${encryptedRecord.recordId}:${nextVersion}`,
          encryptedRecord.recordId,
          nextVersion,
          encryptedRecord.algorithm,
          encryptedRecord.iv,
          encryptedRecord.ciphertext,
          encryptedRecord.contentHash,
          checkedAt,
        ],
      });
      statements.push({
        sql: "DELETE FROM vault_record_versions WHERE record_id = ? AND version_id NOT IN (SELECT version_id FROM vault_record_versions WHERE record_id = ? ORDER BY version DESC LIMIT ?)",
        args: [encryptedRecord.recordId, encryptedRecord.recordId, MAX_RECORD_VERSIONS],
      });
      statements.push({
        sql: "DELETE FROM vault_tombstones WHERE record_id = ?",
        args: [encryptedRecord.recordId],
      });
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
        providerType: "external_turso",
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
        const conflict = createTursoSyncConflict({
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
              provider: "external_turso",
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
          provider: "external_turso",
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
            provider: "external_turso",
            resolution: overwriteGrant.resolution,
            appliedBy: "local_delete_grant",
          },
        }));
        statements.push({
          sql: "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
          args: [checkedAt, overwriteGrant.resolution ?? "keep_local", overwriteGrant.conflictId, input.syncProfile.profileId],
        });
      }
      statements.push({
        sql: "UPDATE vault_records SET version = ?, updated_at = ?, deleted_at = ? WHERE record_id = ?",
        args: [nextVersion, checkedAt, checkedAt, remoteRecord.recordId],
      });
      statements.push({
        sql: "INSERT INTO vault_tombstones (record_id, deleted_at, version, content_hash, source_device_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET deleted_at = excluded.deleted_at, version = excluded.version, content_hash = excluded.content_hash, source_device_id = excluded.source_device_id",
        args: [remoteRecord.recordId, checkedAt, nextVersion, remoteRecord.contentHash, deviceId],
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

    if (pushedCount === 0 && tombstoneCount === 0 && newConflictRows.length === 0) {
      let message = "Push ke Turso selesai. Tidak ada delta lokal yang perlu dikirim.";
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

    statements.push({
      sql: "INSERT INTO sync_cursors (cursor_name, cursor_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(cursor_name) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = excluded.updated_at",
      args: [
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
    });
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

    await client.batch(statements, "write");

    let message = pushedCount === 0 && tombstoneCount > 0
      ? `Push ke Turso selesai. ${tombstoneCount} delete lokal yang sudah diketahui provider diterapkan dengan aman.`
      : `Push ke Turso selesai. ${pushedCount} item delta terenkripsi dikirim${tombstoneCount > 0 ? ` dan ${tombstoneCount} tombstone diperbarui` : ""}.`;

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
      message: mapTursoSyncError("push", error, endpoint, accessToken),
      checkedAt,
      pushedCount: 0,
      tombstoneCount: 0,
      preservedRemoteCount: 0,
      conflictCount: 0,
      syncState: input.vaultData.syncState,
    };
  } finally {
    client.close();
  }
}

export interface TursoConflictResolutionResult {
  ok: boolean;
  message: string;
  checkedAt: string;
  items: VaultItem[];
  syncState: VaultSyncState;
}

export async function resolveTursoSyncConflict(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
  conflictId: string;
  resolution: SyncConflictResolution;
}): Promise<TursoConflictResolutionResult> {
  const checkedAt = new Date().toISOString();
  const { client, endpoint, accessToken } = await createTursoClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureTursoVaultSchema(client);
    const remoteRecords = await listRemoteRecords(client);
    const conflict = input.vaultData.syncState.conflicts.find((entry) =>
      entry.conflictId === input.conflictId
      && entry.status === "unresolved"
      && entry.providerType === "external_turso"
      && entry.providerProfileId === input.syncProfile.profileId,
    );
    const remoteRecord = conflict ? remoteRecords.find((record) => record.recordId === conflict.recordId) ?? null : null;
    const remoteItem = remoteRecord?.deletedAt === null
      ? await decryptVaultItemRecord(input.rootKeyBase64, remoteRecord)
      : null;
    const result = applySyncConflictResolution({
      vaultData: input.vaultData,
      providerType: "external_turso",
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

    const deviceId = getSyncDeviceId();
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
        provider: "external_turso",
        resolution: input.resolution,
        appliedBy: "explicit_sync_conflict_action",
      },
    });
    const statements: Array<{ sql: string; args?: SqlArg[] }> = [
      {
        sql: "UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE conflict_id = ? AND provider_profile_id = ?",
        args: [checkedAt, input.resolution, result.resolvedConflict.conflictId, input.syncProfile.profileId],
      },
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
    await client.batch(statements, "write");

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
      message: mapTursoSyncError("pull", error, endpoint, accessToken),
      checkedAt,
      items: input.vaultData.items,
      syncState: input.vaultData.syncState,
    };
  } finally {
    client.close();
  }
}

export async function pullVaultSnapshotFromTurso(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}): Promise<TursoPullResult> {
  const checkedAt = new Date().toISOString();
  const { client, endpoint, accessToken } = await createTursoClient(input.rootKeyBase64, input.syncProfile);

  try {
    await ensureTursoVaultSchema(client);
    const remoteRecords = await listRemoteRecords(client);
    const deviceId = getSyncDeviceId();
    const remoteItemMap = new Map<string, VaultItem>();
    const remoteActiveRecords = remoteRecords
      .filter((record) => record.deletedAt === null)
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.recordId.localeCompare(right.recordId));

    for (const record of remoteActiveRecords) {
      remoteItemMap.set(record.recordId, await decryptVaultItemRecord(input.rootKeyBase64, record));
    }

    const localItems = input.vaultData.items.map(normalizeVaultItem);
    const localItemMap = new Map(localItems.map((item) => [getRecordId(item), item] as const));
    const currentTursoState = getTursoState(input.vaultData.syncState, input.syncProfile.profileId);
    const knownRemoteMap = new Map((currentTursoState?.knownRemoteRecords ?? []).map((record) => [record.recordId, record] as const));
    const existingConflictIds = new Set(
      input.vaultData.syncState.conflicts
        .filter((conflict) =>
          conflict.status === "unresolved"
          && conflict.providerType === "external_turso"
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
      const recordId = getRecordId(item);
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
                provider: "external_turso",
                mergeWinner: "remote",
              },
            }));
          }
        } else {
          preservedLocalCount += 1;
          if (remoteChangedSinceKnown) {
            const conflict = createTursoSyncConflict({
              profileId: input.syncProfile.profileId,
              recordId,
              operation: "upsert",
              reason: "remote_changed_before_push",
              localContentHash: knownRemote?.contentHash ?? getRecordId(localItem),
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
                provider: "external_turso",
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
        const remoteRecordForJournal = remoteRecords.find((entry) => entry.recordId === recordId);
        if (remoteRecordForJournal && hasRemoteChangedSinceKnown(knownRemoteMap.get(recordId), remoteRecordForJournal)) {
          pullJournalEvents.push(createSyncJournalEvent({
            recordId,
            providerProfileId: input.syncProfile.profileId,
            sourceDeviceId: deviceId,
            operation: "pull",
            status: "applied",
            createdAt: checkedAt,
            baseVersion: null,
            resultVersion: remoteRecordForJournal.version,
            baseContentHash: null,
            resultContentHash: remoteRecordForJournal.contentHash,
            remoteUpdatedAt: remoteRecordForJournal.updatedAt,
            metadata: {
              provider: "external_turso",
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
        const remoteDeletedMs = parseTimestamp(remoteRecord.deletedAt);
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
                provider: "external_turso",
                remoteOperation: "delete",
              },
            }));
          }
          continue;
        }

        if (remoteChangedSinceKnown) {
          const conflict = createTursoSyncConflict({
            profileId: input.syncProfile.profileId,
            recordId,
            operation: "upsert",
            reason: "remote_deleted_before_push",
            localContentHash: knownRemote?.contentHash ?? getRecordId(localItem),
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
              provider: "external_turso",
              remoteOperation: "delete",
              mergeWinner: "local",
            },
          }));
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

    if (pullJournalEvents.length > 0 || newConflictRows.length > 0) {
      const statements: Array<{ sql: string; args?: SqlArg[] }> = [];
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
      await client.batch(statements, "write");
    }

    let message: string;
    if (remoteActiveRecords.length === 0 && mergedItems.length === input.vaultData.items.length) {
      message = mergedItems.length > 0
        ? "Vault Turso belum berisi item aktif. Item lokal dipertahankan di browser ini."
        : "Vault Turso belum berisi item aktif.";
    } else {
      message = `Pull dari Turso selesai. ${mergedCount} item remote dimuat${deletedCount > 0 ? `, ${deletedCount} delete remote diterapkan` : ""}${preservedLocalCount > 0 ? `, ${preservedLocalCount} item lokal dipertahankan` : ""}.`;
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
      message: mapTursoSyncError("pull", error, endpoint, accessToken),
      checkedAt,
      items: input.vaultData.items,
      remoteActiveCount: 0,
      mergedCount: 0,
      deletedCount: 0,
      preservedLocalCount: 0,
      syncState: input.vaultData.syncState,
    };
  } finally {
    client.close();
  }
}

import { EXPORT_VERSION, STORAGE_KEYS, readStorageValue, removeStorageValue, writeStorageValue } from "./app-config";
import { getSyncProviderShortCode, isKnownSyncProvider, type SyncProviderType } from "./sync-providers";
import type { VaultItem } from "../sections/ItemModal";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const PBKDF2_ITERATIONS = 250000;
const PBKDF2_SALT_BYTES = 16;
const AES_GCM_IV_BYTES = 12;
const KEY_BYTES = 32;
const DERIVED_BYTES = KEY_BYTES * 2;
const PIN_WRAP_ITERATIONS = 350000;

export const ENCRYPTED_VAULT_VERSION = "ciphora-vault-v2";
export const ENCRYPTED_BACKUP_FORMAT = "ciphora-encrypted-backup";
export const PIN_WRAP_VERSION = "ciphora-pin-wrap-v1";
export const LOCAL_ROOT_WRAP_VERSION = "ciphora-local-root-wrap-v1";

type VaultRootKeyMode = "derived" | "wrapped";

export interface VaultActivity {
  id: number;
  type: string;
  label: string;
  detail: string;
  severity: string;
  time: string;
  createdAt: string;
}

export interface VaultDeletedRecord {
  recordId: string;
  deletedAt: string;
}

export interface VaultKnownRemoteRecord {
  recordId: string;
  version: number;
  updatedAt: string;
  deletedAt: string | null;
  contentHash: string;
}

export type VaultSyncConflictProvider = SyncProviderType;
export type VaultSyncConflictOperation = "upsert" | "delete";
export type VaultSyncConflictReason =
  | "remote_changed_before_push"
  | "remote_deleted_before_push"
  | "remote_changed_before_delete";
export type VaultSyncConflictResolution = "keep_local" | "keep_remote" | "keep_both" | "manual_edit";

export interface VaultSyncConflict {
  conflictId: string;
  providerType: VaultSyncConflictProvider;
  providerProfileId: string;
  recordId: string;
  operation: VaultSyncConflictOperation;
  reason: VaultSyncConflictReason;
  localContentHash: string;
  remoteContentHash: string;
  localVersion: number | null;
  remoteVersion: number | null;
  remoteUpdatedAt: string | null;
  detectedAt: string;
  status: "unresolved" | "resolved";
  resolvedAt?: string;
  resolution?: VaultSyncConflictResolution;
}

function shortConflictPart(value: string | number | null | undefined, maxLength: number) {
  const normalized = String(value ?? "none")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, maxLength);
  return normalized || "none";
}

export function createVaultSyncConflict(input: Omit<VaultSyncConflict, "conflictId" | "status">): VaultSyncConflict {
  const conflictId = [
    "cf",
    getSyncProviderShortCode(input.providerType),
    shortConflictPart(input.providerProfileId, 10),
    shortConflictPart(input.recordId, 24),
    shortConflictPart(input.operation, 8),
    shortConflictPart(input.remoteVersion, 8),
    shortConflictPart(input.remoteContentHash, 16),
  ].join("_");

  return {
    ...input,
    conflictId,
    status: "unresolved",
  };
}

export interface VaultTursoSyncState {
  profileId: string;
  knownRemoteRecords: VaultKnownRemoteRecord[];
  lastPulledAt?: string;
  lastPushedAt?: string;
  lastMergedAt?: string;
}

export interface VaultD1BridgeSyncState {
  profileId: string;
  knownRemoteRecords: VaultKnownRemoteRecord[];
  lastPulledAt?: string;
  lastPushedAt?: string;
  lastMergedAt?: string;
}

export interface VaultD1DirectSyncState {
  profileId: string;
  knownRemoteRecords: VaultKnownRemoteRecord[];
  lastPulledAt?: string;
  lastPushedAt?: string;
  lastMergedAt?: string;
}

export interface VaultSyncState {
  pendingLocalDeletes: VaultDeletedRecord[];
  conflicts: VaultSyncConflict[];
  turso?: VaultTursoSyncState;
  d1Bridge?: VaultD1BridgeSyncState;
  d1Direct?: VaultD1DirectSyncState;
}

export interface VaultData {
  version: string;
  items: VaultItem[];
  activities: VaultActivity[];
  syncState: VaultSyncState;
  createdAt: string;
  updatedAt: string;
}

export interface VaultAuthRecord {
  version: string;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  verifier: string;
  rootKeyMode?: VaultRootKeyMode;
  rootKeyWrapperVersion?: typeof LOCAL_ROOT_WRAP_VERSION;
  rootKeyWrapperAlgorithm?: "AES-GCM";
  rootKeyWrapperIv?: string;
  rootKeyWrapperCiphertext?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultEnvelope {
  version: string;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
  updatedAt: string;
}

export interface VaultBackupFile {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  auth: VaultAuthRecord;
  vault: VaultEnvelope;
}

export interface PinWrapRecord {
  version: typeof PIN_WRAP_VERSION;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  digits: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

interface LegacyPlaintextBackup {
  version?: string;
  exportedAt?: string;
  items?: unknown;
}

interface DerivedUnlockMaterial {
  primaryKeyBase64: string;
  verifierBase64: string;
}

function hasWindow() {
  return typeof window !== "undefined";
}

function requireCrypto() {
  if (!hasWindow() || !window.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable in this browser.");
  }
  return window.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const cryptoApi = requireCrypto();
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function nowIso() {
  return new Date().toISOString();
}

function readJson<T>(storage: Storage, key: { current: string; legacy?: string }): T | null {
  try {
    const raw = readStorageValue(storage, key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: { current: string; legacy?: string }, value: unknown) {
  writeStorageValue(storage, key, JSON.stringify(value));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

async function deriveSecretBytes(secret: string, saltBase64: string, iterations: number, lengthBytes: number) {
  const cryptoApi = requireCrypto();
  const secretKey = await cryptoApi.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await cryptoApi.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltBase64),
      iterations,
      hash: "SHA-256",
    },
    secretKey,
    lengthBytes * 8,
  );

  return new Uint8Array(derivedBits);
}

async function deriveUnlockMaterial(password: string, saltBase64: string, iterations: number): Promise<DerivedUnlockMaterial> {
  const bytes = await deriveSecretBytes(password, saltBase64, iterations, DERIVED_BYTES);
  return {
    primaryKeyBase64: bytesToBase64(bytes.slice(0, KEY_BYTES)),
    verifierBase64: bytesToBase64(bytes.slice(KEY_BYTES, DERIVED_BYTES)),
  };
}

async function deriveWrapKeyBase64(pin: string, saltBase64: string, iterations: number) {
  const bytes = await deriveSecretBytes(pin, saltBase64, iterations, KEY_BYTES);
  return bytesToBase64(bytes);
}

async function importVaultKey(rawKeyBase64: string, usage: KeyUsage[]) {
  const cryptoApi = requireCrypto();
  return cryptoApi.subtle.importKey(
    "raw",
    base64ToBytes(rawKeyBase64),
    "AES-GCM",
    false,
    usage,
  );
}

function sanitizeActivity(activity: Partial<VaultActivity>): VaultActivity {
  const createdAt = typeof activity.createdAt === "string" ? activity.createdAt : nowIso();
  return {
    id: typeof activity.id === "number" ? activity.id : generateVaultId(),
    type: typeof activity.type === "string" ? activity.type : "info",
    label: typeof activity.label === "string" ? activity.label : "Vault event",
    detail: typeof activity.detail === "string" ? activity.detail : "",
    severity: typeof activity.severity === "string" ? activity.severity : "info",
    time: typeof activity.time === "string" ? activity.time : createdAt.slice(11, 19),
    createdAt,
  };
}

export function generateVaultId() {
  return Date.now() + Math.floor(Math.random() * 10000);
}

export function createVaultActivity(
  activity: Omit<VaultActivity, "id" | "createdAt" | "time"> & { time?: string },
): VaultActivity {
  const createdAt = nowIso();
  return sanitizeActivity({
    ...activity,
    time: activity.time ?? createdAt.slice(11, 19),
    createdAt,
  });
}

export function createEmptyVaultSyncState(): VaultSyncState {
  return {
    pendingLocalDeletes: [],
    conflicts: [],
  };
}

export function createEmptyVaultData(input?: Partial<VaultData>): VaultData {
  const createdAt = typeof input?.createdAt === "string" ? input.createdAt : nowIso();
  return {
    version: ENCRYPTED_VAULT_VERSION,
    items: Array.isArray(input?.items) ? [...input.items] : [],
    activities: Array.isArray(input?.activities) ? input.activities.map(sanitizeActivity) : [],
    syncState: sanitizeSyncState(input?.syncState),
    createdAt,
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : createdAt,
  };
}

function sanitizeSyncState(input?: Partial<VaultSyncState>): VaultSyncState {
  if (!input) {
    return createEmptyVaultSyncState();
  }

  const pendingLocalDeletes = Array.isArray(input?.pendingLocalDeletes)
    ? input.pendingLocalDeletes
      .filter((entry): entry is VaultDeletedRecord =>
        !!entry
        && typeof entry.recordId === "string"
        && entry.recordId.length > 0
        && typeof entry.deletedAt === "string"
        && entry.deletedAt.length > 0,
      )
      .map((entry) => ({
        recordId: entry.recordId,
        deletedAt: entry.deletedAt,
      }))
    : [];

  const conflicts = Array.isArray(input?.conflicts)
    ? input.conflicts
      .filter((entry): entry is VaultSyncConflict =>
        !!entry
        && typeof entry.conflictId === "string"
        && entry.conflictId.length > 0
        && isKnownSyncProvider(entry.providerType)
        && typeof entry.providerProfileId === "string"
        && entry.providerProfileId.length > 0
        && typeof entry.recordId === "string"
        && entry.recordId.length > 0
        && (entry.operation === "upsert" || entry.operation === "delete")
        && (
          entry.reason === "remote_changed_before_push"
          || entry.reason === "remote_deleted_before_push"
          || entry.reason === "remote_changed_before_delete"
        )
        && typeof entry.localContentHash === "string"
        && entry.localContentHash.length > 0
        && typeof entry.remoteContentHash === "string"
        && entry.remoteContentHash.length > 0
        && (entry.localVersion === null || typeof entry.localVersion === "number")
        && (entry.remoteVersion === null || typeof entry.remoteVersion === "number")
        && (entry.remoteUpdatedAt === null || typeof entry.remoteUpdatedAt === "string")
        && typeof entry.detectedAt === "string"
        && entry.detectedAt.length > 0
        && (entry.status === "unresolved" || entry.status === "resolved")
        && (
          entry.resolution === undefined
          || entry.resolution === "keep_local"
          || entry.resolution === "keep_remote"
          || entry.resolution === "keep_both"
          || entry.resolution === "manual_edit"
        ),
      )
      .map((entry) => ({
        conflictId: entry.conflictId,
        providerType: entry.providerType,
        providerProfileId: entry.providerProfileId,
        recordId: entry.recordId,
        operation: entry.operation,
        reason: entry.reason,
        localContentHash: entry.localContentHash,
        remoteContentHash: entry.remoteContentHash,
        localVersion: entry.localVersion,
        remoteVersion: entry.remoteVersion,
        remoteUpdatedAt: entry.remoteUpdatedAt,
        detectedAt: entry.detectedAt,
        status: entry.status,
        resolvedAt: typeof entry.resolvedAt === "string" ? entry.resolvedAt : undefined,
        resolution: entry.resolution,
      }))
      .slice(0, 128)
    : [];

  const sanitizeProviderSyncState = (
    providerInput?: Partial<VaultTursoSyncState> | Partial<VaultD1BridgeSyncState> | Partial<VaultD1DirectSyncState>,
  ) => (
    providerInput
    && typeof providerInput.profileId === "string"
    && providerInput.profileId.length > 0
      ? {
        profileId: providerInput.profileId,
        knownRemoteRecords: Array.isArray(providerInput.knownRemoteRecords)
          ? providerInput.knownRemoteRecords
            .filter((entry): entry is VaultKnownRemoteRecord =>
              !!entry
              && typeof entry.recordId === "string"
              && entry.recordId.length > 0
              && typeof entry.updatedAt === "string"
              && entry.updatedAt.length > 0
              && typeof entry.contentHash === "string"
              && entry.contentHash.length > 0
              && typeof entry.version === "number"
              && Number.isFinite(entry.version)
              && entry.version >= 1
              && (entry.deletedAt === null || typeof entry.deletedAt === "string"),
            )
            .map((entry) => ({
              recordId: entry.recordId,
              version: entry.version,
              updatedAt: entry.updatedAt,
              deletedAt: entry.deletedAt,
              contentHash: entry.contentHash,
            }))
          : [],
        lastPulledAt: typeof providerInput.lastPulledAt === "string" ? providerInput.lastPulledAt : undefined,
        lastPushedAt: typeof providerInput.lastPushedAt === "string" ? providerInput.lastPushedAt : undefined,
        lastMergedAt: typeof providerInput.lastMergedAt === "string" ? providerInput.lastMergedAt : undefined,
      }
      : undefined
  );

  const turso = sanitizeProviderSyncState(input?.turso);
  const d1Bridge = sanitizeProviderSyncState(input?.d1Bridge);
  const d1Direct = sanitizeProviderSyncState(input?.d1Direct);

  return {
    ...createEmptyVaultSyncState(),
    pendingLocalDeletes,
    conflicts,
    turso,
    d1Bridge,
    d1Direct,
  };
}

export function mergeVaultSyncConflicts(existing: VaultSyncConflict[], nextConflicts: VaultSyncConflict[]) {
  const merged = new Map<string, VaultSyncConflict>();

  for (const conflict of existing) {
    merged.set(conflict.conflictId, conflict);
  }

  for (const conflict of nextConflicts) {
    merged.set(conflict.conflictId, conflict);
  }

  return Array.from(merged.values())
    .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt) || left.conflictId.localeCompare(right.conflictId))
    .slice(0, 128);
}

export function hasConfiguredVault(storage: Storage) {
  return !!readStorageValue(storage, STORAGE_KEYS.vaultAuth) && !!readStorageValue(storage, STORAGE_KEYS.vaultEnvelope);
}

export function readPinWrapRecord(storage: Storage): PinWrapRecord | null {
  const record = readJson<PinWrapRecord>(storage, STORAGE_KEYS.pinWrap);
  if (!record?.salt || !record?.iv || !record?.ciphertext) return null;
  return record;
}

export function hasQuickUnlockPin(storage: Storage) {
  return !!readPinWrapRecord(storage);
}

export function readSessionKey(storage: Storage) {
  return readStorageValue(storage, STORAGE_KEYS.sessionKey);
}

export function writeSessionKey(storage: Storage, rawKeyBase64: string) {
  writeStorageValue(storage, STORAGE_KEYS.sessionKey, rawKeyBase64);
  writeStorageValue(storage, STORAGE_KEYS.sessionUnlocked, "1");
}

export function clearVaultSession(storage: Storage) {
  removeStorageValue(storage, STORAGE_KEYS.sessionKey);
  removeStorageValue(storage, STORAGE_KEYS.sessionUnlocked);
}

export function clearQuickUnlockPin(storage: Storage) {
  removeStorageValue(storage, STORAGE_KEYS.pinWrap);
}

export function readVaultAuthRecord(storage: Storage): VaultAuthRecord | null {
  const record = readJson<VaultAuthRecord>(storage, STORAGE_KEYS.vaultAuth);
  if (!record?.salt || !record?.verifier) return null;
  const isWrapped =
    record.rootKeyMode === "wrapped"
    || (!!record.rootKeyWrapperIv && !!record.rootKeyWrapperCiphertext);

  if (
    isWrapped
    && (
      record.rootKeyWrapperVersion !== LOCAL_ROOT_WRAP_VERSION
      || record.rootKeyWrapperAlgorithm !== "AES-GCM"
      || !record.rootKeyWrapperIv
      || !record.rootKeyWrapperCiphertext
    )
  ) {
    return null;
  }

  return record;
}

export function readVaultEnvelope(storage: Storage): VaultEnvelope | null {
  const envelope = readJson<VaultEnvelope>(storage, STORAGE_KEYS.vaultEnvelope);
  if (!envelope?.iv || !envelope?.ciphertext) return null;
  return envelope;
}

export async function createVaultAuthRecord(password: string): Promise<{ authRecord: VaultAuthRecord; rawKeyBase64: string }> {
  const salt = bytesToBase64(randomBytes(PBKDF2_SALT_BYTES));
  const derived = await deriveUnlockMaterial(password, salt, PBKDF2_ITERATIONS);
  const timestamp = nowIso();
  return {
    rawKeyBase64: derived.primaryKeyBase64,
    authRecord: {
      version: ENCRYPTED_VAULT_VERSION,
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt,
      verifier: derived.verifierBase64,
      rootKeyMode: "derived",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

async function encryptWrappedRootKey(rawKeyBase64: string, wrapKeyBase64: string) {
  const key = await importVaultKey(wrapKeyBase64, ["encrypt"]);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    textEncoder.encode(rawKeyBase64),
  );

  return {
    rootKeyWrapperVersion: LOCAL_ROOT_WRAP_VERSION,
    rootKeyWrapperAlgorithm: "AES-GCM" as const,
    rootKeyWrapperIv: bytesToBase64(iv),
    rootKeyWrapperCiphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptWrappedRootKey(authRecord: VaultAuthRecord, wrapKeyBase64: string) {
  if (
    authRecord.rootKeyWrapperVersion !== LOCAL_ROOT_WRAP_VERSION
    || authRecord.rootKeyWrapperAlgorithm !== "AES-GCM"
    || !authRecord.rootKeyWrapperIv
    || !authRecord.rootKeyWrapperCiphertext
  ) {
    throw new Error("Wrapped vault auth record is incomplete.");
  }

  const key = await importVaultKey(wrapKeyBase64, ["decrypt"]);
  const plaintext = await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(authRecord.rootKeyWrapperIv),
    },
    key,
    base64ToBytes(authRecord.rootKeyWrapperCiphertext),
  );

  return textDecoder.decode(plaintext);
}

export async function createWrappedVaultAuthRecord(password: string, rawKeyBase64: string): Promise<VaultAuthRecord> {
  const salt = bytesToBase64(randomBytes(PBKDF2_SALT_BYTES));
  const derived = await deriveUnlockMaterial(password, salt, PBKDF2_ITERATIONS);
  const timestamp = nowIso();
  const wrappedRootKey = await encryptWrappedRootKey(rawKeyBase64, derived.primaryKeyBase64);

  return {
    version: ENCRYPTED_VAULT_VERSION,
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt,
    verifier: derived.verifierBase64,
    rootKeyMode: "wrapped",
    ...wrappedRootKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function verifyMasterPassword(storage: Storage, password: string): Promise<string | null> {
  const authRecord = readVaultAuthRecord(storage);
  if (!authRecord) return null;

  const derived = await deriveUnlockMaterial(password, authRecord.salt, authRecord.iterations);
  const verifierMatches = timingSafeEqual(
    base64ToBytes(derived.verifierBase64),
    base64ToBytes(authRecord.verifier),
  );

  if (!verifierMatches) {
    return null;
  }

  if (authRecord.rootKeyMode === "wrapped" || authRecord.rootKeyWrapperCiphertext) {
    return decryptWrappedRootKey(authRecord, derived.primaryKeyBase64);
  }

  return derived.primaryKeyBase64;
}

export async function encryptVaultData(rawKeyBase64: string, data: VaultData): Promise<VaultEnvelope> {
  const key = await importVaultKey(rawKeyBase64, ["encrypt"]);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const plaintext = textEncoder.encode(JSON.stringify(createEmptyVaultData(data)));
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    plaintext,
  );

  return {
    version: ENCRYPTED_VAULT_VERSION,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: nowIso(),
  };
}

export async function decryptVaultData(rawKeyBase64: string, envelope: VaultEnvelope): Promise<VaultData> {
  const key = await importVaultKey(rawKeyBase64, ["decrypt"]);
  const plaintext = await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(envelope.iv),
    },
    key,
    base64ToBytes(envelope.ciphertext),
  );

  const parsed = JSON.parse(textDecoder.decode(plaintext)) as VaultData;
  return createEmptyVaultData(parsed);
}

export async function loadVaultData(storage: Storage, rawKeyBase64: string): Promise<VaultData> {
  const envelope = readVaultEnvelope(storage);
  if (!envelope) {
    return createEmptyVaultData();
  }
  return decryptVaultData(rawKeyBase64, envelope);
}

export async function saveVaultData(storage: Storage, rawKeyBase64: string, data: VaultData) {
  const envelope = await encryptVaultData(rawKeyBase64, {
    ...data,
    updatedAt: nowIso(),
  });
  writeJson(storage, STORAGE_KEYS.vaultEnvelope, envelope);
  return envelope;
}

export async function initializeEncryptedVault(storage: Storage, password: string, initialData: VaultData) {
  const { authRecord, rawKeyBase64 } = await createVaultAuthRecord(password);
  const vaultData = createEmptyVaultData(initialData);
  const envelope = await encryptVaultData(rawKeyBase64, vaultData);
  writeJson(storage, STORAGE_KEYS.vaultAuth, authRecord);
  writeJson(storage, STORAGE_KEYS.vaultEnvelope, envelope);
  return {
    rawKeyBase64,
    authRecord,
    vaultData,
    envelope,
  };
}

export async function installRestoredEncryptedVault(storage: Storage, password: string, rawKeyBase64: string, initialData: VaultData) {
  const authRecord = await createWrappedVaultAuthRecord(password, rawKeyBase64);
  const vaultData = createEmptyVaultData(initialData);
  const envelope = await encryptVaultData(rawKeyBase64, vaultData);
  writeJson(storage, STORAGE_KEYS.vaultAuth, authRecord);
  writeJson(storage, STORAGE_KEYS.vaultEnvelope, envelope);
  return {
    rawKeyBase64,
    authRecord,
    vaultData,
    envelope,
  };
}

export async function unlockEncryptedVault(storage: Storage, password: string) {
  const rawKeyBase64 = await verifyMasterPassword(storage, password);
  if (!rawKeyBase64) return null;

  const vaultData = await loadVaultData(storage, rawKeyBase64);
  return {
    rawKeyBase64,
    vaultData,
  };
}

export async function storeQuickUnlockPin(storage: Storage, pin: string, rawVaultKeyBase64: string) {
  const salt = bytesToBase64(randomBytes(PBKDF2_SALT_BYTES));
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const wrapKeyBase64 = await deriveWrapKeyBase64(pin, salt, PIN_WRAP_ITERATIONS);
  const wrapKey = await importVaultKey(wrapKeyBase64, ["encrypt"]);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    wrapKey,
    textEncoder.encode(rawVaultKeyBase64),
  );
  const timestamp = nowIso();
  const record: PinWrapRecord = {
    version: PIN_WRAP_VERSION,
    kdf: "PBKDF2-SHA-256",
    iterations: PIN_WRAP_ITERATIONS,
    digits: pin.length,
    salt,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  writeJson(storage, STORAGE_KEYS.pinWrap, record);
  return record;
}

export async function unlockWithQuickPin(storage: Storage, pin: string): Promise<string | null> {
  const record = readPinWrapRecord(storage);
  if (!record) return null;

  try {
    const wrapKeyBase64 = await deriveWrapKeyBase64(pin, record.salt, record.iterations);
    const wrapKey = await importVaultKey(wrapKeyBase64, ["decrypt"]);
    const plaintext = await requireCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.iv),
      },
      wrapKey,
      base64ToBytes(record.ciphertext),
    );

    const rawVaultKeyBase64 = textDecoder.decode(plaintext);
    await importVaultKey(rawVaultKeyBase64, ["decrypt"]);
    return rawVaultKeyBase64;
  } catch {
    return null;
  }
}

export function readLegacyPlaintextVault(storage: Storage): VaultData | null {
  const items = readJson<VaultItem[]>(storage, STORAGE_KEYS.vaultItems);
  const activities = readJson<VaultActivity[]>(storage, STORAGE_KEYS.activityLog);
  if (!Array.isArray(items) && !Array.isArray(activities)) {
    return null;
  }

  return createEmptyVaultData({
    items: Array.isArray(items) ? items : [],
    activities: Array.isArray(activities) ? activities.map(sanitizeActivity) : [],
  });
}

export function clearLegacyPlaintextVault(storage: Storage) {
  removeStorageValue(storage, STORAGE_KEYS.vaultItems);
  removeStorageValue(storage, STORAGE_KEYS.activityLog);
}

export function createEncryptedBackupFile(storage: Storage): VaultBackupFile {
  const auth = readVaultAuthRecord(storage);
  const vault = readVaultEnvelope(storage);
  if (!auth || !vault) {
    throw new Error("Encrypted vault is not configured.");
  }

  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    auth,
    vault,
  };
}

export async function parseImportedVaultFile(rawText: string): Promise<
  | { kind: "encrypted"; backup: VaultBackupFile }
  | { kind: "legacy"; data: VaultData }
> {
  const parsed = JSON.parse(rawText) as VaultBackupFile | LegacyPlaintextBackup;

  if (
    (parsed as VaultBackupFile).format === ENCRYPTED_BACKUP_FORMAT
    && (parsed as VaultBackupFile).auth
    && (parsed as VaultBackupFile).vault
  ) {
    return {
      kind: "encrypted",
      backup: parsed as VaultBackupFile,
    };
  }

  const legacy = parsed as LegacyPlaintextBackup;
  let allItems: VaultItem[] = [];

  if (Array.isArray(legacy.items)) {
    allItems = legacy.items as VaultItem[];
  } else if (legacy.items && typeof legacy.items === "object") {
    const nested = legacy.items as Record<string, VaultItem[]>;
    allItems = [
      ...(nested.passwords ?? []),
      ...(nested.totps ?? []),
      ...(nested.notes ?? []),
      ...(nested.cards ?? []),
      ...(nested.sshKeys ?? []),
      ...(nested.identities ?? []),
      ...(nested.apiKeys ?? []),
      ...(nested.wifiNetworks ?? []),
      ...(nested.recoveryCodes ?? []),
      ...(nested.softwareLicenses ?? []),
      ...(nested.databaseCredentials ?? []),
    ];
  } else {
    throw new Error("Unsupported vault file format.");
  }

  return {
    kind: "legacy",
    data: createEmptyVaultData({
      items: allItems,
      activities: [],
    }),
  };
}

export function replaceEncryptedBackup(storage: Storage, backup: VaultBackupFile) {
  writeJson(storage, STORAGE_KEYS.vaultAuth, backup.auth);
  writeJson(storage, STORAGE_KEYS.vaultEnvelope, backup.vault);
  clearQuickUnlockPin(storage);
}

import { APP_NAME, APP_PUBLIC_URL, STORAGE_KEYS, readStorageValue, writeStorageValue } from "./app-config";
import { validateSyncProviderCredentials } from "./sync-provider-validation";
import {
  getSyncProviderDisplayLabel,
  getSyncProviderHint,
  isKnownSyncProvider,
  type SyncProviderType,
} from "./sync-providers";

export {
  BRIDGE_SYNC_PROVIDER_TYPES,
  DIRECT_SYNC_PROVIDER_TYPES,
  SYNC_PROVIDER_TYPES,
  getSyncProviderDisplayLabel,
  getSyncProviderHint,
  isBridgeSyncProvider,
  isKnownSyncProvider,
  type BridgeSyncProviderType,
  type DirectSyncProviderType,
  type SyncProviderType,
} from "./sync-providers";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ACCOUNT_KDF_ALGORITHM = "client-pbkdf2-sha256";
const LEGACY_ACCOUNT_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-verifier";
const ACCOUNT_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-proof-v1";
const ACCOUNT_KDF_ITERATIONS = 310000;
const ACCOUNT_SALT_BYTES = 32;
const ACCOUNT_KEY_BYTES = 32;
const ACCOUNT_DERIVED_BYTES = ACCOUNT_KEY_BYTES * 2;
const ACCOUNT_WRAP_VERSION = "ciphora-account-root-wrap-v1";
const OPAQUE_WRAP_VERSION = "ciphora-account-opaque-root-wrap-v1";
const OPAQUE_KEY_STRETCHING = "memory-constrained";
const OPAQUE_ROOT_WRAPPER_KDF = "opaque-rfc9807-export-key-hkdf-sha256";
const OPAQUE_HKDF_SALT = "ciphora-opaque-export-key-salt-v1";
const OPAQUE_HKDF_INFO = "ciphora-account-root-wrap-key-v1";
const RECOVERY_WRAP_VERSION = "ciphora-recovery-root-wrap-v1";
const RECOVERY_KEY_PREFIX = "ciphora-rk";
const RECOVERY_VERIFIER_VERSION = "v1";
const RECOVERY_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-verifier";
const SYNC_PROFILE_ALGORITHM = "AES-GCM-256";
const DEFAULT_ACCOUNT_API_ORIGIN = APP_PUBLIC_URL;

export interface AccountSession {
  user: {
    userId: string;
    shardId: number;
    accountStatus: string;
  };
  session: {
    expiresAt: string;
  };
}

export interface AccountActionResult {
  ok: boolean;
  message?: string;
  session?: AccountSession;
}

export interface AccountRestoreActionResult extends AccountActionResult {
  rootKeyBase64?: string;
}

export interface RecoveryStatus {
  enabled: boolean;
  upgradeRequired?: boolean;
  status?: "ready" | "upgrade_required" | "not_set";
  recoveryKeyHint: string | null;
  lastRotatedAt: string | null;
}

export interface EmailVerificationStatus {
  verified: boolean;
  verifiedAt: string | null;
}

export interface RecoveryKeySetupResult {
  ok: boolean;
  message?: string;
  recoveryKey?: string;
  recovery?: RecoveryStatus;
}

export interface SyncProfile {
  profileId: string;
  providerType: SyncProviderType;
  providerHint: string | null;
  labelHint: string | null;
  algorithm: string;
  iv: string;
  encryptedConfig: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecryptedSyncProfileConfig {
  providerType: SyncProviderType;
  endpoint: string;
  accessToken: string;
  labelHint: string | null;
  savedAt: string | null;
}

export interface SyncProfileActionResult {
  ok: boolean;
  message?: string;
  syncProfile?: SyncProfile | null;
}

export interface AccountDeviceRecord {
  deviceId: string;
  label: string;
  trusted: boolean;
  trustedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  revokedAt: string | null;
  activeSessionCount: number;
  sessionCount: number;
  isCurrentDevice: boolean;
}

export interface AccountSessionRecord {
  sessionId: string;
  type: "login";
  deviceId: string | null;
  deviceLabel: string;
  trustedDevice: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  status: "active" | "revoked" | "expired";
  isCurrent: boolean;
}

export interface AccountAuditEvent {
  eventId: string;
  type: string;
  label: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface DeviceSessionState {
  currentSessionId: string | null;
  currentDeviceId: string | null;
  devices: AccountDeviceRecord[];
  sessions: AccountSessionRecord[];
  auditEvents: AccountAuditEvent[];
  summary: {
    activeSessionCount: number;
    trustedDeviceCount: number;
    lastLoginAt: string | null;
  };
}

export interface DeviceSessionActionResult extends AccountActionResult {
  currentSessionRevoked?: boolean;
}

interface NormalizedSyncProfileConfigInput {
  providerType: SyncProviderType;
  endpoint: string;
  accessToken: string;
  labelHint: string;
}

interface AccountMaterial {
  wrapKeyBytes: Uint8Array;
  verifier: string;
}

interface AccountUnlockMaterial {
  wrapKeyBytes: Uint8Array;
}

interface LoginMetadata {
  verifierVersion: string;
  verifierAlgorithm: string;
  kdf: {
    algorithm: string;
    iterations: number | null;
    memoryCost: number | null;
    parallelism: number | null;
    salt: string;
  };
  challenge?: {
    token: string;
    expiresAt: string;
    proofAlgorithm: "hmac-sha256";
  };
}

interface RootKeyWrapper {
  wrapperId?: string;
  wrapperType: "password" | "recovery";
  kdfAlgorithm: string;
  kdfParams: Record<string, unknown>;
  algorithm: string;
  iv: string;
  ciphertext: string;
}

interface RecoveryResetPayload {
  challengeToken: string;
  expiresAt: string;
  rootKeyWrapper: RootKeyWrapper;
}

interface AccountApiResponse extends Partial<AccountSession> {
  ok: boolean;
  error?: string;
  authMode?: "opaque" | string;
  login?: LoginMetadata;
  opaque?: {
    configId: string;
    keyStretching?: "memory-constrained" | string;
    rootWrapperKdf?: string;
    registrationResponse?: string;
    registrationRecord?: string;
    challengeToken?: string;
    expiresAt?: string;
    loginResponse?: string;
    serverStaticPublicKey?: string;
  };
  password?: LoginMetadata;
  recoveryReset?: RecoveryResetPayload;
  rootKeyWrappers?: RootKeyWrapper[];
  recovery?: RecoveryStatus;
  emailVerification?: EmailVerificationStatus;
  sent?: boolean;
  expiresAt?: string;
  syncProfile?: SyncProfile | null;
  currentSessionId?: string | null;
  currentDeviceId?: string | null;
  devices?: AccountDeviceRecord[];
  sessions?: AccountSessionRecord[];
  auditEvents?: AccountAuditEvent[];
  summary?: DeviceSessionState["summary"];
  revokedCount?: number;
  currentSessionRevoked?: boolean;
  trusted?: boolean;
}

class AccountApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "AccountApiError";
    this.status = status;
    this.code = code;
  }
}

function hasWindow() {
  return typeof window !== "undefined";
}

function requireCrypto() {
  if (!hasWindow() || !window.crypto?.subtle) {
    throw new Error("Browser crypto is unavailable.");
  }
  return window.crypto;
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

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  requireCrypto().getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function getAccountDeviceId(storage: Storage): string {
  const existing = readStorageValue(storage, STORAGE_KEYS.accountDeviceId);
  if (existing && /^[A-Za-z0-9_-]{16,96}$/.test(existing)) {
    return existing;
  }

  const next = crypto.randomUUID();
  writeStorageValue(storage, STORAGE_KEYS.accountDeviceId, next);
  return next;
}

async function deriveAccountMaterial(password: string, salt: string, iterations: number) {
  const bytes = await derivePbkdf2Bytes(password, salt, iterations, ACCOUNT_DERIVED_BYTES);
  return {
    wrapKeyBytes: bytes.slice(0, ACCOUNT_KEY_BYTES),
    verifier: bytesToBase64Url(bytes.slice(ACCOUNT_KEY_BYTES, ACCOUNT_DERIVED_BYTES)),
  } satisfies AccountMaterial;
}

async function deriveRecoveryMaterial(recoveryKey: string, salt: string, iterations: number) {
  const bytes = await derivePbkdf2Bytes(recoveryKey, salt, iterations, ACCOUNT_DERIVED_BYTES);
  return {
    wrapKeyBytes: bytes.slice(0, ACCOUNT_KEY_BYTES),
    verifier: bytesToBase64Url(bytes.slice(ACCOUNT_KEY_BYTES, ACCOUNT_DERIVED_BYTES)),
  } satisfies AccountMaterial;
}

async function derivePbkdf2Bytes(secret: string, salt: string, iterations: number, byteLength: number) {
  const cryptoApi = requireCrypto();
  const passwordKey = await cryptoApi.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await cryptoApi.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64UrlToBytes(salt),
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    byteLength * 8,
  );
  return new Uint8Array(derivedBits);
}

async function loadOpaque() {
  const opaque = await import("@serenity-kit/opaque");
  await opaque.ready;
  return opaque;
}

async function deriveOpaqueWrapKeyBytes(exportKey: string) {
  const cryptoApi = requireCrypto();
  const baseKey = await cryptoApi.subtle.importKey(
    "raw",
    base64UrlToBytes(exportKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const derivedBits = await cryptoApi.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: textEncoder.encode(OPAQUE_HKDF_SALT),
      info: textEncoder.encode(OPAQUE_HKDF_INFO),
    },
    baseKey,
    ACCOUNT_KEY_BYTES * 8,
  );
  return new Uint8Array(derivedBits);
}

async function createOpaquePasswordWrapper(input: {
  rootKeyBase64: string;
  exportKey: string;
  configId?: string;
  keyStretching?: string;
  serverStaticPublicKey: string;
}) {
  const wrapKeyBytes = await deriveOpaqueWrapKeyBytes(input.exportKey);
  return encryptRootKeyWrapper(
    input.rootKeyBase64,
    wrapKeyBytes,
    "",
    "password",
    OPAQUE_WRAP_VERSION,
    {
      kdfAlgorithm: OPAQUE_ROOT_WRAPPER_KDF,
      kdfParams: {
        version: OPAQUE_WRAP_VERSION,
        opaqueConfigId: input.configId ?? "opaque-rfc9807-serenity-v1",
        keyStretching: input.keyStretching ?? OPAQUE_KEY_STRETCHING,
        serverStaticPublicKey: input.serverStaticPublicKey,
        hkdf: {
          salt: OPAQUE_HKDF_SALT,
          info: OPAQUE_HKDF_INFO,
          hash: "SHA-256",
        },
      },
    },
  );
}

async function hmacBase64Url(secret: string, value: string) {
  const key = await requireCrypto().subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await requireCrypto().subtle.sign("HMAC", key, textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function importWrapKey(wrapKeyBytes: Uint8Array, usages: KeyUsage[]) {
  return requireCrypto().subtle.importKey(
    "raw",
    wrapKeyBytes,
    "AES-GCM",
    false,
    usages,
  );
}

async function importRootKey(rootKeyBase64: string, usages: KeyUsage[]) {
  return requireCrypto().subtle.importKey(
    "raw",
    base64ToBytes(rootKeyBase64),
    "AES-GCM",
    false,
    usages,
  );
}

async function encryptRootKeyWrapper(
  rootKeyBase64: string,
  wrapKeyBytes: Uint8Array,
  kdfSalt: string,
  wrapperType: RootKeyWrapper["wrapperType"] = "password",
  version = ACCOUNT_WRAP_VERSION,
  options: { kdfAlgorithm?: string; kdfParams?: Record<string, unknown> } = {},
): Promise<RootKeyWrapper> {
  const ivBytes = new Uint8Array(12);
  requireCrypto().getRandomValues(ivBytes);
  const key = await importWrapKey(wrapKeyBytes, ["encrypt"]);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    key,
    textEncoder.encode(rootKeyBase64),
  );

  return {
    wrapperType,
    kdfAlgorithm: options.kdfAlgorithm ?? ACCOUNT_KDF_ALGORITHM,
    kdfParams: options.kdfParams ?? {
      version,
      iterations: ACCOUNT_KDF_ITERATIONS,
      salt: kdfSalt,
    },
    algorithm: "AES-GCM-256",
    iv: bytesToBase64Url(ivBytes),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

function generateRecoveryKey() {
  const material = randomBase64Url(32);
  const groups = material.match(/.{1,6}/g)?.join("-") ?? material;
  return `${RECOVERY_KEY_PREFIX}-${groups}`;
}

function getRecoveryKeyHint(recoveryKey: string) {
  const parts = recoveryKey.split("-");
  return parts[parts.length - 1]?.toUpperCase() ?? null;
}

function getWrapperPbkdf2Params(wrapper: RootKeyWrapper) {
  if (wrapper.kdfAlgorithm !== ACCOUNT_KDF_ALGORITHM) {
    throw new Error("Unsupported recovery wrapper KDF.");
  }

  const salt = typeof wrapper.kdfParams.salt === "string" ? wrapper.kdfParams.salt.trim() : "";
  const iterations = Number(wrapper.kdfParams.iterations);
  if (!salt || !Number.isInteger(iterations) || iterations < 100000) {
    throw new Error("Recovery wrapper KDF params are invalid.");
  }

  return {
    salt,
    iterations,
  };
}

async function decryptRootKeyWrapper(wrapper: RootKeyWrapper, wrapKeyBytes: Uint8Array) {
  const key = await importWrapKey(wrapKeyBytes, ["decrypt"]);
  const plaintext = await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(wrapper.iv),
    },
    key,
    base64UrlToBytes(wrapper.ciphertext),
  );
  return textDecoder.decode(plaintext);
}

async function encryptSyncProfileConfig(rootKeyBase64: string, config: Record<string, unknown>) {
  const ivBytes = new Uint8Array(12);
  requireCrypto().getRandomValues(ivBytes);
  const key = await importRootKey(rootKeyBase64, ["encrypt"]);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    key,
    textEncoder.encode(JSON.stringify(config)),
  );

  return {
    algorithm: SYNC_PROFILE_ALGORITHM,
    iv: bytesToBase64Url(ivBytes),
    encryptedConfig: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

function normalizeSyncProfileConfigInput(input: {
  providerType: SyncProviderType;
  labelHint?: string;
  endpoint: string;
  accessToken: string;
}): { ok: true; value: NormalizedSyncProfileConfigInput } | { ok: false; message: string } {
  if (!isKnownSyncProvider(input.providerType)) {
    return { ok: false, message: "Provider sync tidak dikenali." };
  }

  const endpoint = input.endpoint.trim();
  if (!endpoint) {
    return { ok: false, message: "Endpoint sync wajib diisi." };
  }

  const accessToken = input.accessToken.trim();
  if (!accessToken) {
    return { ok: false, message: "Token sync wajib diisi." };
  }

  const credentials = validateSyncProviderCredentials({
    providerType: input.providerType,
    endpoint,
    accessToken,
  });
  if (!credentials.ok) {
    return credentials;
  }

  const labelHint = input.labelHint?.trim() ?? "";
  if (labelHint.length > 80) {
    return { ok: false, message: "Label sync maksimal 80 karakter." };
  }

  return {
    ok: true,
    value: {
      providerType: input.providerType,
      endpoint: credentials.value.endpoint,
      accessToken: credentials.value.accessToken,
      labelHint,
    },
  };
}

export async function createLocalCiphoraSyncProfile(input: {
  rootKeyBase64: string;
  providerType: SyncProviderType;
  labelHint?: string;
  endpoint: string;
  accessToken: string;
  profileId?: string;
}): Promise<SyncProfileActionResult> {
  try {
    const normalized = normalizeSyncProfileConfigInput(input);
    if (!normalized.ok) {
      return normalized;
    }

    const now = new Date().toISOString();
    const encrypted = await encryptSyncProfileConfig(input.rootKeyBase64, {
      providerType: normalized.value.providerType,
      endpoint: normalized.value.endpoint,
      accessToken: normalized.value.accessToken,
      labelHint: normalized.value.labelHint || null,
      savedAt: now,
    });

    return {
      ok: true,
      syncProfile: {
        profileId: input.profileId?.trim() || `local-sync-${randomBase64Url(12)}`,
        providerType: normalized.value.providerType,
        providerHint: getSyncProviderHint(normalized.value.providerType),
        labelHint: normalized.value.labelHint || null,
        algorithm: encrypted.algorithm,
        iv: encrypted.iv,
        encryptedConfig: encrypted.encryptedConfig,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
    };
  } catch (error) {
    return toSyncProfileResultMessage(error, "Gagal menyiapkan sync profile lokal untuk migrasi.");
  }
}

export async function decryptCiphoraSyncProfileConfig(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
}): Promise<DecryptedSyncProfileConfig> {
  const key = await importRootKey(input.rootKeyBase64, ["decrypt"]);
  const plaintext = await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(input.syncProfile.iv),
    },
    key,
    base64UrlToBytes(input.syncProfile.encryptedConfig),
  );

  const parsed = JSON.parse(textDecoder.decode(plaintext)) as Record<string, unknown>;
  const endpoint = typeof parsed.endpoint === "string" ? parsed.endpoint.trim() : "";
  const accessToken = typeof parsed.accessToken === "string" ? parsed.accessToken.trim() : "";
  const labelHint = typeof parsed.labelHint === "string" ? parsed.labelHint.trim() || null : null;
  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : null;
  const providerType = parsed.providerType;

  if (
    (providerType !== undefined && providerType !== input.syncProfile.providerType)
    || !isKnownSyncProvider(input.syncProfile.providerType)
    || !endpoint
    || !accessToken
  ) {
    throw new Error("Stored sync profile is invalid.");
  }

  return {
    providerType: input.syncProfile.providerType,
    endpoint,
    accessToken,
    labelHint,
    savedAt,
  };
}

async function apiRequest(path: string, init: RequestInit): Promise<AccountApiResponse> {
  const response = await fetch(resolveAccountApiPath(path), {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" })) as AccountApiResponse;
  if (!response.ok || body.ok === false) {
    throw new AccountApiError(response.status, body.error ?? "request_failed");
  }
  return body;
}

function isNativePackagedOrigin() {
  if (typeof window === "undefined") return false;

  const capacitorWindow = window as Window & { Capacitor?: unknown };
  return window.location.protocol === "tauri:"
    || window.location.protocol === "capacitor:"
    || window.location.protocol === "ionic:"
    || window.location.hostname === "tauri.localhost"
    || (window.location.protocol === "https:" && window.location.hostname === "localhost" && Boolean(capacitorWindow.Capacitor));
}

function resolveAccountApiPath(path: string) {
  const configuredOrigin = import.meta.env.VITE_CIPHORA_API_BASE?.trim();
  if (configuredOrigin) {
    return new URL(path, configuredOrigin).toString();
  }

  if (isNativePackagedOrigin()) {
    return new URL(path, DEFAULT_ACCOUNT_API_ORIGIN).toString();
  }

  return path;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toResultMessage(error: unknown, fallback: string): AccountActionResult {
  if (error instanceof AccountApiError) {
    if (error.code === "account_unavailable") {
      return { ok: false, message: "Email ini belum bisa dipakai untuk account baru. Coba login jika sudah pernah daftar." };
    }
    if (error.code === "invalid_credentials") {
      return { ok: false, message: "Email atau account password tidak cocok." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." };
    }
    if (error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
  }

  return { ok: false, message: fallback };
}

function toRecoveryResultMessage(error: unknown, fallback: string): RecoveryKeySetupResult {
  if (error instanceof AccountApiError) {
    if (error.code === "not_found") {
      return { ok: false, message: "Login Ciphora account dulu sebelum membuat Recovery Key." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan recovery setup. Tunggu sebentar lalu coba lagi." };
    }
    if (error.code === "invalid_recovery_wrapper") {
      return { ok: false, message: "Recovery wrapper tidak valid." };
    }
    if (error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
  }

  return { ok: false, message: fallback };
}

function toRecoveryResetResultMessage(error: unknown, fallback: string): AccountRestoreActionResult {
  if (error instanceof AccountApiError) {
    if (error.code === "invalid_recovery_credentials") {
      return { ok: false, message: "Email reset link, Recovery Key, atau sesi reset tidak cocok. Minta link reset baru lalu periksa input kamu." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan reset. Tunggu sebentar lalu coba lagi." };
    }
    if (error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
    if (error.code === "opaque_recovery_reset_pending") {
      return { ok: false, message: "Account ini memakai OPAQUE. Recovery reset untuk OPAQUE belum aktif agar vault wrapper tidak korup; gunakan perangkat yang masih login dulu." };
    }
  }

  return { ok: false, message: fallback };
}

function toEmailActionResultMessage(error: unknown, fallback: string): AccountActionResult {
  if (error instanceof AccountApiError) {
    if (error.code === "email_mismatch") {
      return { ok: false, message: "Email yang dimasukkan tidak cocok dengan Ciphora account aktif." };
    }
    if (error.code === "invalid_verification_token") {
      return { ok: false, message: "Link verifikasi email tidak valid atau sudah kedaluwarsa." };
    }
    if (error.code === "email_not_configured") {
      return { ok: false, message: "Email provider belum aktif di deployment ini." };
    }
    if (error.code === "email_delivery_failed") {
      return { ok: false, message: "Gagal mengirim email. Coba lagi sebentar lagi." };
    }
    if (error.code === "email_quota_exhausted") {
      return { ok: false, message: "Kuota email Ciphora hari ini penuh. Coba lagi besok." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan email. Tunggu sebentar lalu coba lagi." };
    }
    if (error.code === "not_found") {
      return { ok: false, message: "Login Ciphora account dulu." };
    }
  }

  return { ok: false, message: fallback };
}

function toPasswordChangeResultMessage(error: unknown, fallback: string): AccountActionResult {
  if (error instanceof AccountApiError) {
    if (error.code === "not_found") {
      return { ok: false, message: "Login Ciphora account dulu sebelum mengganti account password." };
    }
    if (error.code === "invalid_credentials") {
      return { ok: false, message: "Account password lama tidak cocok." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." };
    }
    if (error.code === "account_password_not_configured") {
      return { ok: false, message: "Account password metadata belum lengkap." };
    }
    if (error.code === "opaque_password_rotation_pending") {
      return { ok: false, message: "Account ini sudah memakai OPAQUE. Rotasi password OPAQUE belum diaktifkan di build ini, jadi password lama tidak diubah." };
    }
    if (error.code === "already_opaque") {
      return { ok: false, message: "Account ini sudah memakai OPAQUE. Muat ulang sesi lalu coba ganti password lagi." };
    }
    if (error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
  }

  return { ok: false, message: fallback };
}

function toSyncProfileResultMessage(error: unknown, fallback: string): SyncProfileActionResult {
  if (error instanceof AccountApiError) {
    if (error.code === "not_found") {
      return { ok: false, message: "Login Ciphora account dulu sebelum mengelola sync profile." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." };
    }
    if (
      error.code === "invalid_provider_type"
      || error.code === "invalid_sync_profile"
      || error.code === "invalid_label_hint"
    ) {
      return { ok: false, message: "Sync profile tidak valid." };
    }
    if (error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
  }

  return { ok: false, message: fallback };
}

function toDeviceSessionResultMessage(error: unknown, fallback: string): DeviceSessionActionResult {
  if (error instanceof AccountApiError) {
    if (error.code === "not_found") {
      return { ok: false, message: "Login Ciphora account dulu sebelum mengelola device/session." };
    }
    if (error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak percobaan device/session. Tunggu sebentar lalu coba lagi." };
    }
    if (
      error.code === "invalid_action"
      || error.code === "invalid_session_id"
      || error.code === "invalid_device_id"
      || error.code === "session_not_found"
      || error.code === "device_not_found"
    ) {
      return { ok: false, message: "Device atau session yang dipilih tidak valid lagi. Refresh daftar lalu coba ulang." };
    }
    if (error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
  }

  return { ok: false, message: fallback };
}

export async function getCiphoraAccountSession(): Promise<AccountSession | null> {
  const response = await fetch(resolveAccountApiPath("/api/auth/session"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" })) as AccountApiResponse;
  if (!response.ok || body.ok === false || !body.user || !body.session) {
    throw new AccountApiError(response.status, body.error ?? "session_check_failed");
  }

  return {
    user: body.user,
    session: body.session,
  };
}

export async function getCiphoraDeviceSessionState(): Promise<DeviceSessionState | null> {
  const response = await fetch(resolveAccountApiPath("/api/account/devices"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" })) as AccountApiResponse;
  if (!response.ok || body.ok === false) {
    throw new AccountApiError(response.status, body.error ?? "device_session_state_failed");
  }

  return {
    currentSessionId: body.currentSessionId ?? null,
    currentDeviceId: body.currentDeviceId ?? null,
    devices: Array.isArray(body.devices) ? body.devices : [],
    sessions: Array.isArray(body.sessions) ? body.sessions : [],
    auditEvents: Array.isArray(body.auditEvents) ? body.auditEvents : [],
    summary: body.summary ?? {
      activeSessionCount: 0,
      trustedDeviceCount: 0,
      lastLoginAt: null,
    },
  };
}

export async function revokeCiphoraAccountSession(sessionId: string): Promise<DeviceSessionActionResult> {
  try {
    const body = await apiRequest("/api/account/devices", {
      method: "POST",
      body: JSON.stringify({
        action: "revoke_session",
        sessionId,
      }),
    });

    return {
      ok: true,
      currentSessionRevoked: !!body.currentSessionRevoked,
      message: body.currentSessionRevoked
        ? "Session current browser dicabut. Account session lokal sudah keluar."
        : "Session berhasil dicabut.",
    };
  } catch (error) {
    return toDeviceSessionResultMessage(error, "Gagal mencabut session.");
  }
}

export async function revokeCiphoraAccountSessions(includeCurrent = false): Promise<DeviceSessionActionResult> {
  try {
    const body = await apiRequest("/api/account/devices", {
      method: "POST",
      body: JSON.stringify({
        action: "revoke_sessions",
        includeCurrent,
      }),
    });

    return {
      ok: true,
      currentSessionRevoked: !!body.currentSessionRevoked,
      message: includeCurrent
        ? "Semua account session dicabut, termasuk browser ini."
        : `${body.revokedCount ?? 0} session device lain dicabut.`,
    };
  } catch (error) {
    return toDeviceSessionResultMessage(error, "Gagal mencabut session device.");
  }
}

export async function setCiphoraDeviceTrusted(deviceId: string, trusted: boolean): Promise<DeviceSessionActionResult> {
  try {
    await apiRequest("/api/account/devices", {
      method: "POST",
      body: JSON.stringify({
        action: "set_device_trust",
        deviceId,
        trusted,
      }),
    });

    return {
      ok: true,
      message: trusted ? "Device ditandai dipercaya." : "Trust device dicabut.",
    };
  } catch (error) {
    return toDeviceSessionResultMessage(error, "Gagal mengubah trust device.");
  }
}

export async function getCiphoraEmailVerificationStatus(): Promise<EmailVerificationStatus | null> {
  const response = await fetch(resolveAccountApiPath("/api/email/verification/status"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" })) as AccountApiResponse;
  if (!response.ok || body.ok === false || !body.emailVerification) {
    throw new AccountApiError(response.status, body.error ?? "email_verification_status_failed");
  }

  return body.emailVerification;
}

export async function sendCiphoraEmailVerification(email: string): Promise<AccountActionResult> {
  try {
    const body = await apiRequest("/api/email/verification/send", {
      method: "POST",
      body: JSON.stringify({
        email: normalizeEmail(email),
      }),
    });

    if (body.emailVerification?.verified) {
      return { ok: true, message: "Email account sudah terverifikasi." };
    }

    return {
      ok: true,
      message: body.sent === false
        ? "Email account sudah terverifikasi."
        : "Link verifikasi email dikirim. Buka inbox lalu klik link tersebut.",
    };
  } catch (error) {
    return toEmailActionResultMessage(error, "Gagal mengirim verifikasi email.");
  }
}

export async function confirmCiphoraEmailVerification(token: string): Promise<AccountActionResult & {
  emailVerification?: EmailVerificationStatus;
}> {
  try {
    const body = await apiRequest("/api/email/verification/confirm", {
      method: "POST",
      body: JSON.stringify({
        token: token.trim(),
      }),
    });

    return {
      ok: true,
      message: "Email account berhasil diverifikasi.",
      emailVerification: body.emailVerification,
    };
  } catch (error) {
    return toEmailActionResultMessage(error, "Gagal memverifikasi email.");
  }
}

export async function createCiphoraAccount(input: {
  email: string;
  password: string;
  rootKeyBase64: string;
}): Promise<AccountActionResult> {
  const opaqueResult = await createCiphoraAccountWithOpaque(input);
  if (opaqueResult.ok) {
    return opaqueResult;
  }

  if (opaqueResult.fallbackToLegacy) {
    return createCiphoraAccountWithLegacyVerifier(input);
  }

  return {
    ok: false,
    message: opaqueResult.message ?? "Gagal membuat Ciphora account.",
  };
}

async function createCiphoraAccountWithOpaque(input: {
  email: string;
  password: string;
  rootKeyBase64: string;
}): Promise<AccountActionResult & { fallbackToLegacy?: boolean }> {
  try {
    const email = normalizeEmail(input.email);
    const opaque = await loadOpaque();
    const registrationStart = opaque.client.startRegistration({ password: input.password });
    const start = await apiRequest("/api/auth/opaque/register/start", {
      method: "POST",
      body: JSON.stringify({
        email,
        registrationRequest: registrationStart.registrationRequest,
      }),
    });

    if (!start.opaque?.registrationResponse || !start.opaque.serverStaticPublicKey) {
      return { ok: false, message: "OPAQUE registration response tidak lengkap." };
    }

    const registrationFinish = opaque.client.finishRegistration({
      password: input.password,
      clientRegistrationState: registrationStart.clientRegistrationState,
      registrationResponse: start.opaque.registrationResponse,
      keyStretching: OPAQUE_KEY_STRETCHING,
    });

    if (registrationFinish.serverStaticPublicKey !== start.opaque.serverStaticPublicKey) {
      return { ok: false, message: "OPAQUE server key tidak cocok. Account creation dibatalkan." };
    }

    const wrapper = await createOpaquePasswordWrapper({
      rootKeyBase64: input.rootKeyBase64,
      exportKey: registrationFinish.exportKey,
      configId: start.opaque.configId,
      keyStretching: start.opaque.keyStretching,
      serverStaticPublicKey: start.opaque.serverStaticPublicKey,
    });
    const deviceId = getAccountDeviceId(window.localStorage);
    const body = await apiRequest("/api/auth/opaque/register/finish", {
      method: "POST",
      body: JSON.stringify({
        email,
        registrationRecord: registrationFinish.registrationRecord,
        rootKeyWrappers: [wrapper],
        device: {
          deviceId,
          deviceLabel: `${APP_NAME} Web Vault`,
        },
      }),
    });

    if (!body.user || !body.session) {
      return { ok: false, message: "Account response tidak lengkap." };
    }

    return {
      ok: true,
      session: {
        user: body.user,
        session: body.session,
      },
    };
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "opaque_not_configured") {
      return { ok: false, fallbackToLegacy: true };
    }
    return {
      ...toResultMessage(error, "Gagal membuat Ciphora account dengan OPAQUE."),
      fallbackToLegacy: false,
    };
  }
}

async function createCiphoraAccountWithLegacyVerifier(input: {
  email: string;
  password: string;
  rootKeyBase64: string;
}): Promise<AccountActionResult> {
  try {
    const email = normalizeEmail(input.email);
    const salt = randomBase64Url(ACCOUNT_SALT_BYTES);
    const material = await deriveAccountMaterial(input.password, salt, ACCOUNT_KDF_ITERATIONS);
    const wrapper = await encryptRootKeyWrapper(input.rootKeyBase64, material.wrapKeyBytes, salt);
    const deviceId = getAccountDeviceId(window.localStorage);
    const body = await apiRequest("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        verifier: material.verifier,
        verifierVersion: "v2",
        verifierAlgorithm: ACCOUNT_VERIFIER_ALGORITHM,
        kdf: {
          algorithm: ACCOUNT_KDF_ALGORITHM,
          iterations: ACCOUNT_KDF_ITERATIONS,
          salt,
        },
        rootKeyWrappers: [wrapper],
        device: {
          deviceId,
          deviceLabel: `${APP_NAME} Web Vault`,
        },
      }),
    });

    if (!body.user || !body.session) {
      return { ok: false, message: "Account response tidak lengkap." };
    }

    return {
      ok: true,
      session: {
        user: body.user,
        session: body.session,
      },
    };
  } catch (error) {
    return toResultMessage(error, "Gagal membuat Ciphora account.");
  }
}

export async function loginCiphoraAccount(input: {
  email: string;
  password: string;
  currentRootKeyBase64: string;
}): Promise<AccountActionResult> {
  const result = await loginCiphoraAccountForRestore({
    email: input.email,
    password: input.password,
  });

  if (!result.ok || !result.session || !result.rootKeyBase64) {
    return result;
  }

  if (result.rootKeyBase64 !== input.currentRootKeyBase64) {
    await logoutCiphoraAccount();
    return {
      ok: false,
      message: "Account ini terhubung ke vault key yang berbeda. Login dibatalkan agar vault lokal tidak tertukar.",
    };
  }

  return {
    ok: true,
    session: result.session,
  };
}

export async function loginCiphoraAccountForRestore(input: {
  email: string;
  password: string;
}): Promise<AccountRestoreActionResult> {
  const email = normalizeEmail(input.email);
  const deviceId = getAccountDeviceId(window.localStorage);

  try {
    const opaqueAttempt = await startCiphoraOpaqueLoginAttempt(email, input.password, deviceId);
    if (opaqueAttempt) {
      return finishCiphoraLoginAttempt(opaqueAttempt);
    }
  } catch (error) {
    if (!(error instanceof AccountApiError && error.code === "opaque_not_configured")) {
      if (!(error instanceof AccountApiError && error.code === "invalid_credentials")) {
        return toResultMessage(error, "Gagal login ke Ciphora account dengan OPAQUE.");
      }
    }
  }

  try {
    const attempt = await startCiphoraLoginAttempt(email, input.password, deviceId);
    return finishCiphoraLoginAttempt(attempt);
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "invalid_credentials") {
      try {
        // A brief stale read on login/start can yield fake metadata; refresh once before failing.
        const retry = await startCiphoraLoginAttempt(email, input.password, deviceId);
        return finishCiphoraLoginAttempt(retry);
      } catch (retryError) {
        return toResultMessage(retryError, "Gagal login ke Ciphora account.");
      }
    }

    return toResultMessage(error, "Gagal login ke Ciphora account.");
  }
}

async function startCiphoraOpaqueLoginAttempt(email: string, password: string, deviceId: string): Promise<{
  login: AccountApiResponse;
  material: AccountUnlockMaterial;
} | null> {
  const opaque = await loadOpaque();
  const startLogin = opaque.client.startLogin({ password });
  const start = await apiRequest("/api/auth/opaque/login/start", {
    method: "POST",
    body: JSON.stringify({
      email,
      startLoginRequest: startLogin.startLoginRequest,
    }),
  });

  if (!start.opaque?.challengeToken || !start.opaque.loginResponse || !start.opaque.serverStaticPublicKey) {
    throw new Error("OPAQUE login response tidak lengkap.");
  }

  const loginFinish = opaque.client.finishLogin({
    password,
    clientLoginState: startLogin.clientLoginState,
    loginResponse: start.opaque.loginResponse,
    keyStretching: OPAQUE_KEY_STRETCHING,
  });

  if (!loginFinish) {
    return null;
  }

  if (loginFinish.serverStaticPublicKey !== start.opaque.serverStaticPublicKey) {
    throw new Error("OPAQUE server key tidak cocok. Login dibatalkan.");
  }

  const wrapKeyBytes = await deriveOpaqueWrapKeyBytes(loginFinish.exportKey);

  try {
    const login = await apiRequest("/api/auth/opaque/login/finish", {
      method: "POST",
      body: JSON.stringify({
        email,
        challengeToken: start.opaque.challengeToken,
        finishLoginRequest: loginFinish.finishLoginRequest,
        device: {
          deviceId,
          deviceLabel: `${APP_NAME} Web Vault`,
        },
      }),
    });

    return {
      login,
      material: {
        wrapKeyBytes,
      },
    };
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "invalid_credentials") {
      return null;
    }
    throw error;
  }
}

async function startCiphoraLoginAttempt(email: string, password: string, deviceId: string): Promise<{
  login: AccountApiResponse;
  material: AccountMaterial;
}> {
  const start = await apiRequest("/api/auth/login/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  if (!start.login || start.login.kdf.algorithm !== ACCOUNT_KDF_ALGORITHM || !start.login.kdf.iterations) {
    throw new Error("Account login metadata tidak valid.");
  }

  const material = await deriveAccountMaterial(password, start.login.kdf.salt, start.login.kdf.iterations);
  const loginPayload: Record<string, unknown> = {
    email,
    device: {
      deviceId,
      deviceLabel: `${APP_NAME} Web Vault`,
    },
  };

  if (start.login.verifierAlgorithm === ACCOUNT_VERIFIER_ALGORITHM) {
    if (!start.login.challenge?.token || start.login.challenge.proofAlgorithm !== "hmac-sha256") {
      throw new Error("Account login challenge tidak valid.");
    }
    loginPayload.challengeToken = start.login.challenge.token;
    loginPayload.loginProof = await hmacBase64Url(material.verifier, `login-proof:${start.login.challenge.token}`);
    loginPayload.verifierVersion = "v2";
    loginPayload.verifierAlgorithm = ACCOUNT_VERIFIER_ALGORITHM;
  } else if (start.login.verifierAlgorithm === LEGACY_ACCOUNT_VERIFIER_ALGORITHM) {
    loginPayload.verifier = material.verifier;
    loginPayload.verifierVersion = "v1";
    loginPayload.verifierAlgorithm = LEGACY_ACCOUNT_VERIFIER_ALGORITHM;
  } else {
    throw new Error("Account verifier metadata tidak valid.");
  }

  const login = await apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(loginPayload),
  });

  return {
    login,
    material,
  };
}

async function finishCiphoraLoginAttempt(input: {
  login: AccountApiResponse;
  material: AccountUnlockMaterial;
}): Promise<AccountRestoreActionResult> {
  const passwordWrapper = input.login.rootKeyWrappers?.find((wrapper) => wrapper.wrapperType === "password");
  if (!passwordWrapper) {
    await logoutCiphoraAccount();
    return { ok: false, message: "Account tidak punya root-key wrapper aktif." };
  }

  const accountRootKey = await decryptRootKeyWrapper(passwordWrapper, input.material.wrapKeyBytes);
  if (!input.login.user || !input.login.session) {
    return { ok: false, message: "Account response tidak lengkap." };
  }

  return {
    ok: true,
    rootKeyBase64: accountRootKey,
    session: {
      user: input.login.user,
      session: input.login.session,
    },
  };
}

export async function logoutCiphoraAccount(): Promise<AccountActionResult> {
  try {
    await apiRequest("/api/auth/logout", {
      method: "POST",
      body: "{}",
    });
    return { ok: true };
  } catch (error) {
    return toResultMessage(error, "Gagal logout dari Ciphora account.");
  }
}

async function changeCiphoraOpaqueAccountPassword(input: {
  currentPassword: string;
  newPassword: string;
  rootKeyBase64: string;
}): Promise<AccountActionResult> {
  const opaque = await loadOpaque();
  const currentLoginStart = opaque.client.startLogin({ password: input.currentPassword });
  const nextRegistrationStart = opaque.client.startRegistration({ password: input.newPassword });
  const start = await apiRequest("/api/account/password/opaque/start", {
    method: "POST",
    body: JSON.stringify({
      startLoginRequest: currentLoginStart.startLoginRequest,
      registrationRequest: nextRegistrationStart.registrationRequest,
    }),
  });

  if (
    !start.opaque?.challengeToken
    || !start.opaque.loginResponse
    || !start.opaque.registrationResponse
    || !start.opaque.serverStaticPublicKey
  ) {
    return { ok: false, message: "OPAQUE password-change response tidak lengkap." };
  }

  const currentLoginFinish = opaque.client.finishLogin({
    password: input.currentPassword,
    clientLoginState: currentLoginStart.clientLoginState,
    loginResponse: start.opaque.loginResponse,
    keyStretching: OPAQUE_KEY_STRETCHING,
  });

  if (!currentLoginFinish) {
    return { ok: false, message: "Account password lama tidak cocok." };
  }

  if (currentLoginFinish.serverStaticPublicKey !== start.opaque.serverStaticPublicKey) {
    return { ok: false, message: "OPAQUE server key tidak cocok. Password tidak diubah." };
  }

  const nextRegistrationFinish = opaque.client.finishRegistration({
    password: input.newPassword,
    clientRegistrationState: nextRegistrationStart.clientRegistrationState,
    registrationResponse: start.opaque.registrationResponse,
    keyStretching: OPAQUE_KEY_STRETCHING,
  });

  if (nextRegistrationFinish.serverStaticPublicKey !== start.opaque.serverStaticPublicKey) {
    return { ok: false, message: "OPAQUE server key tidak cocok. Password tidak diubah." };
  }

  const nextWrapper = await createOpaquePasswordWrapper({
    rootKeyBase64: input.rootKeyBase64,
    exportKey: nextRegistrationFinish.exportKey,
    configId: start.opaque.configId,
    keyStretching: start.opaque.keyStretching,
    serverStaticPublicKey: start.opaque.serverStaticPublicKey,
  });

  await apiRequest("/api/account/password/opaque/finish", {
    method: "POST",
    body: JSON.stringify({
      challengeToken: start.opaque.challengeToken,
      finishLoginRequest: currentLoginFinish.finishLoginRequest,
      registrationRecord: nextRegistrationFinish.registrationRecord,
      rootKeyWrappers: [nextWrapper],
    }),
  });

  return { ok: true };
}

async function upgradeLegacyCiphoraAccountPasswordToOpaque(input: {
  currentPassword: string;
  newPassword: string;
  rootKeyBase64: string;
}, metadata: LoginMetadata): Promise<AccountActionResult & { fallbackToLegacy?: boolean }> {
  let canFallbackToLegacy = true;

  try {
    if (metadata.kdf.algorithm !== ACCOUNT_KDF_ALGORITHM || !metadata.kdf.iterations) {
      return { ok: false, message: "Account password metadata tidak valid.", fallbackToLegacy: false };
    }

    const opaque = await loadOpaque();
    const currentMaterial = await deriveAccountMaterial(
      input.currentPassword,
      metadata.kdf.salt,
      metadata.kdf.iterations,
    );
    const registrationStart = opaque.client.startRegistration({ password: input.newPassword });
    const start = await apiRequest("/api/account/password/opaque/upgrade/start", {
      method: "POST",
      body: JSON.stringify({
        registrationRequest: registrationStart.registrationRequest,
      }),
    });

    if (!start.opaque?.registrationResponse || !start.opaque.serverStaticPublicKey) {
      return { ok: false, message: "OPAQUE upgrade response tidak lengkap.", fallbackToLegacy: false };
    }

    canFallbackToLegacy = false;
    const registrationFinish = opaque.client.finishRegistration({
      password: input.newPassword,
      clientRegistrationState: registrationStart.clientRegistrationState,
      registrationResponse: start.opaque.registrationResponse,
      keyStretching: OPAQUE_KEY_STRETCHING,
    });

    if (registrationFinish.serverStaticPublicKey !== start.opaque.serverStaticPublicKey) {
      return { ok: false, message: "OPAQUE server key tidak cocok. Password tidak diubah.", fallbackToLegacy: false };
    }

    const nextWrapper = await createOpaquePasswordWrapper({
      rootKeyBase64: input.rootKeyBase64,
      exportKey: registrationFinish.exportKey,
      configId: start.opaque.configId,
      keyStretching: start.opaque.keyStretching,
      serverStaticPublicKey: start.opaque.serverStaticPublicKey,
    });

    await apiRequest("/api/account/password/opaque/upgrade/finish", {
      method: "POST",
      body: JSON.stringify({
        currentVerifier: currentMaterial.verifier,
        registrationRecord: registrationFinish.registrationRecord,
        rootKeyWrappers: [nextWrapper],
      }),
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "opaque_not_configured") {
      return { ok: false, fallbackToLegacy: true };
    }

    if (canFallbackToLegacy && !(error instanceof AccountApiError)) {
      return { ok: false, fallbackToLegacy: true };
    }

    return {
      ...toPasswordChangeResultMessage(error, "Gagal upgrade legacy account ke OPAQUE."),
      fallbackToLegacy: false,
    };
  }
}

export async function changeCiphoraAccountPassword(input: {
  currentPassword: string;
  newPassword: string;
  rootKeyBase64: string;
}): Promise<AccountActionResult> {
  try {
    const metadata = await apiRequest("/api/account/password/metadata", {
      method: "GET",
    });

    if (metadata.authMode === "opaque") {
      return await changeCiphoraOpaqueAccountPassword(input);
    }

    if (!metadata.password || metadata.password.kdf.algorithm !== ACCOUNT_KDF_ALGORITHM || !metadata.password.kdf.iterations) {
      return { ok: false, message: "Account password metadata tidak valid." };
    }

    const opaqueUpgrade = await upgradeLegacyCiphoraAccountPasswordToOpaque(input, metadata.password);
    if (opaqueUpgrade.ok) {
      return { ok: true };
    }
    if (!opaqueUpgrade.fallbackToLegacy) {
      return { ok: false, message: opaqueUpgrade.message ?? "Gagal upgrade legacy account ke OPAQUE." };
    }

    const currentMaterial = await deriveAccountMaterial(
      input.currentPassword,
      metadata.password.kdf.salt,
      metadata.password.kdf.iterations,
    );
    const nextSalt = randomBase64Url(ACCOUNT_SALT_BYTES);
    const nextMaterial = await deriveAccountMaterial(input.newPassword, nextSalt, ACCOUNT_KDF_ITERATIONS);
    const nextWrapper = await encryptRootKeyWrapper(input.rootKeyBase64, nextMaterial.wrapKeyBytes, nextSalt);

    await apiRequest("/api/account/password/change", {
      method: "POST",
      body: JSON.stringify({
        currentVerifier: currentMaterial.verifier,
        newVerifier: nextMaterial.verifier,
        verifierVersion: "v2",
        verifierAlgorithm: ACCOUNT_VERIFIER_ALGORITHM,
        kdf: {
          algorithm: ACCOUNT_KDF_ALGORITHM,
          iterations: ACCOUNT_KDF_ITERATIONS,
          salt: nextSalt,
        },
        rootKeyWrappers: [nextWrapper],
      }),
    });

    return { ok: true };
  } catch (error) {
    return toPasswordChangeResultMessage(error, "Gagal mengganti Ciphora account password.");
  }
}

export async function getCiphoraRecoveryStatus(): Promise<RecoveryStatus | null> {
  const response = await fetch(resolveAccountApiPath("/api/recovery/status"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" })) as AccountApiResponse;
  if (!response.ok || body.ok === false || !body.recovery) {
    throw new AccountApiError(response.status, body.error ?? "recovery_status_failed");
  }

  return body.recovery;
}

export async function getCiphoraSyncProfile(): Promise<SyncProfile | null> {
  const response = await fetch(resolveAccountApiPath("/api/sync-profile"), {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({ ok: false, error: "invalid_response" })) as AccountApiResponse;
  if (!response.ok || body.ok === false) {
    throw new AccountApiError(response.status, body.error ?? "sync_profile_failed");
  }

  return body.syncProfile ?? null;
}

export async function saveCiphoraSyncProfile(input: {
  rootKeyBase64: string;
  providerType: SyncProviderType;
  labelHint?: string;
  endpoint: string;
  accessToken: string;
}): Promise<SyncProfileActionResult> {
  try {
    const normalized = normalizeSyncProfileConfigInput(input);
    if (!normalized.ok) {
      return normalized;
    }

    const encrypted = await encryptSyncProfileConfig(input.rootKeyBase64, {
      providerType: normalized.value.providerType,
      endpoint: normalized.value.endpoint,
      accessToken: normalized.value.accessToken,
      labelHint: normalized.value.labelHint || null,
      savedAt: new Date().toISOString(),
    });

    const body = await apiRequest("/api/sync-profile", {
      method: "POST",
      body: JSON.stringify({
        providerType: normalized.value.providerType,
        labelHint: normalized.value.labelHint || null,
        algorithm: encrypted.algorithm,
        iv: encrypted.iv,
        encryptedConfig: encrypted.encryptedConfig,
      }),
    });

    if (!body.syncProfile) {
      return { ok: false, message: "Sync profile response tidak lengkap." };
    }

    return {
      ok: true,
      syncProfile: body.syncProfile,
    };
  } catch (error) {
    return toSyncProfileResultMessage(error, "Gagal menyimpan sync profile terenkripsi.");
  }
}

export async function deleteCiphoraSyncProfile(): Promise<SyncProfileActionResult> {
  try {
    const body = await apiRequest("/api/sync-profile", {
      method: "DELETE",
      body: "{}",
    });

    return {
      ok: true,
      syncProfile: body.syncProfile ?? null,
    };
  } catch (error) {
    return toSyncProfileResultMessage(error, "Gagal menonaktifkan sync profile.");
  }
}

export async function setupCiphoraRecoveryKey(input: {
  rootKeyBase64: string;
}): Promise<RecoveryKeySetupResult> {
  try {
    const recoveryKey = generateRecoveryKey();
    const salt = randomBase64Url(ACCOUNT_SALT_BYTES);
    const recoveryMaterial = await deriveRecoveryMaterial(recoveryKey, salt, ACCOUNT_KDF_ITERATIONS);
    const wrapper = await encryptRootKeyWrapper(
      input.rootKeyBase64,
      recoveryMaterial.wrapKeyBytes,
      salt,
      "recovery",
      RECOVERY_WRAP_VERSION,
    );
    const recoveryKeyHint = getRecoveryKeyHint(recoveryKey);
    const body = await apiRequest("/api/recovery/setup", {
      method: "POST",
      body: JSON.stringify({
        rootKeyWrapper: wrapper,
        recoveryKeyHint,
        recoveryVerifier: recoveryMaterial.verifier,
        recoveryVerifierVersion: RECOVERY_VERIFIER_VERSION,
        recoveryVerifierAlgorithm: RECOVERY_VERIFIER_ALGORITHM,
      }),
    });

    if (!body.recovery) {
      return { ok: false, message: "Recovery response tidak lengkap." };
    }

    return {
      ok: true,
      recoveryKey,
      recovery: body.recovery,
    };
  } catch (error) {
    return toRecoveryResultMessage(error, "Gagal membuat Recovery Key.");
  }
}

export async function requestCiphoraRecoveryResetEmail(email: string): Promise<AccountActionResult> {
  try {
    await apiRequest("/api/recovery/email-reset/request", {
      method: "POST",
      body: JSON.stringify({
        email: normalizeEmail(email),
      }),
    });

    return {
      ok: true,
      message: "Jika account ini siap reset, link reset sudah dikirim ke inbox.",
    };
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "rate_limited") {
      return { ok: false, message: "Terlalu banyak permintaan reset. Tunggu sebentar lalu coba lagi." };
    }
    if (error instanceof AccountApiError && error.code === "auth_not_configured") {
      return { ok: false, message: "Account backend belum siap di deployment ini." };
    }
    if (error instanceof AccountApiError && error.code === "email_quota_exhausted") {
      return { ok: false, message: "Kuota email Ciphora hari ini penuh. Coba lagi besok." };
    }
    return { ok: false, message: "Gagal meminta email reset account." };
  }
}

export async function resetCiphoraAccountPasswordWithRecoveryKey(input: {
  email: string;
  emailResetToken: string;
  recoveryKey: string;
  newPassword: string;
}): Promise<AccountRestoreActionResult> {
  try {
    const email = normalizeEmail(input.email);
    let opaque: Awaited<ReturnType<typeof loadOpaque>> | null = null;
    let opaqueRegistrationStart: {
      clientRegistrationState: string;
      registrationRequest: string;
    } | null = null;

    try {
      opaque = await loadOpaque();
      opaqueRegistrationStart = opaque.client.startRegistration({ password: input.newPassword });
    } catch {
      opaque = null;
      opaqueRegistrationStart = null;
    }

    const start = await apiRequest("/api/recovery/reset/start", {
      method: "POST",
      body: JSON.stringify({
        email,
        emailResetToken: input.emailResetToken.trim(),
        ...(opaqueRegistrationStart ? { registrationRequest: opaqueRegistrationStart.registrationRequest } : {}),
      }),
    });

    if (!start.recoveryReset?.challengeToken || !start.recoveryReset.rootKeyWrapper) {
      return { ok: false, message: "Recovery reset response tidak lengkap." };
    }

    const recoveryParams = getWrapperPbkdf2Params(start.recoveryReset.rootKeyWrapper);
    const recoveryMaterial = await deriveRecoveryMaterial(
      input.recoveryKey.trim(),
      recoveryParams.salt,
      recoveryParams.iterations,
    );

    let rootKeyBase64: string;
    try {
      rootKeyBase64 = await decryptRootKeyWrapper(start.recoveryReset.rootKeyWrapper, recoveryMaterial.wrapKeyBytes);
    } catch {
      return {
        ok: false,
        message: "Email, Recovery Key, atau sesi reset tidak cocok. Mulai lagi dan periksa input kamu.",
      };
    }

    const deviceId = getAccountDeviceId(window.localStorage);
    let finish: AccountApiResponse;

    if (
      opaque
      && opaqueRegistrationStart
      && start.opaque?.registrationResponse
      && start.opaque.serverStaticPublicKey
    ) {
      const registrationFinish = opaque.client.finishRegistration({
        password: input.newPassword,
        clientRegistrationState: opaqueRegistrationStart.clientRegistrationState,
        registrationResponse: start.opaque.registrationResponse,
        keyStretching: OPAQUE_KEY_STRETCHING,
      });

      if (registrationFinish.serverStaticPublicKey !== start.opaque.serverStaticPublicKey) {
        return { ok: false, message: "OPAQUE server key tidak cocok. Recovery reset dibatalkan." };
      }

      const nextWrapper = await createOpaquePasswordWrapper({
        rootKeyBase64,
        exportKey: registrationFinish.exportKey,
        configId: start.opaque.configId,
        keyStretching: start.opaque.keyStretching,
        serverStaticPublicKey: start.opaque.serverStaticPublicKey,
      });

      finish = await apiRequest("/api/recovery/reset/finish", {
        method: "POST",
        body: JSON.stringify({
          email,
          challengeToken: start.recoveryReset.challengeToken,
          recoveryVerifier: recoveryMaterial.verifier,
          recoveryVerifierVersion: RECOVERY_VERIFIER_VERSION,
          recoveryVerifierAlgorithm: RECOVERY_VERIFIER_ALGORITHM,
          registrationRecord: registrationFinish.registrationRecord,
          rootKeyWrappers: [nextWrapper],
          device: {
            deviceId,
            deviceLabel: `${APP_NAME} Web Vault`,
          },
        }),
      });
    } else {
      const nextSalt = randomBase64Url(ACCOUNT_SALT_BYTES);
      const nextMaterial = await deriveAccountMaterial(input.newPassword, nextSalt, ACCOUNT_KDF_ITERATIONS);
      const nextWrapper = await encryptRootKeyWrapper(rootKeyBase64, nextMaterial.wrapKeyBytes, nextSalt);

      finish = await apiRequest("/api/recovery/reset/finish", {
        method: "POST",
        body: JSON.stringify({
          email,
          challengeToken: start.recoveryReset.challengeToken,
          recoveryVerifier: recoveryMaterial.verifier,
          recoveryVerifierVersion: RECOVERY_VERIFIER_VERSION,
          recoveryVerifierAlgorithm: RECOVERY_VERIFIER_ALGORITHM,
          newVerifier: nextMaterial.verifier,
          verifierVersion: "v2",
          verifierAlgorithm: ACCOUNT_VERIFIER_ALGORITHM,
          kdf: {
            algorithm: ACCOUNT_KDF_ALGORITHM,
            iterations: ACCOUNT_KDF_ITERATIONS,
            salt: nextSalt,
          },
          rootKeyWrappers: [nextWrapper],
          device: {
            deviceId,
            deviceLabel: `${APP_NAME} Web Vault`,
          },
        }),
      });
    }

    if (!finish.user || !finish.session) {
      return { ok: false, message: "Recovery reset response tidak lengkap." };
    }

    return {
      ok: true,
      rootKeyBase64,
      session: {
        user: finish.user,
        session: finish.session,
      },
    };
  } catch (error) {
    return toRecoveryResetResultMessage(error, "Gagal mereset account password dengan Recovery Key.");
  }
}

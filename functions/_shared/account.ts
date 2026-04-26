import type { CiphoraEnv } from "./env";
import { getIdentityShard } from "./auth";

export interface DirectoryUser {
  user_id: string;
  shard_id: number;
  account_status: string;
}

export interface StoredAuthMetadata {
  verifier_version: string;
  verifier_algorithm: string;
  kdf_algorithm: string;
  iterations: number | null;
  memory_cost: number | null;
  parallelism: number | null;
  salt: string;
}

export interface StoredRootKeyWrapper {
  wrapper_id: string;
  wrapper_type: string;
  kdf_algorithm: string;
  kdf_params_json: string;
  algorithm: string;
  iv: string;
  ciphertext: string;
}

export interface SerializedRootKeyWrapper {
  wrapperId: string;
  wrapperType: "password" | "recovery";
  kdfAlgorithm: string;
  kdfParams: Record<string, unknown>;
  algorithm: string;
  iv: string;
  ciphertext: string;
}

export interface StoredRecoveryMetadata {
  recovery_enabled: number;
  recovery_key_hint: string | null;
  recovery_wrapper_id: string | null;
  last_rotated_at: string | null;
  updated_at: string;
}

export interface StoredRecoveryVerifier {
  verifier_version: string;
  verifier_algorithm: string;
  verifier: string;
}

export interface StoredSyncProfile {
  profile_id: string;
  provider_type: string;
  provider_hint: string | null;
  label_hint: string | null;
  algorithm: string;
  iv: string;
  encrypted_config: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface StoredOpaqueCredential {
  user_id: string;
  config_id: string;
  user_identifier_hash: string;
  registration_record: string;
  server_public_key: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface EmailVerificationStatus {
  verified: boolean;
  verifiedAt: string | null;
}

export async function findDirectoryUser(directory: D1Database, emailHash: string): Promise<DirectoryUser | null> {
  return directory
    .prepare("SELECT user_id, shard_id, account_status FROM directory_users WHERE email_hash = ? LIMIT 1")
    .bind(emailHash)
    .first<DirectoryUser>();
}

export async function getPrimaryEmailHash(shard: D1Database, userId: string): Promise<string | null> {
  const row = await shard
    .prepare("SELECT primary_email_hash FROM users WHERE user_id = ? AND account_status = 'active' LIMIT 1")
    .bind(userId)
    .first<{ primary_email_hash: string }>();
  return row?.primary_email_hash ?? null;
}

export async function getEmailVerificationStatus(
  directory: D1Database,
  emailHash: string,
  userId: string,
): Promise<EmailVerificationStatus> {
  const row = await directory
    .prepare("SELECT verified_at FROM directory_email_aliases WHERE alias_email_hash = ? AND user_id = ? LIMIT 1")
    .bind(emailHash, userId)
    .first<{ verified_at: string | null }>();

  return {
    verified: !!row?.verified_at,
    verifiedAt: row?.verified_at ?? null,
  };
}

export async function getAuthMetadata(shard: D1Database, userId: string): Promise<StoredAuthMetadata | null> {
  return shard
    .prepare(
      "SELECT av.verifier_version, av.verifier_algorithm, uk.kdf_algorithm, uk.iterations, uk.memory_cost, uk.parallelism, uk.salt FROM auth_verifiers av JOIN user_kdf_params uk ON uk.user_id = av.user_id WHERE av.user_id = ? LIMIT 1",
    )
    .bind(userId)
    .first<StoredAuthMetadata>();
}

export async function getStoredVerifier(shard: D1Database, userId: string): Promise<string | null> {
  const row = await shard
    .prepare("SELECT verifier FROM auth_verifiers WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ verifier: string }>();
  return row?.verifier ?? null;
}

export async function getActiveRootKeyWrappers(shard: D1Database, userId: string): Promise<StoredRootKeyWrapper[]> {
  const result = await shard
    .prepare(
      "SELECT wrapper_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext FROM root_key_wrappers WHERE user_id = ? AND revoked_at IS NULL ORDER BY wrapper_type, created_at",
    )
    .bind(userId)
    .all<StoredRootKeyWrapper>();
  return result.results ?? [];
}

export async function getActiveRecoveryWrapper(shard: D1Database, userId: string): Promise<StoredRootKeyWrapper | null> {
  return shard
    .prepare(
      "SELECT wrapper_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext FROM root_key_wrappers WHERE user_id = ? AND wrapper_type = 'recovery' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<StoredRootKeyWrapper>();
}

export async function getRecoveryMetadata(shard: D1Database, userId: string): Promise<StoredRecoveryMetadata | null> {
  return shard
    .prepare(
      "SELECT recovery_enabled, recovery_key_hint, recovery_wrapper_id, last_rotated_at, updated_at FROM recovery_metadata WHERE user_id = ? LIMIT 1",
    )
    .bind(userId)
    .first<StoredRecoveryMetadata>();
}

export async function getActiveRecoveryWrapperCount(shard: D1Database, userId: string): Promise<number> {
  const row = await shard
    .prepare("SELECT COUNT(*) AS count FROM root_key_wrappers WHERE user_id = ? AND wrapper_type = 'recovery' AND revoked_at IS NULL")
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getStoredRecoveryVerifier(shard: D1Database, userId: string): Promise<StoredRecoveryVerifier | null> {
  return shard
    .prepare("SELECT verifier_version, verifier_algorithm, verifier FROM recovery_verifiers WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<StoredRecoveryVerifier>();
}

export async function getOpaqueCredential(shard: D1Database, userId: string): Promise<StoredOpaqueCredential | null> {
  return shard
    .prepare(
      "SELECT user_id, config_id, user_identifier_hash, registration_record, server_public_key, created_at, updated_at, last_login_at FROM opaque_credentials WHERE user_id = ? LIMIT 1",
    )
    .bind(userId)
    .first<StoredOpaqueCredential>();
}

export async function getActiveSyncProfile(shard: D1Database, userId: string): Promise<StoredSyncProfile | null> {
  return shard
    .prepare(
      "SELECT profile_id, provider_type, provider_hint, label_hint, algorithm, iv, encrypted_config, status, created_at, updated_at FROM sync_profiles WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(userId)
    .first<StoredSyncProfile>();
}

export function serializeRootKeyWrappers(rows: StoredRootKeyWrapper[]): SerializedRootKeyWrapper[] {
  return rows.map((row) => ({
    wrapperId: row.wrapper_id,
    wrapperType: row.wrapper_type === "recovery" ? "recovery" : "password",
    kdfAlgorithm: row.kdf_algorithm,
    kdfParams: safeJson(row.kdf_params_json),
    algorithm: row.algorithm,
    iv: row.iv,
    ciphertext: row.ciphertext,
  }));
}

export function serializeRootKeyWrapper(row: StoredRootKeyWrapper): SerializedRootKeyWrapper {
  return serializeRootKeyWrappers([row])[0];
}

export function serializeAuthMetadata(row: StoredAuthMetadata) {
  return {
    verifierVersion: row.verifier_version,
    verifierAlgorithm: row.verifier_algorithm,
    kdf: {
      algorithm: row.kdf_algorithm,
      iterations: row.iterations,
      memoryCost: row.memory_cost,
      parallelism: row.parallelism,
      salt: row.salt,
    },
  };
}

export function serializeRecoveryStatus(
  row: StoredRecoveryMetadata | null,
  activeWrapperCount: number,
  hasStoredRecoveryVerifier = true,
) {
  const hasActiveRecoveryWrapper = activeWrapperCount > 0;
  const hasRecoveryMetadata = !!row && row.recovery_enabled === 1;
  const enabled = hasRecoveryMetadata && hasActiveRecoveryWrapper && hasStoredRecoveryVerifier;
  const upgradeRequired = hasRecoveryMetadata && hasActiveRecoveryWrapper && !hasStoredRecoveryVerifier;
  const exposeLegacyMetadata = enabled || upgradeRequired;
  return {
    enabled,
    upgradeRequired,
    status: enabled ? "ready" : upgradeRequired ? "upgrade_required" : "not_set",
    recoveryKeyHint: exposeLegacyMetadata ? row.recovery_key_hint : null,
    lastRotatedAt: exposeLegacyMetadata ? row.last_rotated_at : null,
  };
}

export function serializeSyncProfile(row: StoredSyncProfile | null) {
  if (!row) return null;
  return {
    profileId: row.profile_id,
    providerType: row.provider_type,
    providerHint: row.provider_hint,
    labelHint: row.label_hint,
    algorithm: row.algorithm,
    iv: row.iv,
    encryptedConfig: row.encrypted_config,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getIdentityShardOrThrow(env: CiphoraEnv, shardId: number): D1Database {
  const shard = getIdentityShard(env, shardId);
  if (shard instanceof Response) {
    throw new Error("identity shard unavailable");
  }
  return shard;
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

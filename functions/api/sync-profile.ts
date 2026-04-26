import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  getUserAgent,
  hashRequestValue,
  readJsonObject,
  requireAuthSecret,
  requireOpsRuntime,
} from "../_shared/auth";
import { getActiveSyncProfile, serializeSyncProfile } from "../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../_shared/http";
import type { CiphoraEnv } from "../_shared/env";

type ProviderType =
  | "external_turso"
  | "external_d1_bridge"
  | "external_d1_direct"
  | "external_tidb_bridge"
  | "external_cockroach_bridge"
  | "external_aiven_bridge"
  | "external_supabase_bridge"
  | "external_mongodb_bridge"
  | "external_firestore_bridge";

const PROVIDER_TYPES = new Set<ProviderType>([
  "external_turso",
  "external_d1_bridge",
  "external_d1_direct",
  "external_tidb_bridge",
  "external_cockroach_bridge",
  "external_aiven_bridge",
  "external_supabase_bridge",
  "external_mongodb_bridge",
  "external_firestore_bridge",
]);
const PROVIDER_HINTS: Record<ProviderType, string> = {
  external_turso: "turso",
  external_d1_bridge: "d1_bridge",
  external_d1_direct: "d1_direct",
  external_tidb_bridge: "tidb_bridge",
  external_cockroach_bridge: "cockroach_bridge",
  external_aiven_bridge: "aiven_postgresql_bridge",
  external_supabase_bridge: "supabase_bridge",
  external_mongodb_bridge: "mongodb_atlas_bridge",
  external_firestore_bridge: "firebase_firestore_bridge",
};
const SYNC_PROFILE_ALGORITHM = "AES-GCM-256";
const SAFE_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

interface SyncProfileInput {
  providerType: ProviderType;
  providerHint: string;
  labelHint: string | null;
  algorithm: string;
  iv: string;
  encryptedConfig: string;
}

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const profile = await getActiveSyncProfile(shard, session.userId);
  return jsonResponse({
    ok: true,
    syncProfile: serializeSyncProfile(profile),
  });
};

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const userRateLimited = await enforceRateLimit(ops, authSecret, "sync-profile-save:user", session.userId, 30, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "sync-profile-save:ip", getClientIp(request), 60, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const input = validateSyncProfileInput(body);
  if (input instanceof Response) return input;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const nowIso = new Date().toISOString();
  const profileId = crypto.randomUUID();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  await shard.batch([
    shard
      .prepare("UPDATE sync_profiles SET status = 'disabled', disabled_at = ?, updated_at = ? WHERE user_id = ? AND status = 'active'")
      .bind(nowIso, nowIso, session.userId),
    shard
      .prepare(
        "INSERT INTO sync_profiles (profile_id, user_id, provider_type, provider_hint, label_hint, algorithm, iv, encrypted_config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      )
      .bind(
        profileId,
        session.userId,
        input.providerType,
        input.providerHint,
        input.labelHint,
        input.algorithm,
        input.iv,
        input.encryptedConfig,
        nowIso,
        nowIso,
      ),
    shard
      .prepare("UPDATE users SET updated_at = ? WHERE user_id = ?")
      .bind(nowIso, session.userId),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'sync_profile.saved', 'info', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId, providerType: input.providerType }),
        nowIso,
      ),
  ]);

  return jsonResponse({
    ok: true,
    syncProfile: {
      profileId,
      providerType: input.providerType,
      providerHint: input.providerHint,
      labelHint: input.labelHint,
      algorithm: input.algorithm,
      iv: input.iv,
      encryptedConfig: input.encryptedConfig,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  });
};

export const onRequestDelete: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const userRateLimited = await enforceRateLimit(ops, authSecret, "sync-profile-disable:user", session.userId, 30, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "sync-profile-disable:ip", getClientIp(request), 60, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const nowIso = new Date().toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  await shard.batch([
    shard
      .prepare("UPDATE sync_profiles SET status = 'disabled', disabled_at = ?, updated_at = ? WHERE user_id = ? AND status = 'active'")
      .bind(nowIso, nowIso, session.userId),
    shard
      .prepare("UPDATE users SET updated_at = ? WHERE user_id = ?")
      .bind(nowIso, session.userId),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'sync_profile.disabled', 'warning', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId }),
        nowIso,
      ),
  ]);

  return jsonResponse({
    ok: true,
    syncProfile: null,
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET", "POST", "DELETE"]);

function validateSyncProfileInput(input: Record<string, unknown>): SyncProfileInput | Response {
  const providerType = typeof input.providerType === "string" ? input.providerType.trim() : "";
  if (!PROVIDER_TYPES.has(providerType as ProviderType)) {
    return errorResponse("invalid_provider_type", 400);
  }

  const algorithm = typeof input.algorithm === "string" ? input.algorithm.trim() : "";
  if (algorithm !== SYNC_PROFILE_ALGORITHM) {
    return errorResponse("invalid_sync_profile", 400);
  }

  const iv = validateBase64UrlString(input.iv, "invalid_sync_profile", 8, 512);
  if (iv instanceof Response) return iv;

  const encryptedConfig = validateBase64UrlString(input.encryptedConfig, "invalid_sync_profile", 16, 16384);
  if (encryptedConfig instanceof Response) return encryptedConfig;

  const labelHint = validateHint(input.labelHint, "invalid_label_hint", 0, 80);
  if (labelHint instanceof Response) return labelHint;

  return {
    providerType: providerType as ProviderType,
    providerHint: PROVIDER_HINTS[providerType as ProviderType],
    labelHint,
    algorithm,
    iv,
    encryptedConfig,
  };
}

function validateHint(input: unknown, error: string, min: number, max: number): string | null | Response {
  if (input == null) {
    return null;
  }

  if (typeof input !== "string") {
    return errorResponse(error, 400);
  }

  const value = input.trim();
  if (value.length < min || value.length > max || /[\u0000-\u001f]/.test(value)) {
    return errorResponse(error, 400);
  }

  return value || null;
}

function validateBase64UrlString(input: unknown, error: string, min: number, max: number): string | Response {
  if (typeof input !== "string") {
    return errorResponse(error, 400);
  }

  const value = input.trim();
  if (value.length < min || value.length > max || !SAFE_BASE64URL_PATTERN.test(value)) {
    return errorResponse(error, 400);
  }

  return value;
}

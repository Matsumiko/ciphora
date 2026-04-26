import {
  SESSION_MAX_AGE_SECONDS,
  assertSameOrigin,
  createSessionToken,
  emailHash,
  enforceAuthRateLimits,
  getClientIp,
  getUserAgent,
  hashRequestValue,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
  sessionCookie,
  sessionTokenHash,
  shardFromEmailHash,
  validateDevice,
  validateRootKeyWrappers,
} from "../../../../_shared/auth";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../../_shared/http";
import { getIdentityShard } from "../../../../_shared/auth";
import {
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  OPAQUE_ROOT_WRAPPER_KDF,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
} from "../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../_shared/env";

const PASSWORD_WRAPPER_ALGORITHM = "AES-GCM-256";

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const serverSetup = requireOpaqueServerSetup(env);
  if (serverSetup instanceof Response) return serverSetup;

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const normalizedEmail = normalizeEmail(body.email);
  if (normalizedEmail instanceof Response) return normalizedEmail;

  const registrationRecord = validateOpaqueMessage(body.registrationRecord, "invalid_registration_record", 64);
  if (registrationRecord instanceof Response) return registrationRecord;

  const wrappers = validateRootKeyWrappers(body.rootKeyWrappers);
  if (wrappers instanceof Response) return wrappers;

  const passwordWrapper = wrappers.find((wrapper) => wrapper.wrapperType === "password");
  if (!passwordWrapper) {
    return errorResponse("missing_password_wrapper", 400);
  }
  if (passwordWrapper.kdfAlgorithm !== OPAQUE_ROOT_WRAPPER_KDF || passwordWrapper.algorithm !== PASSWORD_WRAPPER_ALGORITHM) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const rateLimited = await enforceAuthRateLimits(request, ops, authSecret, "signup", normalizedEmail);
  if (rateLimited) return rateLimited;

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const existing = await directory
    .prepare("SELECT user_id FROM directory_users WHERE email_hash = ? LIMIT 1")
    .bind(normalizedEmailHash)
    .first<{ user_id: string }>();

  if (existing) {
    return errorResponse("account_unavailable", 409);
  }

  const shardId = shardFromEmailHash(normalizedEmailHash);
  const shard = getIdentityShard(env, shardId);
  if (shard instanceof Response) return shard;

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const expiresAtIso = expiresAt.toISOString();
  const userId = crypto.randomUUID();
  const device = validateDevice(body.device);
  const deviceId = device.deviceId ?? crypto.randomUUID();
  const token = createSessionToken(shardId);
  const tokenHash = await sessionTokenHash(authSecret, token);
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));
  const serverPublicKey = await getOpaqueServerPublicKey(serverSetup);
  const credentialFingerprint = await hashRequestValue(authSecret, "opaque-credential", registrationRecord);
  const wrapperStatements = wrappers.map((wrapper) => shard
    .prepare(
      "INSERT INTO root_key_wrappers (wrapper_id, user_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      userId,
      wrapper.wrapperType,
      wrapper.kdfAlgorithm,
      JSON.stringify(wrapper.kdfParams),
      wrapper.algorithm,
      wrapper.iv,
      wrapper.ciphertext,
      nowIso,
      nowIso,
    ));

  try {
    await shard.batch([
      shard
        .prepare("INSERT INTO users (user_id, primary_email_hash, account_status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)")
        .bind(userId, normalizedEmailHash, nowIso, nowIso),
      shard
        .prepare("INSERT INTO opaque_credentials (user_id, config_id, user_identifier_hash, registration_record, server_public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(userId, OPAQUE_CONFIG_ID, normalizedEmailHash, registrationRecord, serverPublicKey, nowIso, nowIso),
      ...wrapperStatements,
      shard
        .prepare("INSERT INTO recovery_metadata (user_id, recovery_enabled, recovery_wrapper_id, created_at, updated_at) VALUES (?, 0, NULL, ?, ?)")
        .bind(userId, nowIso, nowIso),
      shard
        .prepare("INSERT INTO devices (device_id, user_id, device_label, device_public_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(deviceId, userId, device.deviceLabel ?? null, device.devicePublicKey ?? null, nowIso, nowIso),
      shard
        .prepare("INSERT INTO sessions (session_id, user_id, device_id, session_token_hash, ip_hash, user_agent_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), userId, deviceId, tokenHash, ipHash, userAgentHash, nowIso, nowIso, expiresAtIso),
      shard
        .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'account.signup', 'info', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), userId, ipHash, userAgentHash, JSON.stringify({ shardId, authMode: "opaque" }), nowIso),
    ]);

    await directory
      .prepare("INSERT INTO directory_users (email_hash, user_id, shard_id, account_status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .bind(normalizedEmailHash, userId, shardId, nowIso, nowIso)
      .run();
    await ops
      .prepare(
        "INSERT INTO opaque_credential_epochs (user_id, credential_fingerprint, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET credential_fingerprint = excluded.credential_fingerprint, updated_at = excluded.updated_at",
      )
      .bind(userId, credentialFingerprint, nowIso)
      .run();
  } catch {
    await shard.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM devices WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM root_key_wrappers WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM recovery_metadata WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM opaque_credentials WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM account_events WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM users WHERE user_id = ?").bind(userId).run();
    await directory.prepare("DELETE FROM directory_email_aliases WHERE user_id = ?").bind(userId).run();
    await directory.prepare("DELETE FROM directory_users WHERE user_id = ?").bind(userId).run();
    await ops.prepare("DELETE FROM opaque_credential_epochs WHERE user_id = ?").bind(userId).run();
    await ops.prepare("DELETE FROM opaque_credential_revocations WHERE user_id = ?").bind(userId).run();
    return errorResponse("account_unavailable", 409);
  }

  return jsonResponse(
    {
      ok: true,
      authMode: "opaque",
      user: {
        userId,
        shardId,
        accountStatus: "active",
      },
      session: {
        expiresAt: expiresAtIso,
      },
    },
    {
      status: 201,
      headers: {
        "set-cookie": sessionCookie(token, expiresAt, request),
      },
    },
  );
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

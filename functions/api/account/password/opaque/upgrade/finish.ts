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
  validateRootKeyWrappers,
  validateVerifier,
  verifyStoredVerifier,
} from "../../../../../_shared/auth";
import { getOpaqueCredential, getStoredVerifier } from "../../../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../../../_shared/http";
import {
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
  validateOpaquePasswordWrapper,
} from "../../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../../_shared/env";

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const serverSetup = requireOpaqueServerSetup(env);
  if (serverSetup instanceof Response) return serverSetup;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const userRateLimited = await enforceRateLimit(ops, authSecret, "opaque-upgrade-finish:user", session.userId, 8, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "opaque-upgrade-finish:ip", getClientIp(request), 30, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const currentVerifier = validateVerifier(body.currentVerifier);
  if (currentVerifier instanceof Response) return currentVerifier;

  const registrationRecord = validateOpaqueMessage(body.registrationRecord, "invalid_registration_record", 64);
  if (registrationRecord instanceof Response) return registrationRecord;

  const wrapperPayload = body.rootKeyWrapper ? [body.rootKeyWrapper] : body.rootKeyWrappers;
  const wrappers = validateRootKeyWrappers(wrapperPayload);
  if (wrappers instanceof Response) return wrappers;

  if (wrappers.length !== 1 || wrappers[0].wrapperType !== "password") {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const serverPublicKey = await getOpaqueServerPublicKey(serverSetup);
  const kdfParamsJson = validateOpaquePasswordWrapper(wrappers[0], serverPublicKey);
  if (kdfParamsJson instanceof Response) return kdfParamsJson;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const [userRow, storedVerifier, opaqueCredential] = await Promise.all([
    shard
      .prepare("SELECT primary_email_hash FROM users WHERE user_id = ? AND account_status = 'active' LIMIT 1")
      .bind(session.userId)
      .first<{ primary_email_hash: string }>(),
    getStoredVerifier(shard, session.userId),
    getOpaqueCredential(shard, session.userId),
  ]);

  if (!userRow) {
    return errorResponse("not_found", 404);
  }
  if (opaqueCredential) {
    return errorResponse("already_opaque", 409);
  }
  if (!storedVerifier) {
    return errorResponse("account_password_not_configured", 409);
  }

  const nowIso = new Date().toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  if (!(await verifyStoredVerifier(authSecret, currentVerifier, storedVerifier))) {
    await shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.opaque_upgrade_failed', 'warning', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId }),
        nowIso,
      )
      .run();
    return errorResponse("invalid_credentials", 401);
  }

  const passwordWrapper = wrappers[0];
  const wrapperId = crypto.randomUUID();

  await shard.batch([
    shard
      .prepare("INSERT INTO opaque_credentials (user_id, config_id, user_identifier_hash, registration_record, server_public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(session.userId, OPAQUE_CONFIG_ID, userRow.primary_email_hash, registrationRecord, serverPublicKey, nowIso, nowIso),
    shard
      .prepare("DELETE FROM auth_verifiers WHERE user_id = ?")
      .bind(session.userId),
    shard
      .prepare("DELETE FROM user_kdf_params WHERE user_id = ?")
      .bind(session.userId),
    shard
      .prepare("UPDATE root_key_wrappers SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND wrapper_type = 'password' AND revoked_at IS NULL")
      .bind(nowIso, nowIso, session.userId),
    shard
      .prepare(
        "INSERT INTO root_key_wrappers (wrapper_id, user_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext, created_at, updated_at) VALUES (?, ?, 'password', ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        wrapperId,
        session.userId,
        passwordWrapper.kdfAlgorithm,
        kdfParamsJson,
        passwordWrapper.algorithm,
        passwordWrapper.iv,
        passwordWrapper.ciphertext,
        nowIso,
        nowIso,
      ),
    shard
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND session_id != ? AND revoked_at IS NULL")
      .bind(nowIso, session.userId, session.sessionId),
    shard
      .prepare("UPDATE users SET updated_at = ? WHERE user_id = ?")
      .bind(nowIso, session.userId),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.opaque_upgrade', 'info', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId, passwordWrapperRotated: true, otherSessionsRevoked: true }),
        nowIso,
      ),
  ]);

  return jsonResponse({
    ok: true,
    authMode: "opaque",
    session: {
      expiresAt: session.expiresAt,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

import {
  assertSameOrigin,
  CHALLENGE_PASSWORD_VERIFIER_ALGORITHM,
  createStoredLoginVerifier,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  getUserAgent,
  hashRequestValue,
  readJsonObject,
  requireAuthSecret,
  requireOpsRuntime,
  validateKdf,
  validateRootKeyWrappers,
  validateVerifier,
  verifyStoredVerifier,
} from "../../../_shared/auth";
import { getOpaqueCredential, getStoredVerifier } from "../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

const PASSWORD_VERIFIER_VERSION = "v2";
const PASSWORD_VERIFIER_ALGORITHM = CHALLENGE_PASSWORD_VERIFIER_ALGORITHM;
const PASSWORD_WRAPPER_KDF = "client-pbkdf2-sha256";
const PASSWORD_WRAPPER_ALGORITHM = "AES-GCM-256";

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

  const userRateLimited = await enforceRateLimit(ops, authSecret, "password-change:user", session.userId, 8, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "password-change:ip", getClientIp(request), 30, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const currentVerifier = validateVerifier(body.currentVerifier);
  if (currentVerifier instanceof Response) return currentVerifier;

  const newVerifier = validateVerifier(body.newVerifier);
  if (newVerifier instanceof Response) return newVerifier;

  const kdf = validateKdf(body.kdf ?? body.newKdf);
  if (kdf instanceof Response) return kdf;

  const wrapperPayload = body.rootKeyWrapper ? [body.rootKeyWrapper] : body.rootKeyWrappers;
  const wrappers = validateRootKeyWrappers(wrapperPayload);
  if (wrappers instanceof Response) return wrappers;

  if (wrappers.length !== 1 || wrappers[0].wrapperType !== "password") {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const passwordWrapper = wrappers[0];
  if (passwordWrapper.kdfAlgorithm !== PASSWORD_WRAPPER_KDF || passwordWrapper.algorithm !== PASSWORD_WRAPPER_ALGORITHM) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const kdfParamsJson = JSON.stringify(passwordWrapper.kdfParams);
  if (kdfParamsJson.length > 4096) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const verifierVersion = typeof body.verifierVersion === "string" ? body.verifierVersion.trim() : PASSWORD_VERIFIER_VERSION;
  const verifierAlgorithm = typeof body.verifierAlgorithm === "string" ? body.verifierAlgorithm.trim() : PASSWORD_VERIFIER_ALGORITHM;
  if (verifierVersion !== PASSWORD_VERIFIER_VERSION || verifierAlgorithm !== PASSWORD_VERIFIER_ALGORITHM) {
    return errorResponse("invalid_verifier_metadata", 400);
  }

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const storedVerifier = await getStoredVerifier(shard, session.userId);
  if (!storedVerifier) {
    const opaqueCredential = await getOpaqueCredential(shard, session.userId);
    if (opaqueCredential) {
      return errorResponse("opaque_password_rotation_pending", 409);
    }
    return errorResponse("account_password_not_configured", 409);
  }

  const nowIso = new Date().toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  if (!(await verifyStoredVerifier(authSecret, currentVerifier, storedVerifier))) {
    await shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.password_change_failed', 'warning', ?, ?, ?, ?)")
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

  const nextStoredVerifier = await createStoredLoginVerifier(authSecret, newVerifier);
  const wrapperId = crypto.randomUUID();

  await shard.batch([
    shard
      .prepare("UPDATE auth_verifiers SET verifier_version = ?, verifier_algorithm = ?, verifier = ?, updated_at = ? WHERE user_id = ?")
      .bind(verifierVersion, verifierAlgorithm, nextStoredVerifier, nowIso, session.userId),
    shard
      .prepare("UPDATE user_kdf_params SET kdf_algorithm = ?, iterations = ?, memory_cost = ?, parallelism = ?, salt = ?, updated_at = ? WHERE user_id = ?")
      .bind(kdf.algorithm, kdf.iterations, kdf.memoryCost, kdf.parallelism, kdf.salt, nowIso, session.userId),
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
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.password_change', 'info', ?, ?, ?, ?)")
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
    session: {
      expiresAt: session.expiresAt,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

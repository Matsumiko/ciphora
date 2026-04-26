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
  validateRecoveryKeyHint,
  validateRootKeyWrappers,
  validateVerifier,
} from "../../_shared/auth";
import { hashVerifier } from "../../_shared/crypto";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../_shared/http";
import type { CiphoraEnv } from "../../_shared/env";

const RECOVERY_VERIFIER_VERSION = "v1";
const RECOVERY_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-verifier";

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

  const userRateLimited = await enforceRateLimit(ops, authSecret, "recovery-setup:user", session.userId, 12, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "recovery-setup:ip", getClientIp(request), 30, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const wrapperPayload = body.rootKeyWrapper ? [body.rootKeyWrapper] : body.rootKeyWrappers;
  const wrappers = validateRootKeyWrappers(wrapperPayload, { requirePasswordWrapper: false });
  if (wrappers instanceof Response) return wrappers;

  if (wrappers.length !== 1 || wrappers[0].wrapperType !== "recovery") {
    return errorResponse("invalid_recovery_wrapper", 400);
  }

  const wrapper = wrappers[0];
  if (wrapper.kdfAlgorithm !== "client-pbkdf2-sha256" || wrapper.algorithm !== "AES-GCM-256") {
    return errorResponse("invalid_recovery_wrapper", 400);
  }

  const kdfParamsJson = JSON.stringify(wrapper.kdfParams);
  if (kdfParamsJson.length > 4096) {
    return errorResponse("invalid_recovery_wrapper", 400);
  }

  const recoveryVerifier = validateVerifier(body.recoveryVerifier);
  if (recoveryVerifier instanceof Response) return recoveryVerifier;

  const recoveryVerifierVersion = typeof body.recoveryVerifierVersion === "string"
    ? body.recoveryVerifierVersion.trim()
    : RECOVERY_VERIFIER_VERSION;
  const recoveryVerifierAlgorithm = typeof body.recoveryVerifierAlgorithm === "string"
    ? body.recoveryVerifierAlgorithm.trim()
    : RECOVERY_VERIFIER_ALGORITHM;
  if (
    recoveryVerifierVersion !== RECOVERY_VERIFIER_VERSION
    || recoveryVerifierAlgorithm !== RECOVERY_VERIFIER_ALGORITHM
  ) {
    return errorResponse("invalid_recovery_verifier", 400);
  }

  const recoveryKeyHint = validateRecoveryKeyHint(body.recoveryKeyHint);
  if (recoveryKeyHint instanceof Response) return recoveryKeyHint;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const nowIso = new Date().toISOString();
  const wrapperId = crypto.randomUUID();
  const storedRecoveryVerifier = await hashVerifier(authSecret, recoveryVerifier);
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  await shard.batch([
    shard
      .prepare("UPDATE root_key_wrappers SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND wrapper_type = 'recovery' AND revoked_at IS NULL")
      .bind(nowIso, nowIso, session.userId),
    shard
      .prepare(
        "INSERT INTO root_key_wrappers (wrapper_id, user_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext, created_at, updated_at) VALUES (?, ?, 'recovery', ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        wrapperId,
        session.userId,
        wrapper.kdfAlgorithm,
        kdfParamsJson,
        wrapper.algorithm,
        wrapper.iv,
        wrapper.ciphertext,
        nowIso,
        nowIso,
      ),
    shard
      .prepare(
        "INSERT INTO recovery_metadata (user_id, recovery_enabled, recovery_key_hint, recovery_wrapper_id, last_rotated_at, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET recovery_enabled = 1, recovery_key_hint = excluded.recovery_key_hint, recovery_wrapper_id = excluded.recovery_wrapper_id, last_rotated_at = excluded.last_rotated_at, updated_at = excluded.updated_at",
      )
      .bind(session.userId, recoveryKeyHint, wrapperId, nowIso, nowIso, nowIso),
    shard
      .prepare(
        "INSERT INTO recovery_verifiers (user_id, verifier_version, verifier_algorithm, verifier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET verifier_version = excluded.verifier_version, verifier_algorithm = excluded.verifier_algorithm, verifier = excluded.verifier, updated_at = excluded.updated_at",
      )
      .bind(
        session.userId,
        recoveryVerifierVersion,
        recoveryVerifierAlgorithm,
        storedRecoveryVerifier,
        nowIso,
        nowIso,
      ),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'recovery.setup', 'info', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId, rotated: true }),
        nowIso,
      ),
  ]);

  return jsonResponse({
    ok: true,
    recovery: {
      enabled: true,
      recoveryKeyHint,
      lastRotatedAt: nowIso,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

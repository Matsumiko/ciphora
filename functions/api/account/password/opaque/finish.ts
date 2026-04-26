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
  validateChallengeToken,
  validateRootKeyWrappers,
} from "../../../../_shared/auth";
import { getOpaqueCredential } from "../../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../../_shared/http";
import {
  finishOpaqueLogin,
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
  validateOpaquePasswordWrapper,
} from "../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../_shared/env";

const OPAQUE_PASSWORD_CHANGE_MAX_ATTEMPTS = 5;

interface OpaquePasswordChallenge {
  challenge_id: string;
  user_id: string | null;
  email_hash: string;
  server_login_state: string;
  credential_fingerprint: string | null;
  is_fake: number;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

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

  const userRateLimited = await enforceRateLimit(ops, authSecret, "opaque-password-change-finish:user", session.userId, 8, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "opaque-password-change-finish:ip", getClientIp(request), 30, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const challengeToken = validateChallengeToken(body.challengeToken, "invalid_credentials");
  if (challengeToken instanceof Response) return challengeToken;

  const finishLoginRequest = validateOpaqueMessage(body.finishLoginRequest, "invalid_credentials", 64);
  if (finishLoginRequest instanceof Response) return finishLoginRequest;

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

  const [userRow, credential] = await Promise.all([
    shard
      .prepare("SELECT primary_email_hash FROM users WHERE user_id = ? AND account_status = 'active' LIMIT 1")
      .bind(session.userId)
      .first<{ primary_email_hash: string }>(),
    getOpaqueCredential(shard, session.userId),
  ]);

  if (!userRow || !credential) {
    return errorResponse("opaque_password_not_configured", 409);
  }

  const challengeTokenHash = await hashRequestValue(authSecret, "opaque-login-token", challengeToken);
  const challenge = await ops
    .prepare(
      "SELECT challenge_id, user_id, email_hash, server_login_state, credential_fingerprint, is_fake, attempts, expires_at, consumed_at FROM opaque_login_challenges WHERE email_hash = ? AND token_hash = ? LIMIT 1",
    )
    .bind(userRow.primary_email_hash, challengeTokenHash)
    .first<OpaquePasswordChallenge>();

  const now = new Date();
  const nowIso = now.toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  const genericInvalid = async (challengeId?: string) => {
    if (challengeId) {
      await ops
        .prepare("UPDATE opaque_login_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND consumed_at IS NULL")
        .bind(challengeId)
        .run();
    }

    await shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.password_change_failed', 'warning', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId, authMode: "opaque" }),
        nowIso,
      )
      .run();

    return errorResponse("invalid_credentials", 401);
  };

  if (
    !challenge
    || challenge.consumed_at
    || Date.parse(challenge.expires_at) <= now.getTime()
    || challenge.attempts >= OPAQUE_PASSWORD_CHANGE_MAX_ATTEMPTS
    || challenge.is_fake === 1
    || challenge.user_id !== session.userId
    || challenge.email_hash !== userRow.primary_email_hash
    || !challenge.credential_fingerprint
  ) {
    return genericInvalid(challenge?.challenge_id);
  }

  const currentCredentialFingerprint = await hashRequestValue(authSecret, "opaque-credential", credential.registration_record);
  const currentRevoked = await ops
    .prepare("SELECT 1 FROM opaque_credential_revocations WHERE user_id = ? AND credential_fingerprint = ? LIMIT 1")
    .bind(session.userId, currentCredentialFingerprint)
    .first();
  if (currentRevoked) {
    return genericInvalid(challenge.challenge_id);
  }

  if (challenge.credential_fingerprint) {
    const challengeRevoked = await ops
      .prepare("SELECT 1 FROM opaque_credential_revocations WHERE user_id = ? AND credential_fingerprint = ? LIMIT 1")
      .bind(session.userId, challenge.credential_fingerprint)
      .first();
    if (challengeRevoked) {
      return genericInvalid(challenge.challenge_id);
    }

    const epoch = await ops
      .prepare("SELECT credential_fingerprint FROM opaque_credential_epochs WHERE user_id = ? LIMIT 1")
      .bind(session.userId)
      .first<{ credential_fingerprint: string }>();
    if (epoch?.credential_fingerprint && epoch.credential_fingerprint !== challenge.credential_fingerprint) {
      return genericInvalid(challenge.challenge_id);
    }

    if (currentCredentialFingerprint !== challenge.credential_fingerprint) {
      return genericInvalid(challenge.challenge_id);
    }
  }

  const nextCredentialFingerprint = await hashRequestValue(authSecret, "opaque-credential", registrationRecord);
  if (nextCredentialFingerprint === currentCredentialFingerprint) {
    return errorResponse("opaque_credential_not_rotated", 409);
  }

  try {
    await finishOpaqueLogin({
      serverLoginState: challenge.server_login_state,
      finishLoginRequest,
    });
  } catch {
    return genericInvalid(challenge.challenge_id);
  }

  const consumed = await ops
    .prepare("UPDATE opaque_login_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(nowIso, challenge.challenge_id, nowIso)
    .run();
  if ((consumed.meta?.changes ?? 0) !== 1) {
    return genericInvalid(challenge.challenge_id);
  }

  const passwordWrapper = wrappers[0];
  const wrapperId = crypto.randomUUID();

  await shard.batch([
    shard
      .prepare("UPDATE opaque_credentials SET config_id = ?, registration_record = ?, server_public_key = ?, updated_at = ? WHERE user_id = ?")
      .bind(OPAQUE_CONFIG_ID, registrationRecord, serverPublicKey, nowIso, session.userId),
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
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.password_change', 'info', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: session.shardId, authMode: "opaque", passwordWrapperRotated: true, otherSessionsRevoked: true }),
        nowIso,
      ),
  ]);

  await ops.batch([
    ops
      .prepare("INSERT OR IGNORE INTO opaque_credential_revocations (user_id, credential_fingerprint, revoked_at, reason) VALUES (?, ?, ?, 'password_change')")
      .bind(session.userId, currentCredentialFingerprint, nowIso),
    ops
      .prepare(
        "INSERT INTO opaque_credential_epochs (user_id, credential_fingerprint, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET credential_fingerprint = excluded.credential_fingerprint, updated_at = excluded.updated_at",
      )
      .bind(session.userId, nextCredentialFingerprint, nowIso),
  ]);

  return jsonResponse({
    ok: true,
    authMode: "opaque",
    credentialEpochUpdated: true,
    credentialFingerprintChanged: true,
    credentialRevocationRecorded: true,
    session: {
      expiresAt: session.expiresAt,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

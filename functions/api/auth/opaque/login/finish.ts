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
  validateChallengeToken,
  validateDevice,
} from "../../../../_shared/auth";
import {
  findDirectoryUser,
  getActiveRootKeyWrappers,
  getOpaqueCredential,
  serializeRootKeyWrappers,
} from "../../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../../_shared/http";
import { getIdentityShard } from "../../../../_shared/auth";
import { finishOpaqueLogin, validateOpaqueMessage } from "../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../_shared/env";

const OPAQUE_LOGIN_MAX_ATTEMPTS = 5;

interface OpaqueLoginChallenge {
  challenge_id: string;
  user_id: string | null;
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

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const normalizedEmail = normalizeEmail(body.email);
  if (normalizedEmail instanceof Response) return normalizedEmail;

  const challengeToken = validateChallengeToken(body.challengeToken, "invalid_credentials");
  if (challengeToken instanceof Response) return challengeToken;

  const finishLoginRequest = validateOpaqueMessage(body.finishLoginRequest, "invalid_credentials", 64);
  if (finishLoginRequest instanceof Response) return finishLoginRequest;

  const rateLimited = await enforceAuthRateLimits(request, ops, authSecret, "login", normalizedEmail);
  if (rateLimited) return rateLimited;

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const challengeTokenHash = await hashRequestValue(authSecret, "opaque-login-token", challengeToken);
  const challenge = await ops
    .prepare(
      "SELECT challenge_id, user_id, server_login_state, credential_fingerprint, is_fake, attempts, expires_at, consumed_at FROM opaque_login_challenges WHERE email_hash = ? AND token_hash = ? LIMIT 1",
    )
    .bind(normalizedEmailHash, challengeTokenHash)
    .first<OpaqueLoginChallenge>();

  const genericInvalid = async (challengeId?: string, userId?: string | null) => {
    if (challengeId) {
      await ops
        .prepare("UPDATE opaque_login_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND consumed_at IS NULL")
        .bind(challengeId)
        .run();
    }

    if (userId) {
      const directoryUserForLog = await findDirectoryUser(directory, normalizedEmailHash);
      if (directoryUserForLog && directoryUserForLog.user_id === userId) {
        const shardForLog = getIdentityShard(env, directoryUserForLog.shard_id);
        if (!(shardForLog instanceof Response)) {
          await shardForLog
            .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.login_failed', 'warning', ?, ?, ?, ?)")
            .bind(
              crypto.randomUUID(),
              userId,
              await hashRequestValue(authSecret, "ip", getClientIp(request)),
              await hashRequestValue(authSecret, "user-agent", getUserAgent(request)),
              JSON.stringify({ authMode: "opaque" }),
              new Date().toISOString(),
            )
            .run();
        }
      }
    }

    return errorResponse("invalid_credentials", 401);
  };

  if (
    !challenge
    || challenge.consumed_at
    || Date.parse(challenge.expires_at) <= Date.now()
    || challenge.attempts >= OPAQUE_LOGIN_MAX_ATTEMPTS
    || challenge.is_fake === 1
    || !challenge.user_id
    || !challenge.credential_fingerprint
  ) {
    return genericInvalid(challenge?.challenge_id, challenge?.user_id);
  }

  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  if (!directoryUser || directoryUser.account_status !== "active" || directoryUser.user_id !== challenge.user_id) {
    return genericInvalid(challenge.challenge_id, challenge.user_id);
  }

  const shard = getIdentityShard(env, directoryUser.shard_id);
  if (shard instanceof Response) return shard;

  if (challenge.credential_fingerprint) {
    const revoked = await ops
      .prepare("SELECT 1 FROM opaque_credential_revocations WHERE user_id = ? AND credential_fingerprint = ? LIMIT 1")
      .bind(directoryUser.user_id, challenge.credential_fingerprint)
      .first();
    if (revoked) {
      return genericInvalid(challenge.challenge_id, challenge.user_id);
    }

    const epoch = await ops
      .prepare("SELECT credential_fingerprint FROM opaque_credential_epochs WHERE user_id = ? LIMIT 1")
      .bind(directoryUser.user_id)
      .first<{ credential_fingerprint: string }>();
    if (epoch?.credential_fingerprint && epoch.credential_fingerprint !== challenge.credential_fingerprint) {
      return genericInvalid(challenge.challenge_id, challenge.user_id);
    }

    const credential = await getOpaqueCredential(shard, directoryUser.user_id);
    const currentCredentialFingerprint = credential
      ? await hashRequestValue(authSecret, "opaque-credential", credential.registration_record)
      : null;
    if (currentCredentialFingerprint !== challenge.credential_fingerprint) {
      return genericInvalid(challenge.challenge_id, challenge.user_id);
    }
  }

  try {
    await finishOpaqueLogin({
      serverLoginState: challenge.server_login_state,
      finishLoginRequest,
    });
  } catch {
    return genericInvalid(challenge.challenge_id, challenge.user_id);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const consumed = await ops
    .prepare("UPDATE opaque_login_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(nowIso, challenge.challenge_id, nowIso)
    .run();

  if ((consumed.meta?.changes ?? 0) !== 1) {
    return genericInvalid(challenge.challenge_id, challenge.user_id);
  }

  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const expiresAtIso = expiresAt.toISOString();
  const token = createSessionToken(directoryUser.shard_id);
  const tokenHash = await sessionTokenHash(authSecret, token);
  const device = validateDevice(body.device);
  const deviceId = device.deviceId ?? crypto.randomUUID();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));
  const rootKeyWrappers = await getActiveRootKeyWrappers(shard, directoryUser.user_id);

  await shard.batch([
    shard
      .prepare("INSERT OR IGNORE INTO devices (device_id, user_id, device_label, device_public_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(deviceId, directoryUser.user_id, device.deviceLabel ?? null, device.devicePublicKey ?? null, nowIso, nowIso),
    shard
      .prepare("UPDATE devices SET last_seen_at = ?, device_label = COALESCE(?, device_label), device_public_key = COALESCE(?, device_public_key) WHERE device_id = ? AND user_id = ?")
      .bind(nowIso, device.deviceLabel ?? null, device.devicePublicKey ?? null, deviceId, directoryUser.user_id),
    shard
      .prepare("INSERT INTO sessions (session_id, user_id, device_id, session_token_hash, ip_hash, user_agent_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), directoryUser.user_id, deviceId, tokenHash, ipHash, userAgentHash, nowIso, nowIso, expiresAtIso),
    shard
      .prepare("UPDATE opaque_credentials SET last_login_at = ?, updated_at = ? WHERE user_id = ?")
      .bind(nowIso, nowIso, directoryUser.user_id),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.login', 'info', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), directoryUser.user_id, ipHash, userAgentHash, JSON.stringify({ shardId: directoryUser.shard_id, authMode: "opaque" }), nowIso),
  ]);

  return jsonResponse(
    {
      ok: true,
      authMode: "opaque",
      user: {
        userId: directoryUser.user_id,
        shardId: directoryUser.shard_id,
        accountStatus: directoryUser.account_status,
      },
      session: {
        expiresAt: expiresAtIso,
      },
      rootKeyWrappers: serializeRootKeyWrappers(rootKeyWrappers),
    },
    {
      headers: {
        "set-cookie": sessionCookie(token, expiresAt, request),
      },
    },
  );
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

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
  validateDevice,
  validateLoginChallengeToken,
  validateLoginProof,
  validateVerifier,
  verifyStoredVerifier,
  verifyChallengeStoredLoginProof,
  isChallengeStoredVerifier,
} from "../../_shared/auth";
import {
  findDirectoryUser,
  getActiveRootKeyWrappers,
  getStoredVerifier,
  serializeRootKeyWrappers,
} from "../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../_shared/http";
import { getIdentityShard } from "../../_shared/auth";
import type { CiphoraEnv } from "../../_shared/env";

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

  const rateLimited = await enforceAuthRateLimits(request, ops, authSecret, "login", normalizedEmail);
  if (rateLimited) return rateLimited;

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const genericInvalid = () => errorResponse("invalid_credentials", 401);
  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  if (!directoryUser || directoryUser.account_status !== "active") {
    return genericInvalid();
  }

  const shard = getIdentityShard(env, directoryUser.shard_id);
  if (shard instanceof Response) return shard;

  const storedVerifier = await getStoredVerifier(shard, directoryUser.user_id);
  let verified = false;
  if (storedVerifier && isChallengeStoredVerifier(storedVerifier)) {
    const challengeToken = validateLoginChallengeToken(body.challengeToken);
    if (!(challengeToken instanceof Response)) {
      const loginProof = validateLoginProof(body.loginProof);
      if (!(loginProof instanceof Response)) {
        verified = await verifyChallengeStoredLoginProof(
          authSecret,
          storedVerifier,
          normalizedEmailHash,
          challengeToken,
          loginProof,
        );
      }
    }
  } else if (storedVerifier) {
    const verifier = validateVerifier(body.verifier);
    if (!(verifier instanceof Response)) {
      verified = await verifyStoredVerifier(authSecret, verifier, storedVerifier);
    }
  }

  if (!storedVerifier || !verified) {
    const nowIso = new Date().toISOString();
    await shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.login_failed', 'warning', ?, ?, '{}', ?)")
      .bind(
        crypto.randomUUID(),
        directoryUser.user_id,
        await hashRequestValue(authSecret, "ip", getClientIp(request)),
        await hashRequestValue(authSecret, "user-agent", getUserAgent(request)),
        nowIso,
      )
      .run();
    return genericInvalid();
  }

  const now = new Date();
  const nowIso = now.toISOString();
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
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.login', 'info', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), directoryUser.user_id, ipHash, userAgentHash, JSON.stringify({ shardId: directoryUser.shard_id }), nowIso),
  ]);

  return jsonResponse(
    {
      ok: true,
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

import {
  SESSION_MAX_AGE_SECONDS,
  CHALLENGE_PASSWORD_VERIFIER_ALGORITHM,
  assertSameOrigin,
  createStoredLoginVerifier,
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
  validateKdf,
  validateRootKeyWrappers,
  validateVerifier,
} from "../../_shared/auth";
import { hashVerifier } from "../../_shared/crypto";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../_shared/http";
import { getIdentityShard } from "../../_shared/auth";
import type { CiphoraEnv } from "../../_shared/env";

const RECOVERY_VERIFIER_VERSION = "v1";
const RECOVERY_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-verifier";
const PASSWORD_VERIFIER_VERSION = "v2";
const PASSWORD_VERIFIER_ALGORITHM = CHALLENGE_PASSWORD_VERIFIER_ALGORITHM;

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

  const verifier = validateVerifier(body.verifier);
  if (verifier instanceof Response) return verifier;

  const kdf = validateKdf(body.kdf);
  if (kdf instanceof Response) return kdf;

  const wrappers = validateRootKeyWrappers(body.rootKeyWrappers);
  if (wrappers instanceof Response) return wrappers;

  const verifierVersion = typeof body.verifierVersion === "string" ? body.verifierVersion.trim() : PASSWORD_VERIFIER_VERSION;
  const verifierAlgorithm = typeof body.verifierAlgorithm === "string" ? body.verifierAlgorithm.trim() : PASSWORD_VERIFIER_ALGORITHM;
  if (verifierVersion !== PASSWORD_VERIFIER_VERSION || verifierAlgorithm !== PASSWORD_VERIFIER_ALGORITHM) {
    return errorResponse("invalid_verifier_metadata", 400);
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
  const sessionId = crypto.randomUUID();
  const token = createSessionToken(shardId);
  const tokenHash = await sessionTokenHash(authSecret, token);
  const storedVerifier = await createStoredLoginVerifier(authSecret, verifier);
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));
  const passwordWrapper = wrappers.find((wrapper) => wrapper.wrapperType === "password");
  const recoveryWrapper = wrappers.find((wrapper) => wrapper.wrapperType === "recovery");
  const recoveryWrapperId = recoveryWrapper ? crypto.randomUUID() : null;
  const hasRecoveryVerifierPayload = body.recoveryVerifier != null
    || body.recoveryVerifierVersion != null
    || body.recoveryVerifierAlgorithm != null;

  if (!passwordWrapper) {
    return errorResponse("missing_password_wrapper", 400);
  }

  if (!recoveryWrapper && hasRecoveryVerifierPayload) {
    return errorResponse("invalid_recovery_verifier", 400);
  }

  const recoveryVerifier = recoveryWrapper ? validateVerifier(body.recoveryVerifier) : null;
  if (recoveryVerifier instanceof Response) return recoveryVerifier;

  if (recoveryWrapper && !recoveryVerifier) {
    return errorResponse("invalid_recovery_verifier", 400);
  }

  const recoveryVerifierVersion = recoveryWrapper && typeof body.recoveryVerifierVersion === "string"
    ? body.recoveryVerifierVersion.trim()
    : RECOVERY_VERIFIER_VERSION;
  const recoveryVerifierAlgorithm = recoveryWrapper && typeof body.recoveryVerifierAlgorithm === "string"
    ? body.recoveryVerifierAlgorithm.trim()
    : RECOVERY_VERIFIER_ALGORITHM;
  if (
    recoveryWrapper
    && (
      recoveryVerifierVersion !== RECOVERY_VERIFIER_VERSION
      || recoveryVerifierAlgorithm !== RECOVERY_VERIFIER_ALGORITHM
    )
  ) {
    return errorResponse("invalid_recovery_verifier", 400);
  }

  const storedRecoveryVerifier = recoveryVerifier ? await hashVerifier(authSecret, recoveryVerifier) : null;

  const wrapperStatements = wrappers.map((wrapper) => {
    const wrapperId = wrapper === recoveryWrapper && recoveryWrapperId ? recoveryWrapperId : crypto.randomUUID();
    return shard
      .prepare(
        "INSERT INTO root_key_wrappers (wrapper_id, user_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        wrapperId,
        userId,
        wrapper.wrapperType,
        wrapper.kdfAlgorithm,
        JSON.stringify(wrapper.kdfParams),
        wrapper.algorithm,
        wrapper.iv,
        wrapper.ciphertext,
        nowIso,
        nowIso,
      );
  });

  try {
    await shard.batch([
      shard
        .prepare("INSERT INTO users (user_id, primary_email_hash, account_status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)")
        .bind(userId, normalizedEmailHash, nowIso, nowIso),
      shard
        .prepare("INSERT INTO auth_verifiers (user_id, verifier_version, verifier_algorithm, verifier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(
          userId,
          verifierVersion,
          verifierAlgorithm,
          storedVerifier,
          nowIso,
          nowIso,
        ),
      shard
        .prepare("INSERT INTO user_kdf_params (user_id, kdf_algorithm, iterations, memory_cost, parallelism, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(userId, kdf.algorithm, kdf.iterations, kdf.memoryCost, kdf.parallelism, kdf.salt, nowIso, nowIso),
      ...wrapperStatements,
      shard
        .prepare("INSERT INTO recovery_metadata (user_id, recovery_enabled, recovery_wrapper_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, recoveryWrapperId && storedRecoveryVerifier ? 1 : 0, recoveryWrapperId, nowIso, nowIso),
      ...(storedRecoveryVerifier ? [
        shard
          .prepare(
            "INSERT INTO recovery_verifiers (user_id, verifier_version, verifier_algorithm, verifier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            userId,
            recoveryVerifierVersion,
            recoveryVerifierAlgorithm,
            storedRecoveryVerifier,
            nowIso,
            nowIso,
          ),
      ] : []),
      shard
        .prepare("INSERT INTO devices (device_id, user_id, device_label, device_public_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(deviceId, userId, device.deviceLabel ?? null, device.devicePublicKey ?? null, nowIso, nowIso),
      shard
        .prepare("INSERT INTO sessions (session_id, user_id, device_id, session_token_hash, ip_hash, user_agent_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(sessionId, userId, deviceId, tokenHash, ipHash, userAgentHash, nowIso, nowIso, expiresAtIso),
      shard
        .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'account.signup', 'info', ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), userId, ipHash, userAgentHash, JSON.stringify({ shardId }), nowIso),
    ]);

    await directory
      .prepare("INSERT INTO directory_users (email_hash, user_id, shard_id, account_status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)")
      .bind(normalizedEmailHash, userId, shardId, nowIso, nowIso)
      .run();
  } catch {
    await shard.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM devices WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM root_key_wrappers WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM recovery_metadata WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM recovery_verifiers WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM user_kdf_params WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM auth_verifiers WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM account_events WHERE user_id = ?").bind(userId).run();
    await shard.prepare("DELETE FROM users WHERE user_id = ?").bind(userId).run();
    return errorResponse("account_unavailable", 409);
  }

  return jsonResponse(
    {
      ok: true,
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

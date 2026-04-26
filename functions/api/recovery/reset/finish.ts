import {
  SESSION_MAX_AGE_SECONDS,
  CHALLENGE_PASSWORD_VERIFIER_ALGORITHM,
  assertSameOrigin,
  createStoredLoginVerifier,
  createSessionToken,
  emailHash,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
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
  validateKdf,
  validateRootKeyWrappers,
  validateVerifier,
  verifyStoredVerifier,
} from "../../../_shared/auth";
import { findDirectoryUser, getOpaqueCredential, getStoredRecoveryVerifier, getStoredVerifier } from "../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_shared/http";
import {
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
  validateOpaquePasswordWrapper,
} from "../../../_shared/opaque";
import type { CiphoraEnv } from "../../../_shared/env";

const PASSWORD_VERIFIER_VERSION = "v2";
const PASSWORD_VERIFIER_ALGORITHM = CHALLENGE_PASSWORD_VERIFIER_ALGORITHM;
const PASSWORD_WRAPPER_KDF = "client-pbkdf2-sha256";
const PASSWORD_WRAPPER_ALGORITHM = "AES-GCM-256";
const RECOVERY_VERIFIER_VERSION = "v1";
const RECOVERY_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-verifier";
const RESET_CHALLENGE_MAX_ATTEMPTS = 6;

interface PasswordResetChallengeRow {
  challenge_id: string;
  user_id: string | null;
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

  const challengeToken = validateChallengeToken(body.challengeToken, "invalid_recovery_credentials");
  if (challengeToken instanceof Response) return challengeToken;

  const recoveryVerifier = validateVerifier(body.recoveryVerifier);
  if (recoveryVerifier instanceof Response) return recoveryVerifier;

  const wrapperPayload = body.rootKeyWrapper ? [body.rootKeyWrapper] : body.rootKeyWrappers;
  const wrappers = validateRootKeyWrappers(wrapperPayload);
  if (wrappers instanceof Response) return wrappers;

  if (wrappers.length !== 1 || wrappers[0].wrapperType !== "password") {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const passwordWrapper = wrappers[0];
  const opaqueRegistrationRecordInput = body.registrationRecord ?? body.opaqueRegistrationRecord;
  const isOpaqueReset = opaqueRegistrationRecordInput != null;
  let opaqueRegistrationRecord: string | null = null;
  let serverPublicKey: string | null = null;
  let kdfParamsJson: string;
  let newVerifier: string | null = null;
  let kdf: Exclude<ReturnType<typeof validateKdf>, Response> | null = null;

  if (isOpaqueReset) {
    const registrationRecord = validateOpaqueMessage(opaqueRegistrationRecordInput, "invalid_registration_record", 64);
    if (registrationRecord instanceof Response) return registrationRecord;
    opaqueRegistrationRecord = registrationRecord;

    const serverSetup = requireOpaqueServerSetup(env);
    if (serverSetup instanceof Response) return serverSetup;

    serverPublicKey = await getOpaqueServerPublicKey(serverSetup);
    const opaqueKdfParamsJson = validateOpaquePasswordWrapper(passwordWrapper, serverPublicKey);
    if (opaqueKdfParamsJson instanceof Response) return opaqueKdfParamsJson;
    kdfParamsJson = opaqueKdfParamsJson;
  } else {
    const nextVerifier = validateVerifier(body.newVerifier);
    if (nextVerifier instanceof Response) return nextVerifier;
    newVerifier = nextVerifier;

    const legacyKdf = validateKdf(body.kdf ?? body.newKdf);
    if (legacyKdf instanceof Response) return legacyKdf;
    kdf = legacyKdf;

    if (passwordWrapper.kdfAlgorithm !== PASSWORD_WRAPPER_KDF || passwordWrapper.algorithm !== PASSWORD_WRAPPER_ALGORITHM) {
      return errorResponse("invalid_password_wrapper", 400);
    }

    kdfParamsJson = JSON.stringify(passwordWrapper.kdfParams);
    if (kdfParamsJson.length > 4096) {
      return errorResponse("invalid_password_wrapper", 400);
    }
  }

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
    return errorResponse("invalid_recovery_credentials", 401);
  }

  const verifierVersion = typeof body.verifierVersion === "string" ? body.verifierVersion.trim() : PASSWORD_VERIFIER_VERSION;
  const verifierAlgorithm = typeof body.verifierAlgorithm === "string" ? body.verifierAlgorithm.trim() : PASSWORD_VERIFIER_ALGORITHM;
  if (!isOpaqueReset && (verifierVersion !== PASSWORD_VERIFIER_VERSION || verifierAlgorithm !== PASSWORD_VERIFIER_ALGORITHM)) {
    return errorResponse("invalid_verifier_metadata", 400);
  }

  const device = validateDevice(body.device);
  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const ipRateLimited = await enforceRateLimit(ops, authSecret, "recovery-reset-finish:ip", getClientIp(request), 24, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const emailRateLimited = await enforceRateLimit(ops, authSecret, "recovery-reset-finish:email", normalizedEmailHash, 8, 60 * 60);
  if (emailRateLimited) return emailRateLimited;

  const challengeTokenHash = await hashRequestValue(authSecret, "password-reset-token", challengeToken);
  const challenge = await ops
    .prepare(
      "SELECT challenge_id, user_id, attempts, expires_at, consumed_at FROM password_reset_challenges WHERE email_hash = ? AND token_hash = ? LIMIT 1",
    )
    .bind(normalizedEmailHash, challengeTokenHash)
    .first<PasswordResetChallengeRow>();

  const now = new Date();
  const nowIso = now.toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  const genericInvalid = async (input?: { challengeId?: string; userId?: string | null; logFailure?: boolean }) => {
    if (input?.challengeId) {
      await ops
        .prepare("UPDATE password_reset_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND consumed_at IS NULL")
        .bind(input.challengeId)
        .run();
    }

    if (input?.userId && input.logFailure) {
      const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
      if (directoryUser && directoryUser.user_id === input.userId && directoryUser.account_status === "active") {
        const shard = getIdentityShard(env, directoryUser.shard_id);
        if (!(shard instanceof Response)) {
          await shard
            .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.recovery_reset_failed', 'warning', ?, ?, ?, ?)")
            .bind(
              crypto.randomUUID(),
              directoryUser.user_id,
              ipHash,
              userAgentHash,
              JSON.stringify({ shardId: directoryUser.shard_id }),
              nowIso,
            )
            .run();
        }
      }
    }

    return errorResponse("invalid_recovery_credentials", 401);
  };

  if (
    !challenge
    || challenge.consumed_at
    || Date.parse(challenge.expires_at) <= now.getTime()
    || challenge.attempts >= RESET_CHALLENGE_MAX_ATTEMPTS
    || !challenge.user_id
  ) {
    return genericInvalid({ challengeId: challenge?.challenge_id, userId: challenge?.user_id, logFailure: !!challenge?.user_id });
  }

  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  if (!directoryUser || directoryUser.account_status !== "active" || directoryUser.user_id !== challenge.user_id) {
    return genericInvalid({ challengeId: challenge.challenge_id, userId: challenge.user_id, logFailure: false });
  }

  const shard = getIdentityShard(env, directoryUser.shard_id);
  if (shard instanceof Response) return shard;

  const storedRecoveryVerifier = await getStoredRecoveryVerifier(shard, directoryUser.user_id);
  if (!storedRecoveryVerifier || !(await verifyStoredVerifier(authSecret, recoveryVerifier, storedRecoveryVerifier.verifier))) {
    return genericInvalid({ challengeId: challenge.challenge_id, userId: directoryUser.user_id, logFailure: true });
  }

  const [storedPasswordVerifier, opaqueCredential] = await Promise.all([
    getStoredVerifier(shard, directoryUser.user_id),
    getOpaqueCredential(shard, directoryUser.user_id),
  ]);
  if (!isOpaqueReset && !storedPasswordVerifier && opaqueCredential) {
    return errorResponse("opaque_recovery_reset_pending", 409);
  }
  if (!isOpaqueReset && !storedPasswordVerifier) {
    return errorResponse("account_password_not_configured", 409);
  }

  const consumeResult = await ops
    .prepare(
      "UPDATE password_reset_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?",
    )
    .bind(nowIso, challenge.challenge_id, nowIso)
    .run();
  if ((consumeResult.meta.changes ?? 0) !== 1) {
    return genericInvalid({ challengeId: challenge.challenge_id, userId: directoryUser.user_id, logFailure: false });
  }

  if (isOpaqueReset && (!opaqueRegistrationRecord || !serverPublicKey)) {
    return errorResponse("invalid_registration_record", 400);
  }
  if (!isOpaqueReset && (!newVerifier || !kdf)) {
    return errorResponse("invalid_verifier_metadata", 400);
  }

  const nextStoredVerifier = isOpaqueReset ? null : await createStoredLoginVerifier(authSecret, newVerifier as string);
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const expiresAtIso = expiresAt.toISOString();
  const sessionId = crypto.randomUUID();
  const token = createSessionToken(directoryUser.shard_id);
  const tokenHash = await sessionTokenHash(authSecret, token);
  const deviceId = device.deviceId ?? crypto.randomUUID();
  const wrapperId = crypto.randomUUID();
  const authMutationStatements = isOpaqueReset
    ? [
        shard
          .prepare(
            "INSERT INTO opaque_credentials (user_id, config_id, user_identifier_hash, registration_record, server_public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET config_id = excluded.config_id, user_identifier_hash = excluded.user_identifier_hash, registration_record = excluded.registration_record, server_public_key = excluded.server_public_key, updated_at = excluded.updated_at",
          )
          .bind(
            directoryUser.user_id,
            OPAQUE_CONFIG_ID,
            normalizedEmailHash,
            opaqueRegistrationRecord as string,
            serverPublicKey as string,
            nowIso,
            nowIso,
          ),
        shard
          .prepare("DELETE FROM auth_verifiers WHERE user_id = ?")
          .bind(directoryUser.user_id),
        shard
          .prepare("DELETE FROM user_kdf_params WHERE user_id = ?")
          .bind(directoryUser.user_id),
      ]
    : [
        shard
          .prepare("UPDATE auth_verifiers SET verifier_version = ?, verifier_algorithm = ?, verifier = ?, updated_at = ? WHERE user_id = ?")
          .bind(verifierVersion, verifierAlgorithm, nextStoredVerifier, nowIso, directoryUser.user_id),
        shard
          .prepare("UPDATE user_kdf_params SET kdf_algorithm = ?, iterations = ?, memory_cost = ?, parallelism = ?, salt = ?, updated_at = ? WHERE user_id = ?")
          .bind(kdf!.algorithm, kdf!.iterations, kdf!.memoryCost, kdf!.parallelism, kdf!.salt, nowIso, directoryUser.user_id),
      ];

  await shard.batch([
    shard
      .prepare("INSERT OR IGNORE INTO devices (device_id, user_id, device_label, device_public_key, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(deviceId, directoryUser.user_id, device.deviceLabel ?? null, device.devicePublicKey ?? null, nowIso, nowIso),
    shard
      .prepare("UPDATE devices SET last_seen_at = ?, device_label = COALESCE(?, device_label), device_public_key = COALESCE(?, device_public_key) WHERE device_id = ? AND user_id = ?")
      .bind(nowIso, device.deviceLabel ?? null, device.devicePublicKey ?? null, deviceId, directoryUser.user_id),
    ...authMutationStatements,
    shard
      .prepare("UPDATE root_key_wrappers SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND wrapper_type = 'password' AND revoked_at IS NULL")
      .bind(nowIso, nowIso, directoryUser.user_id),
    shard
      .prepare(
        "INSERT INTO root_key_wrappers (wrapper_id, user_id, wrapper_type, kdf_algorithm, kdf_params_json, algorithm, iv, ciphertext, created_at, updated_at) VALUES (?, ?, 'password', ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        wrapperId,
        directoryUser.user_id,
        passwordWrapper.kdfAlgorithm,
        kdfParamsJson,
        passwordWrapper.algorithm,
        passwordWrapper.iv,
        passwordWrapper.ciphertext,
        nowIso,
        nowIso,
      ),
    shard
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(nowIso, directoryUser.user_id),
    shard
      .prepare("INSERT INTO sessions (session_id, user_id, device_id, session_token_hash, ip_hash, user_agent_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(sessionId, directoryUser.user_id, deviceId, tokenHash, ipHash, userAgentHash, nowIso, nowIso, expiresAtIso),
    shard
      .prepare("UPDATE users SET updated_at = ? WHERE user_id = ?")
      .bind(nowIso, directoryUser.user_id),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.recovery_reset', 'warning', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        directoryUser.user_id,
        ipHash,
        userAgentHash,
        JSON.stringify({ shardId: directoryUser.shard_id, authMode: isOpaqueReset ? "opaque" : "legacy_verifier", passwordWrapperRotated: true, sessionsRevoked: true }),
        nowIso,
      ),
  ]);

  return jsonResponse(
    {
      ok: true,
      authMode: isOpaqueReset ? "opaque" : undefined,
      user: {
        userId: directoryUser.user_id,
        shardId: directoryUser.shard_id,
        accountStatus: directoryUser.account_status,
      },
      session: {
        expiresAt: expiresAtIso,
      },
    },
    {
      headers: {
        "set-cookie": sessionCookie(token, expiresAt, request),
      },
    },
  );
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

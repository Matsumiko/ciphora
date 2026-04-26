import {
  assertSameOrigin,
  emailHash,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
  hashRequestValue,
  validateChallengeToken,
} from "../../../_shared/auth";
import {
  findDirectoryUser,
  getActiveRecoveryWrapper,
  getRecoveryMetadata,
  getStoredRecoveryVerifier,
  serializeRootKeyWrapper,
} from "../../../_shared/account";
import { randomBase64Url } from "../../../_shared/crypto";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_shared/http";
import {
  createOpaqueRegistrationResponse,
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  OPAQUE_KEY_STRETCHING,
  OPAQUE_ROOT_WRAPPER_KDF,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
} from "../../../_shared/opaque";
import type { CiphoraEnv } from "../../../_shared/env";

const RESET_CHALLENGE_TTL_SECONDS = 15 * 60;
const RESET_EMAIL_TOKEN_MAX_ATTEMPTS = 6;

interface PasswordResetEmailTokenRow {
  token_id: string;
  user_id: string | null;
  email_hash: string;
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

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const emailResetToken = validateChallengeToken(
    body.emailResetToken ?? body.resetEmailToken ?? body.recoveryResetToken,
    "invalid_recovery_credentials",
  );
  if (emailResetToken instanceof Response) return emailResetToken;

  const registrationRequest = body.registrationRequest == null
    ? null
    : validateOpaqueMessage(body.registrationRequest, "invalid_registration_request");
  if (registrationRequest instanceof Response) return registrationRequest;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "recovery-reset-start:ip", getClientIp(request), 24, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const emailRateLimited = await enforceRateLimit(ops, authSecret, "recovery-reset-start:email", normalizedEmailHash, 8, 60 * 60);
  if (emailRateLimited) return emailRateLimited;

  const emailResetTokenHash = await hashRequestValue(authSecret, "password-reset-email-token", emailResetToken);
  const emailToken = await ops
    .prepare(
      "SELECT token_id, user_id, email_hash, attempts, expires_at, consumed_at FROM password_reset_email_tokens WHERE email_hash = ? AND token_hash = ? LIMIT 1",
    )
    .bind(normalizedEmailHash, emailResetTokenHash)
    .first<PasswordResetEmailTokenRow>();

  const invalidEmailToken = async () => {
    if (emailToken?.token_id) {
      await ops
        .prepare("UPDATE password_reset_email_tokens SET attempts = attempts + 1 WHERE token_id = ? AND consumed_at IS NULL")
        .bind(emailToken.token_id)
        .run();
    }
    return errorResponse("invalid_recovery_credentials", 401);
  };

  if (
    !emailToken
    || emailToken.consumed_at
    || Date.parse(emailToken.expires_at) <= Date.now()
    || emailToken.attempts >= RESET_EMAIL_TOKEN_MAX_ATTEMPTS
    || !emailToken.user_id
  ) {
    return invalidEmailToken();
  }

  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  if (
    !directoryUser
    || directoryUser.account_status !== "active"
    || directoryUser.user_id !== emailToken.user_id
  ) {
    return invalidEmailToken();
  }

  const shard = getIdentityShard(env, directoryUser.shard_id);
  if (shard instanceof Response) return shard;

  const [metadata, recoveryWrapper, recoveryVerifier] = await Promise.all([
    getRecoveryMetadata(shard, directoryUser.user_id),
    getActiveRecoveryWrapper(shard, directoryUser.user_id),
    getStoredRecoveryVerifier(shard, directoryUser.user_id),
  ]);

  if (metadata?.recovery_enabled !== 1 || !recoveryWrapper || !recoveryVerifier) {
    return invalidEmailToken();
  }

  const responseWrapper = serializeRootKeyWrapper(recoveryWrapper);
  const challengeUserId = directoryUser.user_id;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + RESET_CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const challengeToken = `v1.${randomBase64Url(32)}`;
  const challengeTokenHash = await hashRequestValue(authSecret, "password-reset-token", challengeToken);
  let opaqueReset: Record<string, unknown> | null = null;

  if (registrationRequest) {
    const serverSetup = requireOpaqueServerSetup(env);
    if (!(serverSetup instanceof Response)) {
      try {
        opaqueReset = {
          configId: OPAQUE_CONFIG_ID,
          keyStretching: OPAQUE_KEY_STRETCHING,
          rootWrapperKdf: OPAQUE_ROOT_WRAPPER_KDF,
          registrationResponse: await createOpaqueRegistrationResponse({
            serverSetup,
            userIdentifier: normalizedEmailHash,
            registrationRequest,
          }),
          serverStaticPublicKey: await getOpaqueServerPublicKey(serverSetup),
        };
      } catch {
        opaqueReset = null;
      }
    }
  }

  const consumeEmailToken = await ops
    .prepare("UPDATE password_reset_email_tokens SET consumed_at = ? WHERE token_id = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(nowIso, emailToken.token_id, nowIso)
    .run();
  if ((consumeEmailToken.meta.changes ?? 0) !== 1) {
    return invalidEmailToken();
  }

  await ops
    .prepare(
      "INSERT INTO password_reset_challenges (challenge_id, user_id, email_hash, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), challengeUserId, normalizedEmailHash, challengeTokenHash, expiresAtIso)
    .run();

  return jsonResponse({
    ok: true,
    authMode: opaqueReset ? "opaque" : undefined,
    opaque: opaqueReset ?? undefined,
    recoveryReset: {
      challengeToken,
      expiresAt: expiresAtIso,
      rootKeyWrapper: responseWrapper,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

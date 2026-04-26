import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  hashRequestValue,
  readJsonObject,
  requireAuthSecret,
  requireOpsRuntime,
} from "../../../../_shared/auth";
import { getOpaqueCredential } from "../../../../_shared/account";
import { randomBase64Url } from "../../../../_shared/crypto";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../../_shared/http";
import {
  createOpaqueRegistrationResponse,
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  OPAQUE_KEY_STRETCHING,
  OPAQUE_ROOT_WRAPPER_KDF,
  requireOpaqueServerSetup,
  startOpaqueLogin,
  validateOpaqueMessage,
} from "../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../_shared/env";

const OPAQUE_PASSWORD_CHANGE_TTL_SECONDS = 5 * 60;

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

  const userRateLimited = await enforceRateLimit(ops, authSecret, "opaque-password-change-start:user", session.userId, 8, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "opaque-password-change-start:ip", getClientIp(request), 30, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const startLoginRequest = validateOpaqueMessage(body.startLoginRequest, "invalid_start_login_request", 64);
  if (startLoginRequest instanceof Response) return startLoginRequest;

  const registrationRequest = validateOpaqueMessage(body.registrationRequest, "invalid_registration_request");
  if (registrationRequest instanceof Response) return registrationRequest;

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

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + OPAQUE_PASSWORD_CHANGE_TTL_SECONDS * 1000).toISOString();
  const serverPublicKey = await getOpaqueServerPublicKey(serverSetup);

  let loginResponse: string;
  let serverLoginState: string;
  let registrationResponse: string;
  try {
    ({ loginResponse, serverLoginState } = await startOpaqueLogin({
      serverSetup,
      userIdentifier: credential.user_identifier_hash,
      registrationRecord: credential.registration_record,
      startLoginRequest,
    }));
    registrationResponse = await createOpaqueRegistrationResponse({
      serverSetup,
      userIdentifier: credential.user_identifier_hash,
      registrationRequest,
    });
  } catch {
    return errorResponse("invalid_credentials", 401);
  }

  await ops
    .prepare("DELETE FROM opaque_login_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL")
    .bind(nowIso)
    .run();

  const challengeToken = `opaque-pw.${randomBase64Url(32)}`;
  const challengeTokenHash = await hashRequestValue(authSecret, "opaque-login-token", challengeToken);
  const credentialFingerprint = await hashRequestValue(authSecret, "opaque-credential", credential.registration_record);
  const revoked = await ops
    .prepare("SELECT 1 FROM opaque_credential_revocations WHERE user_id = ? AND credential_fingerprint = ? LIMIT 1")
    .bind(session.userId, credentialFingerprint)
    .first();
  if (revoked) {
    return errorResponse("opaque_credential_not_current", 409);
  }

  const epoch = await ops
    .prepare("SELECT credential_fingerprint FROM opaque_credential_epochs WHERE user_id = ? LIMIT 1")
    .bind(session.userId)
    .first<{ credential_fingerprint: string }>();
  if (epoch?.credential_fingerprint && epoch.credential_fingerprint !== credentialFingerprint) {
    return errorResponse("opaque_credential_not_current", 409);
  }

  await ops
    .prepare(
      "INSERT INTO opaque_login_challenges (challenge_id, user_id, email_hash, token_hash, server_login_state, credential_fingerprint, is_fake, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      session.userId,
      userRow.primary_email_hash,
      challengeTokenHash,
      serverLoginState,
      credentialFingerprint,
      nowIso,
      expiresAtIso,
    )
    .run();

  return jsonResponse({
    ok: true,
    authMode: "opaque",
    opaque: {
      configId: OPAQUE_CONFIG_ID,
      keyStretching: OPAQUE_KEY_STRETCHING,
      rootWrapperKdf: OPAQUE_ROOT_WRAPPER_KDF,
      challengeToken,
      expiresAt: expiresAtIso,
      loginResponse,
      registrationResponse,
      serverStaticPublicKey: serverPublicKey,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

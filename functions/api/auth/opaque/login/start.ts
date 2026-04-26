import {
  assertSameOrigin,
  emailHash,
  enforceAuthRateLimits,
  hashRequestValue,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
} from "../../../../_shared/auth";
import { findDirectoryUser, getOpaqueCredential } from "../../../../_shared/account";
import { randomBase64Url } from "../../../../_shared/crypto";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../../_shared/http";
import { getIdentityShard } from "../../../../_shared/auth";
import {
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  OPAQUE_KEY_STRETCHING,
  OPAQUE_ROOT_WRAPPER_KDF,
  requireOpaqueServerSetup,
  startOpaqueLogin,
  validateOpaqueMessage,
} from "../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../_shared/env";

const OPAQUE_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const serverSetup = requireOpaqueServerSetup(env);
  if (serverSetup instanceof Response) return serverSetup;

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const normalizedEmail = normalizeEmail(body.email);
  if (normalizedEmail instanceof Response) return normalizedEmail;

  const startLoginRequest = validateOpaqueMessage(body.startLoginRequest, "invalid_start_login_request", 64);
  if (startLoginRequest instanceof Response) return startLoginRequest;

  const rateLimited = await enforceAuthRateLimits(request, ops, authSecret, "login", normalizedEmail);
  if (rateLimited) return rateLimited;

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  let registrationRecord: string | null = null;
  let credentialFingerprint: string | null = null;
  let challengeUserId: string | null = null;

  if (directoryUser && directoryUser.account_status === "active") {
    const shard = getIdentityShard(env, directoryUser.shard_id);
    if (!(shard instanceof Response)) {
      const credential = await getOpaqueCredential(shard, directoryUser.user_id);
      if (credential) {
        registrationRecord = credential.registration_record;
        credentialFingerprint = await hashRequestValue(authSecret, "opaque-credential", credential.registration_record);
        const revoked = await ops
          .prepare("SELECT 1 FROM opaque_credential_revocations WHERE user_id = ? AND credential_fingerprint = ? LIMIT 1")
          .bind(directoryUser.user_id, credentialFingerprint)
          .first();
        const epoch = await ops
          .prepare("SELECT credential_fingerprint FROM opaque_credential_epochs WHERE user_id = ? LIMIT 1")
          .bind(directoryUser.user_id)
          .first<{ credential_fingerprint: string }>();
        if (revoked || (epoch?.credential_fingerprint && epoch.credential_fingerprint !== credentialFingerprint)) {
          registrationRecord = null;
          credentialFingerprint = null;
        } else {
          challengeUserId = directoryUser.user_id;
        }
      }
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let loginResponse: string;
  let serverLoginState: string;
  try {
    ({ loginResponse, serverLoginState } = await startOpaqueLogin({
      serverSetup,
      userIdentifier: normalizedEmailHash,
      registrationRecord,
      startLoginRequest,
    }));
  } catch {
    return errorResponse("invalid_credentials", 401);
  }

  await ops
    .prepare("DELETE FROM opaque_login_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL")
    .bind(nowIso)
    .run();

  const expiresAtIso = new Date(nowMs + OPAQUE_LOGIN_CHALLENGE_TTL_SECONDS * 1000).toISOString();
  const challengeToken = `opaque.${randomBase64Url(32)}`;
  const challengeTokenHash = await hashRequestValue(authSecret, "opaque-login-token", challengeToken);

  await ops
    .prepare(
      "INSERT INTO opaque_login_challenges (challenge_id, user_id, email_hash, token_hash, server_login_state, credential_fingerprint, is_fake, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      challengeUserId,
      normalizedEmailHash,
      challengeTokenHash,
      serverLoginState,
      credentialFingerprint,
      challengeUserId ? 0 : 1,
      nowIso,
      expiresAtIso,
    )
    .run();

  return jsonResponse({
    ok: true,
    opaque: {
      configId: OPAQUE_CONFIG_ID,
      keyStretching: OPAQUE_KEY_STRETCHING,
      rootWrapperKdf: OPAQUE_ROOT_WRAPPER_KDF,
      challengeToken,
      expiresAt: expiresAtIso,
      loginResponse,
      serverStaticPublicKey: await getOpaqueServerPublicKey(serverSetup),
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  readJsonObject,
  requireAuthSecret,
  requireOpsRuntime,
} from "../../../../../_shared/auth";
import { getOpaqueCredential, getStoredVerifier } from "../../../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../../../_shared/http";
import {
  createOpaqueRegistrationResponse,
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  OPAQUE_KEY_STRETCHING,
  OPAQUE_ROOT_WRAPPER_KDF,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
} from "../../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../../_shared/env";

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

  const userRateLimited = await enforceRateLimit(ops, authSecret, "opaque-upgrade-start:user", session.userId, 8, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "opaque-upgrade-start:ip", getClientIp(request), 30, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const registrationRequest = validateOpaqueMessage(body.registrationRequest, "invalid_registration_request");
  if (registrationRequest instanceof Response) return registrationRequest;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const [userRow, storedVerifier, opaqueCredential] = await Promise.all([
    shard
      .prepare("SELECT primary_email_hash FROM users WHERE user_id = ? AND account_status = 'active' LIMIT 1")
      .bind(session.userId)
      .first<{ primary_email_hash: string }>(),
    getStoredVerifier(shard, session.userId),
    getOpaqueCredential(shard, session.userId),
  ]);

  if (!userRow) {
    return errorResponse("not_found", 404);
  }
  if (opaqueCredential) {
    return errorResponse("already_opaque", 409);
  }
  if (!storedVerifier) {
    return errorResponse("account_password_not_configured", 409);
  }

  let registrationResponse: string;
  let serverStaticPublicKey: string;
  try {
    [registrationResponse, serverStaticPublicKey] = await Promise.all([
      createOpaqueRegistrationResponse({
        serverSetup,
        userIdentifier: userRow.primary_email_hash,
        registrationRequest,
      }),
      getOpaqueServerPublicKey(serverSetup),
    ]);
  } catch {
    return errorResponse("invalid_registration_request", 400);
  }

  return jsonResponse({
    ok: true,
    authMode: "legacy_upgrade_to_opaque",
    opaque: {
      configId: OPAQUE_CONFIG_ID,
      keyStretching: OPAQUE_KEY_STRETCHING,
      rootWrapperKdf: OPAQUE_ROOT_WRAPPER_KDF,
      registrationResponse,
      serverStaticPublicKey,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

import {
  assertSameOrigin,
  emailHash,
  enforceAuthRateLimits,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
} from "../../../../_shared/auth";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../../_shared/http";
import {
  createOpaqueRegistrationResponse,
  getOpaqueServerPublicKey,
  OPAQUE_CONFIG_ID,
  OPAQUE_KEY_STRETCHING,
  OPAQUE_ROOT_WRAPPER_KDF,
  requireOpaqueServerSetup,
  validateOpaqueMessage,
} from "../../../../_shared/opaque";
import type { CiphoraEnv } from "../../../../_shared/env";

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

  const registrationRequest = validateOpaqueMessage(body.registrationRequest, "invalid_registration_request");
  if (registrationRequest instanceof Response) return registrationRequest;

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

  let registrationResponse: string;
  let serverStaticPublicKey: string;
  try {
    [registrationResponse, serverStaticPublicKey] = await Promise.all([
      createOpaqueRegistrationResponse({
        serverSetup,
        userIdentifier: normalizedEmailHash,
        registrationRequest,
      }),
      getOpaqueServerPublicKey(serverSetup),
    ]);
  } catch {
    return errorResponse("invalid_registration_request", 400);
  }

  return jsonResponse({
    ok: true,
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

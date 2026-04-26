import { ready as opaqueReady, server as opaqueServer } from "@serenity-kit/opaque";
import type { CiphoraEnv } from "./env";
import { isConfigured } from "./env";
import { errorResponse, serviceUnavailable } from "./http";
import type { RootKeyWrapperInput } from "./auth";

const OPAQUE_MESSAGE_PATTERN = /^[A-Za-z0-9_-]+$/;

export const OPAQUE_CONFIG_ID = "opaque-rfc9807-serenity-v1";
export const OPAQUE_KEY_STRETCHING = "memory-constrained";
export const OPAQUE_ROOT_WRAPPER_KDF = "opaque-rfc9807-export-key-hkdf-sha256";
export const OPAQUE_ROOT_WRAPPER_VERSION = "ciphora-account-opaque-root-wrap-v1";
export const OPAQUE_PASSWORD_WRAPPER_ALGORITHM = "AES-GCM-256";

export function requireOpaqueServerSetup(env: CiphoraEnv): string | Response {
  if (!isConfigured(env.CIPHORA_OPAQUE_SERVER_SETUP)) {
    return serviceUnavailable("opaque_not_configured");
  }
  return env.CIPHORA_OPAQUE_SERVER_SETUP as string;
}

export function validateOpaqueMessage(input: unknown, error = "invalid_opaque_message", min = 16, max = 4096): string | Response {
  if (typeof input !== "string") {
    return errorResponse(error, 400);
  }

  const value = input.trim();
  if (value.length < min || value.length > max || !OPAQUE_MESSAGE_PATTERN.test(value)) {
    return errorResponse(error, 400);
  }

  return value;
}

export function validateOpaquePasswordWrapper(
  wrapper: RootKeyWrapperInput,
  serverStaticPublicKey: string,
): string | Response {
  if (
    wrapper.wrapperType !== "password"
    || wrapper.kdfAlgorithm !== OPAQUE_ROOT_WRAPPER_KDF
    || wrapper.algorithm !== OPAQUE_PASSWORD_WRAPPER_ALGORITHM
  ) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const params = wrapper.kdfParams;
  if (
    params.version !== OPAQUE_ROOT_WRAPPER_VERSION
    || params.opaqueConfigId !== OPAQUE_CONFIG_ID
    || params.keyStretching !== OPAQUE_KEY_STRETCHING
    || params.serverStaticPublicKey !== serverStaticPublicKey
  ) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const hkdf = params.hkdf;
  if (!hkdf || typeof hkdf !== "object" || Array.isArray(hkdf)) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const hkdfParams = hkdf as Record<string, unknown>;
  if (
    hkdfParams.salt !== "ciphora-opaque-export-key-salt-v1"
    || hkdfParams.info !== "ciphora-account-root-wrap-key-v1"
    || hkdfParams.hash !== "SHA-256"
  ) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  const kdfParamsJson = JSON.stringify(params);
  if (kdfParamsJson.length > 4096) {
    return errorResponse("invalid_password_wrapper", 400);
  }

  return kdfParamsJson;
}

export async function getOpaqueServerPublicKey(serverSetup: string) {
  await opaqueReady;
  return opaqueServer.getPublicKey(serverSetup);
}

export async function createOpaqueRegistrationResponse(input: {
  serverSetup: string;
  userIdentifier: string;
  registrationRequest: string;
}) {
  await opaqueReady;
  return opaqueServer.createRegistrationResponse(input).registrationResponse;
}

export async function startOpaqueLogin(input: {
  serverSetup: string;
  userIdentifier: string;
  registrationRecord: string | null;
  startLoginRequest: string;
}) {
  await opaqueReady;
  return opaqueServer.startLogin(input);
}

export async function finishOpaqueLogin(input: {
  serverLoginState: string;
  finishLoginRequest: string;
}) {
  await opaqueReady;
  return opaqueServer.finishLogin(input);
}

import type { SyncProviderType } from "./account-client";
import { getSyncProviderDisplayLabel, isBridgeSyncProvider } from "./sync-providers";

interface SyncProviderCredentialInput {
  providerType: SyncProviderType;
  endpoint: string;
  accessToken: string;
}

interface SyncProviderCredentialValue {
  endpoint: string;
  accessToken: string;
}

export type SyncProviderCredentialValidationResult =
  | { ok: true; value: SyncProviderCredentialValue }
  | { ok: false; message: string };

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const ENV_ASSIGNMENT_PATTERN = /^[A-Z][A-Z0-9_]*\s*=/;

export function validateSyncProviderCredentials(
  input: SyncProviderCredentialInput,
): SyncProviderCredentialValidationResult {
  const endpoint = input.endpoint.trim();
  const accessToken = input.accessToken.trim();

  if (!endpoint) {
    return { ok: false, message: "Endpoint sync wajib diisi." };
  }

  if (!accessToken) {
    return { ok: false, message: "Token sync wajib diisi." };
  }

  if (input.providerType === "external_turso") {
    return validateTursoCredentials(endpoint, accessToken);
  }

  if (input.providerType === "external_d1_direct") {
    return validateD1DirectCredentials(endpoint, accessToken);
  }

  if (isBridgeSyncProvider(input.providerType)) {
    return validateBridgeCredentials(endpoint, accessToken, getSyncProviderDisplayLabel(input.providerType));
  }

  return { ok: false, message: "Provider sync tidak dikenali." };
}

function validateTursoCredentials(endpoint: string, accessToken: string): SyncProviderCredentialValidationResult {
  const endpointLower = endpoint.toLowerCase();
  const accessTokenLower = accessToken.toLowerCase();

  if (looksLikeEnvAssignment(endpoint)) {
    return {
      ok: false,
      message: "Turso DB URL harus berisi nilainya saja, bukan format TURSO_URL_DB=...",
    };
  }

  if (looksLikeEnvAssignment(accessToken)) {
    return {
      ok: false,
      message: "Turso Token harus berisi token mentahnya saja, bukan format TURSO_TOKEN=...",
    };
  }

  if (!isLikelyUrl(endpoint)) {
    return {
      ok: false,
      message: "Turso DB URL tidak valid. Gunakan URL database seperti libsql://nama-db.turso.io.",
    };
  }

  if (endpointLower.startsWith("eyj") || endpointLower.startsWith("bearer ") || endpointLower.includes(".eyj")) {
    return {
      ok: false,
      message: "Turso DB URL kelihatannya berisi token. Pindahkan token ke field Turso Token dan isi URL dengan libsql://...turso.io.",
    };
  }

  if (isLikelyUrl(accessToken)) {
    return {
      ok: false,
      message: "Turso Token kelihatannya berisi URL database. Isi Turso Token dengan auth token/JWT dari Turso, bukan libsql://...turso.io.",
    };
  }

  if (accessTokenLower.startsWith("bearer ")) {
    return {
      ok: false,
      message: "Turso Token harus token mentah tanpa prefix Bearer.",
    };
  }

  if (endpoint === accessToken) {
    return {
      ok: false,
      message: "Turso DB URL dan Turso Token tidak boleh sama. Token harus auth token/JWT Turso, bukan URL database.",
    };
  }

  return {
    ok: true,
    value: { endpoint, accessToken },
  };
}

function validateBridgeCredentials(endpoint: string, accessToken: string, providerLabel: string): SyncProviderCredentialValidationResult {
  const endpointLower = endpoint.toLowerCase();
  const accessTokenLower = accessToken.toLowerCase();

  if (looksLikeEnvAssignment(endpoint)) {
    return {
      ok: false,
      message: `${providerLabel} URL harus berisi nilainya saja, bukan format ENV_KEY=...`,
    };
  }

  if (!endpointLower.startsWith("http://") && !endpointLower.startsWith("https://")) {
    return {
      ok: false,
      message: `${providerLabel} URL harus memakai http atau https.`,
    };
  }

  if (looksLikeEnvAssignment(accessToken)) {
    return {
      ok: false,
      message: `${providerLabel} token harus berisi token mentahnya saja, bukan format ENV_KEY=...`,
    };
  }

  if (isLikelyUrl(accessToken)) {
    return {
      ok: false,
      message: `${providerLabel} token kelihatannya berisi URL. Isi token dengan Bearer token bridge, bukan URL bridge.`,
    };
  }

  if (accessTokenLower.startsWith("bearer ")) {
    return {
      ok: false,
      message: `${providerLabel} token harus token mentah tanpa prefix Bearer.`,
    };
  }

  return {
    ok: true,
    value: { endpoint, accessToken },
  };
}

function validateD1DirectCredentials(endpoint: string, accessToken: string): SyncProviderCredentialValidationResult {
  const accessTokenLower = accessToken.toLowerCase();

  if (looksLikeEnvAssignment(endpoint)) {
    return {
      ok: false,
      message: "D1 Direct endpoint harus berisi URL/descriptor nilainya saja, bukan format ENV_KEY=...",
    };
  }

  if (looksLikeEnvAssignment(accessToken)) {
    return {
      ok: false,
      message: "Cloudflare D1 token harus berisi token mentahnya saja, bukan format ENV_KEY=...",
    };
  }

  const normalizedEndpoint = normalizeD1DirectEndpoint(endpoint);
  if (!normalizedEndpoint.ok) {
    return normalizedEndpoint;
  }

  if (isLikelyUrl(accessToken)) {
    return {
      ok: false,
      message: "Cloudflare D1 token kelihatannya berisi URL. Isi token dengan API token Cloudflare yang scoped ke D1 Read/Write.",
    };
  }

  if (accessTokenLower.startsWith("bearer ")) {
    return {
      ok: false,
      message: "Cloudflare D1 token harus token mentah tanpa prefix Bearer.",
    };
  }

  if (endpoint === accessToken) {
    return {
      ok: false,
      message: "D1 Direct endpoint dan token tidak boleh sama.",
    };
  }

  return {
    ok: true,
    value: {
      endpoint: normalizedEndpoint.value.endpoint,
      accessToken,
    },
  };
}

function normalizeD1DirectEndpoint(endpoint: string): SyncProviderCredentialValidationResult {
  const value = endpoint.trim();
  const compactDescriptor = value.match(/^([A-Za-z0-9_-]{16,64})\/([A-Za-z0-9_-]{16,96})$/);
  if (compactDescriptor) {
    return {
      ok: true,
      value: {
        endpoint: `https://api.cloudflare.com/client/v4/accounts/${compactDescriptor[1]}/d1/database/${compactDescriptor[2]}/query`,
        accessToken: "",
      },
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      message: "D1 Direct endpoint tidak valid. Pakai account_id/database_id atau URL https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database/<database_id>/query.",
    };
  }

  if (url.protocol !== "https:" || url.hostname !== "api.cloudflare.com") {
    return {
      ok: false,
      message: "D1 Direct harus memakai endpoint resmi https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database/<database_id>/query.",
    };
  }

  const path = url.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/client\/v4\/accounts\/([^/]+)\/d1\/database\/([^/]+)(?:\/query)?$/);
  if (!match) {
    return {
      ok: false,
      message: "Path D1 Direct harus mengarah ke /client/v4/accounts/<account_id>/d1/database/<database_id>/query.",
    };
  }

  url.pathname = `/client/v4/accounts/${match[1]}/d1/database/${match[2]}/query`;
  url.search = "";
  url.hash = "";

  return {
    ok: true,
    value: {
      endpoint: url.toString(),
      accessToken: "",
    },
  };
}

function isLikelyUrl(value: string) {
  return URL_SCHEME_PATTERN.test(value.trim());
}

function looksLikeEnvAssignment(value: string) {
  return ENV_ASSIGNMENT_PATTERN.test(value.trim());
}

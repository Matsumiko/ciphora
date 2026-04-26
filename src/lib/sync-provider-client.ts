import type { SyncProviderType } from "./account-client";
import { fetchD1BridgeJson, sanitizeD1BridgeErrorMessage } from "./d1-bridge-client";
import { D1DirectHttpError, executeD1DirectQuery, sanitizeD1DirectErrorMessage } from "./d1-direct-client";
import { validateSyncProviderCredentials } from "./sync-provider-validation";
import { getSyncProviderDisplayLabel, isBridgeSyncProvider } from "./sync-providers";

const CONNECTION_TIMEOUT_MS = 10000;
const HEALTHY_STATUSES = new Set(["ok", "healthy", "ready", "foundation_ready"]);

export interface SyncProviderConnectionResult {
  ok: boolean;
  message: string;
  checkedAt: string;
}

export async function testSyncProviderConnection(input: {
  providerType: SyncProviderType;
  endpoint: string;
  accessToken: string;
}): Promise<SyncProviderConnectionResult> {
  const checkedAt = new Date().toISOString();
  const credentials = validateSyncProviderCredentials(input);

  if (!credentials.ok) {
    return {
      ok: false,
      message: credentials.message,
      checkedAt,
    };
  }

  if (input.providerType === "external_turso") {
    return testTursoConnection(credentials.value.endpoint, credentials.value.accessToken, checkedAt);
  }

  if (input.providerType === "external_d1_direct") {
    return testD1DirectConnection(credentials.value.endpoint, credentials.value.accessToken, checkedAt);
  }

  if (isBridgeSyncProvider(input.providerType)) {
    return testBridgeConnection(
      credentials.value.endpoint,
      credentials.value.accessToken,
      checkedAt,
      getSyncProviderDisplayLabel(input.providerType),
    );
  }

  return {
    ok: false,
    message: "Provider sync tidak dikenali.",
    checkedAt,
  };
}

async function testTursoConnection(endpoint: string, accessToken: string, checkedAt: string) {
  try {
    const { createClient } = await import("@libsql/client/web");
    const client = createClient({
      url: endpoint,
      authToken: accessToken,
      fetch: createTimedFetch(),
    });

    try {
      const result = await client.execute("SELECT 1 AS ciphora_test");
      const rowCount = Array.isArray(result.rows) ? result.rows.length : 0;
      return {
        ok: true,
        message: `Koneksi Turso valid. Query uji selesai${rowCount > 0 ? " dan database merespons." : "."}`,
        checkedAt,
      };
    } finally {
      client.close();
    }
  } catch (error) {
    return {
      ok: false,
      message: mapTursoConnectionError(error, endpoint, accessToken),
      checkedAt,
    };
  }
}

async function testBridgeConnection(endpoint: string, accessToken: string, checkedAt: string, providerLabel: string) {
  try {
    const { response, body } = await fetchD1BridgeJson({
      endpoint,
      accessToken,
      routePath: "/health",
    });

    if (response.ok && isHealthyBridgePayload(body)) {
      return {
        ok: true,
        message: `Health endpoint ${providerLabel} merespons dengan autentikasi yang valid.`,
        checkedAt,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: `Token ${providerLabel} ditolak. Periksa Bearer token yang dipakai.`,
        checkedAt,
      };
    }

    if (response.status === 404) {
      return {
        ok: false,
        message: `Health endpoint ${providerLabel} tidak ditemukan. Cek URL bridge atau gunakan URL health endpoint langsung.`,
        checkedAt,
      };
    }

    if (response.ok && !body) {
      return {
        ok: false,
        message: `${providerLabel} merespons, tetapi endpoint health harus mengembalikan JSON.`,
        checkedAt,
      };
    }

    return {
      ok: false,
      message: body && typeof body.error === "string"
        ? `${providerLabel} menolak koneksi: ${body.error}.`
        : `${providerLabel} merespons dengan status ${response.status}.`,
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: mapBridgeConnectionError(error, endpoint, accessToken, providerLabel),
      checkedAt,
    };
  }
}

async function testD1DirectConnection(endpoint: string, accessToken: string, checkedAt: string) {
  try {
    const rows = await executeD1DirectQuery({
      endpoint,
      accessToken,
      sql: "SELECT 1 AS ciphora_test",
    });

    return {
      ok: true,
      message: `Koneksi D1 Direct valid. Cloudflare D1 REST API merespons${rows.length > 0 ? " query uji." : "."}`,
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: mapD1DirectConnectionError(error, endpoint, accessToken),
      checkedAt,
    };
  }
}

function createTimedFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  };
}

function isHealthyBridgePayload(body: Record<string, unknown> | null) {
  if (!body) return false;
  if (body.ok === true) return true;
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  return HEALTHY_STATUSES.has(status);
}

function mapTursoConnectionError(error: unknown, endpoint: string, accessToken: string) {
  const message = sanitizeErrorMessage(error, endpoint, accessToken);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("unauthorized") || lowerMessage.includes("auth") || lowerMessage.includes("401") || lowerMessage.includes("403")) {
    return "Token Turso ditolak. Periksa auth token dan hak akses databasenya.";
  }
  if (lowerMessage.includes("url") || lowerMessage.includes("scheme") || lowerMessage.includes("invalid")) {
    return "URL Turso tidak valid. Gunakan URL database Turso yang benar.";
  }
  if (lowerMessage.includes("400") || lowerMessage.includes("bad request")) {
    return "Turso menolak request. Cek lagi Turso DB URL dan pastikan Turso Token berisi auth token/JWT, bukan URL database.";
  }
  if (lowerMessage.includes("abort") || lowerMessage.includes("timeout")) {
    return "Koneksi Turso habis waktu. Cek jaringan atau coba lagi sebentar lagi.";
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network")) {
    return "Browser tidak bisa menjangkau Turso. Cek jaringan, CORS, atau URL database.";
  }

  return `Koneksi Turso gagal: ${message}`;
}

function mapBridgeConnectionError(error: unknown, endpoint: string, accessToken: string, providerLabel: string) {
  const message = sanitizeD1BridgeErrorMessage(error, endpoint, accessToken);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("abort") || lowerMessage.includes("timeout")) {
    return `Health endpoint ${providerLabel} habis waktu. Cek worker bridge atau jaringan.`;
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network") || lowerMessage.includes("cors")) {
    return `Browser tidak bisa menjangkau ${providerLabel}. Cek URL bridge, jaringan, atau izin CORS.`;
  }
  if (lowerMessage.includes("http or https")) {
    return `URL ${providerLabel} harus memakai http atau https.`;
  }

  return `Koneksi ${providerLabel} gagal: ${message}`;
}

function mapD1DirectConnectionError(error: unknown, endpoint: string, accessToken: string) {
  const message = sanitizeD1DirectErrorMessage(error, endpoint, accessToken);
  const lowerMessage = message.toLowerCase();

  if (error instanceof D1DirectHttpError && (error.status === 401 || error.status === 403)) {
    return "Cloudflare D1 token ditolak. Pastikan token punya izin D1 Read/Write untuk account/database ini.";
  }
  if (error instanceof D1DirectHttpError && error.status === 404) {
    return "D1 Direct endpoint tidak menemukan account/database. Cek account ID dan database ID.";
  }
  if (lowerMessage.includes("abort") || lowerMessage.includes("timeout")) {
    return "Koneksi D1 Direct habis waktu. Cek jaringan atau Cloudflare API.";
  }
  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("network") || lowerMessage.includes("cors")) {
    return "Browser tidak bisa menjangkau Cloudflare D1 REST API. Jika CORS diblokir, gunakan D1 Bridge.";
  }
  if (lowerMessage.includes("official cloudflare api") || lowerMessage.includes("endpoint path")) {
    return "Endpoint D1 Direct harus memakai URL resmi Cloudflare D1 REST API.";
  }

  return `Koneksi D1 Direct gagal: ${message}`;
}

function sanitizeErrorMessage(error: unknown, endpoint: string, accessToken: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, " ").trim() || "unknown_error";
  return compact
    .replaceAll(accessToken, "[REDACTED_TOKEN]")
    .replaceAll(endpoint, "[REDACTED_ENDPOINT]")
    .slice(0, 160);
}

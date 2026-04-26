const CONNECTION_TIMEOUT_MS = 10000;

export type D1DirectSqlArg = string | number | null;

export interface D1DirectStatement {
  sql: string;
  args?: D1DirectSqlArg[];
}

interface CloudflareD1QueryResult {
  success?: boolean;
  results?: Record<string, unknown>[];
  meta?: Record<string, unknown>;
  error?: string;
}

interface CloudflareD1ApiResponse {
  success?: boolean;
  errors?: Array<{ message?: string; code?: number | string }>;
  messages?: Array<{ message?: string }>;
  result?: CloudflareD1QueryResult[] | CloudflareD1QueryResult;
}

export class D1DirectHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "D1DirectHttpError";
    this.status = status;
  }
}

export function normalizeD1DirectQueryUrl(endpoint: string) {
  const value = endpoint.trim();
  const compactDescriptor = value.match(/^([A-Za-z0-9_-]{16,64})\/([A-Za-z0-9_-]{16,96})$/);
  if (compactDescriptor) {
    return `https://api.cloudflare.com/client/v4/accounts/${compactDescriptor[1]}/d1/database/${compactDescriptor[2]}/query`;
  }

  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.cloudflare.com") {
    throw new Error("D1 Direct endpoint must use the official Cloudflare API host.");
  }

  const path = url.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/client\/v4\/accounts\/([^/]+)\/d1\/database\/([^/]+)(?:\/query)?$/);
  if (!match) {
    throw new Error("D1 Direct endpoint path is invalid.");
  }

  url.pathname = `/client/v4/accounts/${match[1]}/d1/database/${match[2]}/query`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function executeD1DirectQuery(input: {
  endpoint: string;
  accessToken: string;
  sql: string;
  args?: D1DirectSqlArg[];
}): Promise<Record<string, unknown>[]> {
  const url = normalizeD1DirectQueryUrl(input.endpoint);
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.accessToken.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sql: input.sql,
        params: input.args ?? [],
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const body = parseD1Response(rawText);
    if (!response.ok) {
      throw new D1DirectHttpError(response.status, getD1ResponseMessage(body) || `http_${response.status}`);
    }

    if (body?.success === false) {
      throw new D1DirectHttpError(response.status, getD1ResponseMessage(body) || "d1_query_failed");
    }

    const result = Array.isArray(body?.result) ? body.result[0] : body?.result;
    if (result?.success === false) {
      throw new D1DirectHttpError(response.status, result.error || "d1_statement_failed");
    }

    return Array.isArray(result?.results) ? result.results : [];
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function executeD1DirectStatements(input: {
  endpoint: string;
  accessToken: string;
  statements: D1DirectStatement[];
}) {
  for (const statement of input.statements) {
    if (!statement.sql.trim()) continue;
    await executeD1DirectQuery({
      endpoint: input.endpoint,
      accessToken: input.accessToken,
      sql: statement.sql,
      args: statement.args,
    });
  }
}

export function sanitizeD1DirectErrorMessage(error: unknown, endpoint: string, accessToken: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, " ").trim() || "unknown_error";
  return compact
    .replaceAll(accessToken, "[REDACTED_TOKEN]")
    .replaceAll(endpoint, "[REDACTED_ENDPOINT]")
    .replaceAll(normalizeForRedaction(endpoint), "[REDACTED_ENDPOINT]")
    .slice(0, 180);
}

function parseD1Response(rawText: string): CloudflareD1ApiResponse | null {
  try {
    return rawText ? JSON.parse(rawText) as CloudflareD1ApiResponse : null;
  } catch {
    return null;
  }
}

function getD1ResponseMessage(body: CloudflareD1ApiResponse | null) {
  const errorMessage = body?.errors?.find((entry) => typeof entry.message === "string" && entry.message.trim())?.message;
  if (errorMessage) return errorMessage;

  const message = body?.messages?.find((entry) => typeof entry.message === "string" && entry.message.trim())?.message;
  return message ?? "";
}

function normalizeForRedaction(endpoint: string) {
  try {
    return normalizeD1DirectQueryUrl(endpoint);
  } catch {
    return endpoint;
  }
}

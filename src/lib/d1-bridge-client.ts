const CONNECTION_TIMEOUT_MS = 10000;
const KNOWN_BRIDGE_SUFFIXES = ["/health", "/records", "/schema/apply", "/sync/push"] as const;

export interface D1BridgeJsonResponse {
  response: Response;
  body: Record<string, unknown> | null;
  rawText: string;
  url: string;
}

function normalizeBridgeBaseUrl(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("D1 Bridge URL harus memakai http atau https.");
  }

  let normalizedPath = url.pathname.replace(/\/+$/, "");
  for (const suffix of KNOWN_BRIDGE_SUFFIXES) {
    if (normalizedPath.toLowerCase().endsWith(suffix)) {
      normalizedPath = normalizedPath.slice(0, normalizedPath.length - suffix.length);
      break;
    }
  }

  url.pathname = normalizedPath || "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function buildD1BridgeUrl(endpoint: string, routePath: string) {
  const base = normalizeBridgeBaseUrl(endpoint.trim());
  const suffix = routePath.startsWith("/") ? routePath : `/${routePath}`;
  base.pathname = `${base.pathname === "/" ? "" : base.pathname}${suffix}`;
  return base.toString();
}

export async function fetchD1BridgeJson(input: {
  endpoint: string;
  accessToken: string;
  routePath: string;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<D1BridgeJsonResponse> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

  try {
    const url = buildD1BridgeUrl(input.endpoint, input.routePath);
    const response = await fetch(url, {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.accessToken.trim()}`,
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = rawText ? JSON.parse(rawText) as Record<string, unknown> : null;
    } catch {
      body = null;
    }

    return {
      response,
      body,
      rawText,
      url,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function sanitizeD1BridgeErrorMessage(error: unknown, endpoint: string, accessToken: string) {
  const raw = error instanceof Error ? error.message : String(error);
  const compact = raw.replace(/\s+/g, " ").trim() || "unknown_error";
  return compact
    .replaceAll(accessToken, "[REDACTED_TOKEN]")
    .replaceAll(endpoint, "[REDACTED_ENDPOINT]")
    .slice(0, 180);
}

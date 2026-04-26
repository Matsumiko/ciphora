const baseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const nativeAppOrigins = new Set([
  "capacitor://localhost",
  "https://localhost",
  "ionic://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);

export function isAllowedNativeAppOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return nativeAppOrigins.has(origin);
}

export function corsHeadersForRequest(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!isAllowedNativeAppOrigin(origin)) return {};

  return {
    "access-control-allow-origin": origin as string,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export function corsPreflightResponse(request: Request): Response | null {
  const headers = corsHeadersForRequest(request);
  if (!Object.keys(headers).length) return null;

  return new Response(null, {
    status: 204,
    headers,
  });
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      ...baseHeaders,
      ...(init.headers ?? {}),
    },
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return jsonResponse(
    {
      ok: false,
      error: "method_not_allowed",
      allowed,
    },
    {
      status: 405,
      headers: {
        allow: allowed.join(", "),
      },
    },
  );
}

export function errorResponse(error: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return jsonResponse(
    {
      ok: false,
      error,
      ...extra,
    },
    { status },
  );
}

export function serviceUnavailable(error = "service_unavailable"): Response {
  return errorResponse(error, 503);
}

export function unauthorized(): Response {
  return jsonResponse(
    {
      ok: false,
      error: "not_found",
    },
    {
      status: 404,
    },
  );
}

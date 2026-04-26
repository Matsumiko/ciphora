import { corsHeadersForRequest, corsPreflightResponse } from "./_shared/http";

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method === "OPTIONS") {
    const preflight = corsPreflightResponse(context.request);
    if (preflight) return preflight;
  }

  const response = await context.next();
  const headers = new Headers(response.headers);

  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "DENY");
  for (const [key, value] of Object.entries(corsHeadersForRequest(context.request))) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

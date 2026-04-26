export interface CiphoraEnv {
  CIPHORA_ENV?: string;
  CIPHORA_AUTH_SECRET?: string;
  CIPHORA_INTERNAL_HEALTH_TOKEN?: string;
  CIPHORA_OPAQUE_SERVER_SETUP?: string;
  CIPHORA_RESEND_APIKEY?: string;
  CIPHORA_BREVO_APIKEY?: string;
  CIPHORA_EMAIL_FROM?: string;
  CIPHORA_APP_URL?: string;
  CIPHORA_EMAIL_PROVIDER_WEIGHTS?: string;
  CIPHORA_EMAIL_PROVIDER_DAILY_LIMITS?: string;
  TURSO_TOKEN?: string;
  TURSO_URL_DB?: string;
  CIPHORA_DIRECTORY?: D1Database;
  CIPHORA_IDENTITY_00?: D1Database;
  CIPHORA_IDENTITY_01?: D1Database;
  CIPHORA_IDENTITY_02?: D1Database;
  CIPHORA_IDENTITY_03?: D1Database;
  CIPHORA_IDENTITY_04?: D1Database;
  CIPHORA_IDENTITY_05?: D1Database;
  CIPHORA_IDENTITY_06?: D1Database;
  CIPHORA_IDENTITY_07?: D1Database;
  CIPHORA_OPS_RUNTIME?: D1Database;
}

export const IDENTITY_BINDINGS = [
  "CIPHORA_IDENTITY_00",
  "CIPHORA_IDENTITY_01",
  "CIPHORA_IDENTITY_02",
  "CIPHORA_IDENTITY_03",
  "CIPHORA_IDENTITY_04",
  "CIPHORA_IDENTITY_05",
  "CIPHORA_IDENTITY_06",
  "CIPHORA_IDENTITY_07",
] as const;

export type IdentityBinding = (typeof IDENTITY_BINDINGS)[number];

export function isConfigured(value: unknown): boolean {
  return typeof value === "string" ? value.length > 0 : Boolean(value);
}

export function hasInternalToken(env: CiphoraEnv): boolean {
  return isConfigured(env.CIPHORA_INTERNAL_HEALTH_TOKEN);
}

export function isInternalRequest(request: Request, env: CiphoraEnv): boolean {
  const expected = env.CIPHORA_INTERNAL_HEALTH_TOKEN;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export function getIdentityShardBindings(env: CiphoraEnv): Array<{ binding: IdentityBinding; database?: D1Database }> {
  return IDENTITY_BINDINGS.map((binding) => ({
    binding,
    database: env[binding],
  }));
}

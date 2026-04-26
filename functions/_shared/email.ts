import type { CiphoraEnv } from "./env";

const RESEND_SEND_ENDPOINT = "https://api.resend.com/emails";
const BREVO_SEND_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_EMAIL_FROM = "Ciphora <noreply@ciphora.indevs.in>";
const DEFAULT_PROVIDER_WEIGHTS = "brevo:3,resend:1";
const DEFAULT_PROVIDER_DAILY_LIMITS = "brevo:300,resend:100";
const APP_NAME = "Ciphora";
type EmailProvider = "brevo" | "resend";

interface TransactionalEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey?: string;
}

export interface EmailDeliveryResult {
  ok: boolean;
  status: number;
  error?: string;
  provider?: EmailProvider;
  retryAfterSeconds?: number;
}

interface EmailQuotaReservation {
  ok: boolean;
  provider: EmailProvider;
  quotaDay: string;
  retryAfterSeconds?: number;
  status?: number;
  error?: string;
}

export interface EmailQuotaStatus {
  configured: boolean;
  exhausted: boolean;
  retryAfterSeconds?: number;
}

export function getAppBaseUrl(request: Request, env: CiphoraEnv): string {
  const configured = env.CIPHORA_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      return url.origin;
    } catch {
      // Fall through to the request origin if the configured value is malformed.
    }
  }

  return new URL(request.url).origin;
}

export function buildAppLink(request: Request, env: CiphoraEnv, pathname: string, params: Record<string, string>): string {
  const url = new URL(pathname, getAppBaseUrl(request, env));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function sendTransactionalEmail(env: CiphoraEnv, input: TransactionalEmailInput): Promise<EmailDeliveryResult> {
  const providerOrder = getProviderOrder(env, input);
  if (providerOrder.length === 0) {
    return {
      ok: false,
      status: 503,
      error: "email_not_configured",
    };
  }

  const from = env.CIPHORA_EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
  const exhaustedProviders = new Set<EmailProvider>();
  let lastFailure: EmailDeliveryResult = {
    ok: false,
    status: 502,
    error: "email_delivery_failed",
  };

  for (const provider of providerOrder) {
    const reservation = await reserveProviderQuota(env, provider);
    if (!reservation.ok) {
      if (reservation.error === "email_quota_exhausted") {
        exhaustedProviders.add(provider);
        lastFailure = {
          ok: false,
          status: reservation.status ?? 429,
          error: reservation.error,
          provider,
          retryAfterSeconds: reservation.retryAfterSeconds,
        };
        continue;
      }

      return {
        ok: false,
        status: reservation.status ?? 503,
        error: reservation.error ?? "email_quota_unavailable",
        provider,
      };
    }

    const result = provider === "brevo"
      ? await sendBrevoEmail(env, from, input)
      : await sendResendEmail(env, from, input);
    if (result.ok) {
      return result;
    }

    await releaseProviderQuota(env, reservation);
    lastFailure = result;
  }

  if (exhaustedProviders.size === providerOrder.length) {
    return {
      ok: false,
      status: 429,
      error: "email_quota_exhausted",
      retryAfterSeconds: secondsUntilNextUtcDay(),
    };
  }

  return {
    ok: false,
    status: lastFailure.status,
    error: lastFailure.error ?? "email_delivery_failed",
    retryAfterSeconds: lastFailure.retryAfterSeconds,
  };
}

export async function getTransactionalEmailQuotaStatus(env: CiphoraEnv): Promise<EmailQuotaStatus> {
  const providers = getConfiguredProviders(env);
  if (providers.length === 0) {
    return {
      configured: false,
      exhausted: false,
    };
  }

  if (!env.CIPHORA_OPS_RUNTIME) {
    return {
      configured: true,
      exhausted: true,
      retryAfterSeconds: secondsUntilNextUtcDay(),
    };
  }

  const quotaDay = currentUtcDay();
  for (const provider of providers) {
    const dailyLimit = getProviderDailyLimit(env, provider);
    if (dailyLimit <= 0) continue;

    const row = await env.CIPHORA_OPS_RUNTIME
      .prepare("SELECT sent_count FROM email_provider_daily_quotas WHERE provider = ? AND quota_day = ? LIMIT 1")
      .bind(provider, quotaDay)
      .first<{ sent_count: number }>();

    if (!row || Number(row.sent_count) < dailyLimit) {
      return {
        configured: true,
        exhausted: false,
      };
    }
  }

  return {
    configured: true,
    exhausted: true,
    retryAfterSeconds: secondsUntilNextUtcDay(),
  };
}

async function sendResendEmail(env: CiphoraEnv, from: string, input: TransactionalEmailInput): Promise<EmailDeliveryResult> {
  const apiKey = env.CIPHORA_RESEND_APIKEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: "email_not_configured",
      provider: "resend",
    };
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "user-agent": "ciphora-pages-functions/1.0",
  };

  if (input.idempotencyKey) {
    headers["idempotency-key"] = input.idempotencyKey;
  }

  try {
    const response = await fetch(RESEND_SEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status >= 500 ? 502 : response.status,
        error: "email_delivery_failed",
        provider: "resend",
      };
    }

    return {
      ok: true,
      status: 202,
      provider: "resend",
    };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "email_delivery_failed",
      provider: "resend",
    };
  }
}

async function sendBrevoEmail(env: CiphoraEnv, from: string, input: TransactionalEmailInput): Promise<EmailDeliveryResult> {
  const apiKey = env.CIPHORA_BREVO_APIKEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      error: "email_not_configured",
      provider: "brevo",
    };
  }

  const sender = parseEmailFrom(from);
  const messageHeaders: Record<string, string> = {};
  if (input.idempotencyKey) {
    messageHeaders["X-Ciphora-Message-Id"] = input.idempotencyKey;
  }

  try {
    const response = await fetch(BREVO_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
        ...(Object.keys(messageHeaders).length > 0 ? { headers: messageHeaders } : {}),
        tags: ["ciphora", "transactional"],
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status >= 500 ? 502 : response.status,
        error: "email_delivery_failed",
        provider: "brevo",
      };
    }

    return {
      ok: true,
      status: 202,
      provider: "brevo",
    };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "email_delivery_failed",
      provider: "brevo",
    };
  }
}

function getProviderOrder(env: CiphoraEnv, input: TransactionalEmailInput): EmailProvider[] {
  const configured = new Set<EmailProvider>(getConfiguredProviders(env));
  if (configured.size === 0) return [];

  const weightedProviders = parseWeightedProviders(env.CIPHORA_EMAIL_PROVIDER_WEIGHTS ?? DEFAULT_PROVIDER_WEIGHTS)
    .filter((provider) => configured.has(provider));
  const fallbackOrder = (["brevo", "resend"] as EmailProvider[]).filter((provider) => configured.has(provider));
  if (weightedProviders.length === 0) return fallbackOrder;

  const seed = input.idempotencyKey || `${input.to}:${input.subject}`;
  const preferred = weightedProviders[hashString(seed) % weightedProviders.length];
  return [
    preferred,
    ...fallbackOrder.filter((provider) => provider !== preferred),
  ];
}

function getConfiguredProviders(env: CiphoraEnv): EmailProvider[] {
  const providers: EmailProvider[] = [];
  if (env.CIPHORA_BREVO_APIKEY?.trim()) providers.push("brevo");
  if (env.CIPHORA_RESEND_APIKEY?.trim()) providers.push("resend");
  return providers;
}

async function reserveProviderQuota(env: CiphoraEnv, provider: EmailProvider): Promise<EmailQuotaReservation> {
  const db = env.CIPHORA_OPS_RUNTIME;
  const quotaDay = currentUtcDay();
  if (!db) {
    return {
      ok: false,
      provider,
      quotaDay,
      status: 503,
      error: "email_quota_not_configured",
    };
  }

  const dailyLimit = getProviderDailyLimit(env, provider);
  if (dailyLimit <= 0) {
    return {
      ok: false,
      provider,
      quotaDay,
      status: 429,
      error: "email_quota_exhausted",
      retryAfterSeconds: secondsUntilNextUtcDay(),
    };
  }

  const nowIso = new Date().toISOString();
  try {
    await db
      .prepare(
        "INSERT OR IGNORE INTO email_provider_daily_quotas (provider, quota_day, sent_count, daily_limit, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)",
      )
      .bind(provider, quotaDay, dailyLimit, nowIso, nowIso)
      .run();

    const result = await db
      .prepare(
        "UPDATE email_provider_daily_quotas SET sent_count = sent_count + 1, daily_limit = ?, updated_at = ? WHERE provider = ? AND quota_day = ? AND sent_count < ?",
      )
      .bind(dailyLimit, nowIso, provider, quotaDay, dailyLimit)
      .run();

    if ((result.meta?.changes ?? 0) !== 1) {
      return {
        ok: false,
        provider,
        quotaDay,
        status: 429,
        error: "email_quota_exhausted",
        retryAfterSeconds: secondsUntilNextUtcDay(),
      };
    }

    return {
      ok: true,
      provider,
      quotaDay,
    };
  } catch {
    return {
      ok: false,
      provider,
      quotaDay,
      status: 503,
      error: "email_quota_unavailable",
    };
  }
}

async function releaseProviderQuota(env: CiphoraEnv, reservation: EmailQuotaReservation): Promise<void> {
  const db = env.CIPHORA_OPS_RUNTIME;
  if (!db || !reservation.ok) return;

  const nowIso = new Date().toISOString();
  try {
    await db
      .prepare(
        "UPDATE email_provider_daily_quotas SET sent_count = CASE WHEN sent_count > 0 THEN sent_count - 1 ELSE 0 END, updated_at = ? WHERE provider = ? AND quota_day = ?",
      )
      .bind(nowIso, reservation.provider, reservation.quotaDay)
      .run();
  } catch {
    // Best-effort rollback only. The provider request already failed and the
    // visible user result should remain the delivery failure, not the rollback.
  }
}

function getProviderDailyLimit(env: CiphoraEnv, provider: EmailProvider): number {
  const limits = parseProviderNumberConfig(env.CIPHORA_EMAIL_PROVIDER_DAILY_LIMITS ?? DEFAULT_PROVIDER_DAILY_LIMITS);
  const value = limits.get(provider);
  if (value == null) {
    return provider === "brevo" ? 300 : 100;
  }
  return value;
}

function parseWeightedProviders(value: string): EmailProvider[] {
  const providers: EmailProvider[] = [];
  for (const part of value.split(",")) {
    const [rawProvider, rawWeight] = part.split(":");
    const provider = rawProvider?.trim().toLowerCase();
    if (provider !== "brevo" && provider !== "resend") continue;

    const weight = Math.max(1, Math.min(20, Number.parseInt(rawWeight?.trim() || "1", 10) || 1));
    for (let index = 0; index < weight; index += 1) {
      providers.push(provider);
    }
  }
  return providers;
}

function parseProviderNumberConfig(value: string): Map<EmailProvider, number> {
  const config = new Map<EmailProvider, number>();
  for (const part of value.split(",")) {
    const [rawProvider, rawValue] = part.split(":");
    const provider = rawProvider?.trim().toLowerCase();
    if (provider !== "brevo" && provider !== "resend") continue;

    const parsed = Number.parseInt(rawValue?.trim() || "", 10);
    if (!Number.isFinite(parsed)) continue;
    config.set(provider, Math.max(0, Math.min(100000, parsed)));
  }
  return config;
}

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(): number {
  const now = new Date();
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000));
}

function parseEmailFrom(value: string): { email: string; name?: string } {
  const match = /^(.*?)<([^>]+)>$/.exec(value);
  if (match) {
    const name = match[1]?.trim().replace(/^"|"$/g, "");
    const email = match[2]?.trim();
    return name ? { name, email } : { email };
  }

  return {
    name: APP_NAME,
    email: value.trim(),
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function renderEmailVerificationMessage(link: string) {
  const safeLink = escapeHtml(link);
  return {
    subject: "Verify your Ciphora email",
    text: [
      "Verify your Ciphora email address.",
      "",
      `Open this link within 24 hours: ${link}`,
      "",
      "If you did not request this email, ignore it.",
    ].join("\n"),
    html: baseEmailHtml({
      title: "Verify your email",
      intro: "Confirm this inbox for your Ciphora account.",
      actionLabel: "Verify Email",
      actionLink: safeLink,
      footer: "This link expires in 24 hours. If you did not request it, ignore this email.",
    }),
  };
}

export function renderRecoveryResetMessage(link: string) {
  const safeLink = escapeHtml(link);
  return {
    subject: "Reset your Ciphora account password",
    text: [
      "A Ciphora account password reset was requested.",
      "",
      `Open this link within 30 minutes, then enter your Recovery Key in Ciphora: ${link}`,
      "",
      "Ciphora will never ask for your Recovery Key by email.",
    ].join("\n"),
    html: baseEmailHtml({
      title: "Reset account password",
      intro: "Open this link, then prove possession of your Recovery Key inside Ciphora.",
      actionLabel: "Continue Reset",
      actionLink: safeLink,
      footer: "This link expires in 30 minutes. Ciphora will never ask for your Recovery Key by email.",
    }),
  };
}

function baseEmailHtml(input: {
  title: string;
  intro: string;
  actionLabel: string;
  actionLink: string;
  footer: string;
}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;background:#0a0c10;color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="border:1px solid #2a2f3a;border-radius:10px;background:#11151c;padding:24px;">
        <p style="margin:0 0 12px;color:#f5b301;font-size:12px;letter-spacing:.18em;text-transform:uppercase;">${APP_NAME}</p>
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#ffffff;">${escapeHtml(input.title)}</h1>
        <p style="margin:0 0 24px;color:#aeb7c8;font-size:14px;line-height:1.6;">${escapeHtml(input.intro)}</p>
        <a href="${input.actionLink}" style="display:inline-block;background:#f5b301;color:#0a0c10;text-decoration:none;font-weight:700;border-radius:6px;padding:12px 16px;font-size:13px;">${escapeHtml(input.actionLabel)}</a>
        <p style="margin:24px 0 0;color:#7d8797;font-size:12px;line-height:1.6;word-break:break-all;">${input.actionLink}</p>
        <p style="margin:20px 0 0;color:#7d8797;font-size:12px;line-height:1.6;">${escapeHtml(input.footer)}</p>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

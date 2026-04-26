import {
  assertSameOrigin,
  emailHash,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getUserAgent,
  hashRequestValue,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
} from "../../../_shared/auth";
import {
  findDirectoryUser,
  getActiveRecoveryWrapper,
  getRecoveryMetadata,
  getStoredRecoveryVerifier,
} from "../../../_shared/account";
import { randomBase64Url } from "../../../_shared/crypto";
import {
  buildAppLink,
  getTransactionalEmailQuotaStatus,
  renderRecoveryResetMessage,
  sendTransactionalEmail,
} from "../../../_shared/email";
import { errorResponse, jsonResponse, methodNotAllowed } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

const RESET_EMAIL_TTL_SECONDS = 30 * 60;

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const quotaStatus = await getTransactionalEmailQuotaStatus(env);
  if (quotaStatus.configured && quotaStatus.exhausted) {
    return errorResponse("email_quota_exhausted", 429, {
      retryAfterSeconds: quotaStatus.retryAfterSeconds,
    });
  }

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const normalizedEmail = normalizeEmail(body.email);
  if (normalizedEmail instanceof Response) return normalizedEmail;

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const ipRateLimited = await enforceRateLimit(ops, authSecret, "recovery-email-reset-request:ip", getClientIp(request), 12, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const emailRateLimited = await enforceRateLimit(ops, authSecret, "recovery-email-reset-request:email", normalizedEmailHash, 5, 60 * 60);
  if (emailRateLimited) return emailRateLimited;

  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + RESET_EMAIL_TTL_SECONDS * 1000).toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  let shouldSend = false;
  if (directoryUser?.account_status === "active") {
    const shard = getIdentityShard(env, directoryUser.shard_id);
    if (!(shard instanceof Response)) {
      const [metadata, recoveryWrapper, recoveryVerifier] = await Promise.all([
        getRecoveryMetadata(shard, directoryUser.user_id),
        getActiveRecoveryWrapper(shard, directoryUser.user_id),
        getStoredRecoveryVerifier(shard, directoryUser.user_id),
      ]);
      shouldSend = metadata?.recovery_enabled === 1 && !!recoveryWrapper && !!recoveryVerifier;
    }
  }

  if (shouldSend && directoryUser) {
    const tokenId = crypto.randomUUID();
    const token = `v1.${randomBase64Url(32)}`;
    const tokenHash = await hashRequestValue(authSecret, "password-reset-email-token", token);
    const resetLink = buildAppLink(request, env, "/vault/unlock", { recovery_reset_token: token });
    const message = renderRecoveryResetMessage(resetLink);

    await ops
      .prepare(
        "INSERT INTO password_reset_email_tokens (token_id, user_id, email_hash, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(tokenId, directoryUser.user_id, normalizedEmailHash, tokenHash, expiresAtIso)
      .run();

    const delivery = await sendTransactionalEmail(env, {
      to: normalizedEmail,
      subject: message.subject,
      text: message.text,
      html: message.html,
      idempotencyKey: `recovery-reset-${tokenId}`,
    });

    if (delivery.ok) {
      const shard = getIdentityShard(env, directoryUser.shard_id);
      if (!(shard instanceof Response)) {
        await shard
          .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.recovery_reset_email_sent', 'warning', ?, ?, ?, ?)")
          .bind(
            crypto.randomUUID(),
            directoryUser.user_id,
            ipHash,
            userAgentHash,
            JSON.stringify({ shardId: directoryUser.shard_id, expiresAt: expiresAtIso }),
            nowIso,
          )
          .run();
      }
    }
  }

  await ops
    .prepare("INSERT INTO short_audit_events (event_id, user_id, event_type, severity, ip_hash, user_agent_hash, metadata_json, created_at, archive_after_at) VALUES (?, ?, 'auth.recovery_reset_email_requested', 'info', ?, ?, ?, ?, ?)")
    .bind(
      crypto.randomUUID(),
      directoryUser?.user_id ?? null,
      ipHash,
      userAgentHash,
      JSON.stringify({ eligible: shouldSend }),
      nowIso,
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    )
    .run();

  return jsonResponse({
    ok: true,
    message: "If that account can be reset, Ciphora has sent a reset link to the inbox.",
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

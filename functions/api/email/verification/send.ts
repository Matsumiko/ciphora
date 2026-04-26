import {
  assertSameOrigin,
  emailHash,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  getUserAgent,
  hashRequestValue,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
} from "../../../_shared/auth";
import {
  getEmailVerificationStatus,
  getPrimaryEmailHash,
} from "../../../_shared/account";
import { randomBase64Url } from "../../../_shared/crypto";
import {
  buildAppLink,
  renderEmailVerificationMessage,
  sendTransactionalEmail,
} from "../../../_shared/email";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const normalizedEmail = normalizeEmail(body.email);
  if (normalizedEmail instanceof Response) return normalizedEmail;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const [submittedEmailHash, primaryEmailHash] = await Promise.all([
    emailHash(authSecret, normalizedEmail),
    getPrimaryEmailHash(shard, session.userId),
  ]);

  if (!primaryEmailHash || submittedEmailHash !== primaryEmailHash) {
    return errorResponse("email_mismatch", 400);
  }

  const existingStatus = await getEmailVerificationStatus(directory, submittedEmailHash, session.userId);
  if (existingStatus.verified) {
    return jsonResponse({
      ok: true,
      sent: false,
      emailVerification: existingStatus,
    });
  }

  const userRateLimited = await enforceRateLimit(ops, authSecret, "email-verification-send:user", session.userId, 6, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "email-verification-send:ip", getClientIp(request), 24, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const emailRateLimited = await enforceRateLimit(ops, authSecret, "email-verification-send:email", submittedEmailHash, 6, 60 * 60);
  if (emailRateLimited) return emailRateLimited;

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_SECONDS * 1000).toISOString();
  const challengeId = crypto.randomUUID();
  const token = `v1.${randomBase64Url(32)}`;
  const tokenHash = await hashRequestValue(authSecret, "email-verification-token", token);
  const verificationLink = buildAppLink(request, env, "/vault/settings", { verify_email_token: token });
  const message = renderEmailVerificationMessage(verificationLink);

  await ops
    .prepare(
      "INSERT INTO email_verification_challenges (challenge_id, user_id, email_hash, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(challengeId, session.userId, submittedEmailHash, tokenHash, expiresAtIso)
    .run();

  const delivery = await sendTransactionalEmail(env, {
    to: normalizedEmail,
    subject: message.subject,
    text: message.text,
    html: message.html,
    idempotencyKey: `email-verify-${challengeId}`,
  });

  if (!delivery.ok) {
    return errorResponse(
      delivery.error ?? "email_delivery_failed",
      delivery.status,
      delivery.retryAfterSeconds ? { retryAfterSeconds: delivery.retryAfterSeconds } : {},
    );
  }

  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  await shard
    .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'email.verification_sent', 'info', ?, ?, ?, ?)")
    .bind(
      crypto.randomUUID(),
      session.userId,
      ipHash,
      userAgentHash,
      JSON.stringify({ shardId: session.shardId, expiresAt: expiresAtIso }),
      nowIso,
    )
    .run();

  return jsonResponse({
    ok: true,
    sent: true,
    expiresAt: expiresAtIso,
    emailVerification: {
      verified: false,
      verifiedAt: null,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

import {
  assertSameOrigin,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  getUserAgent,
  hashRequestValue,
  requireAuthSecret,
  requireDirectory,
  requireOpsRuntime,
  validateChallengeToken,
  readJsonObject,
} from "../../../_shared/auth";
import {
  getEmailVerificationStatus,
  getPrimaryEmailHash,
} from "../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

const EMAIL_VERIFICATION_MAX_ATTEMPTS = 6;

interface EmailVerificationChallengeRow {
  challenge_id: string;
  user_id: string | null;
  email_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
}

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

  const token = validateChallengeToken(body.token, "invalid_verification_token");
  if (token instanceof Response) return token;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const primaryEmailHash = await getPrimaryEmailHash(shard, session.userId);
  if (!primaryEmailHash) return unauthorized();

  const userRateLimited = await enforceRateLimit(ops, authSecret, "email-verification-confirm:user", session.userId, 12, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const tokenHash = await hashRequestValue(authSecret, "email-verification-token", token);
  const challenge = await ops
    .prepare(
      "SELECT challenge_id, user_id, email_hash, attempts, expires_at, consumed_at FROM email_verification_challenges WHERE token_hash = ? LIMIT 1",
    )
    .bind(tokenHash)
    .first<EmailVerificationChallengeRow>();

  const invalid = async () => {
    if (challenge?.challenge_id) {
      await ops
        .prepare("UPDATE email_verification_challenges SET attempts = attempts + 1 WHERE challenge_id = ? AND consumed_at IS NULL")
        .bind(challenge.challenge_id)
        .run();
    }
    return errorResponse("invalid_verification_token", 401);
  };

  if (
    !challenge
    || challenge.consumed_at
    || Date.parse(challenge.expires_at) <= Date.now()
    || challenge.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS
    || challenge.user_id !== session.userId
    || challenge.email_hash !== primaryEmailHash
  ) {
    return invalid();
  }

  const nowIso = new Date().toISOString();
  const consumeResult = await ops
    .prepare("UPDATE email_verification_challenges SET consumed_at = ? WHERE challenge_id = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(nowIso, challenge.challenge_id, nowIso)
    .run();
  if ((consumeResult.meta.changes ?? 0) !== 1) {
    return invalid();
  }

  await directory
    .prepare(
      "INSERT INTO directory_email_aliases (alias_email_hash, user_id, verified_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(alias_email_hash) DO UPDATE SET verified_at = excluded.verified_at WHERE directory_email_aliases.user_id = excluded.user_id",
    )
    .bind(primaryEmailHash, session.userId, nowIso, nowIso)
    .run();

  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));
  await shard
    .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'email.verified', 'info', ?, ?, ?, ?)")
    .bind(
      crypto.randomUUID(),
      session.userId,
      ipHash,
      userAgentHash,
      JSON.stringify({ shardId: session.shardId }),
      nowIso,
    )
    .run();

  return jsonResponse({
    ok: true,
    emailVerification: await getEmailVerificationStatus(directory, primaryEmailHash, session.userId),
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

import {
  SESSION_COOKIE_NAME,
  assertSameOrigin,
  clearSessionCookie,
  getIdentityShard,
  getClientIp,
  getSessionFromRequest,
  getUserAgent,
  hashRequestValue,
  parseSessionShard,
  readCookie,
  requireAuthSecret,
  sessionTokenHash,
} from "../../_shared/auth";
import { jsonResponse, methodNotAllowed } from "../../_shared/http";
import type { CiphoraEnv } from "../../_shared/env";

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const token = readCookie(request, SESSION_COOKIE_NAME);
  const shardId = parseSessionShard(token);
  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;

  if (token && shardId != null) {
    const shard = getIdentityShard(env, shardId);
    if (shard instanceof Response) return shard;
    const nowIso = new Date().toISOString();
    const statements = [
      shard
        .prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = COALESCE(revoked_reason, 'logout') WHERE session_token_hash = ? AND revoked_at IS NULL")
        .bind(nowIso, await sessionTokenHash(authSecret, token)),
    ];

    if (session) {
      statements.push(
        shard
          .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.logout', 'info', ?, ?, ?, ?)")
          .bind(
            crypto.randomUUID(),
            session.userId,
            await hashRequestValue(authSecret, "ip", getClientIp(request)),
            await hashRequestValue(authSecret, "user-agent", getUserAgent(request)),
            JSON.stringify({ shardId: session.shardId, currentSession: true }),
            nowIso,
          ),
      );
    }

    await shard.batch(statements);
  }

  return jsonResponse(
    {
      ok: true,
    },
    {
      headers: {
        "set-cookie": clearSessionCookie(request),
      },
    },
  );
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

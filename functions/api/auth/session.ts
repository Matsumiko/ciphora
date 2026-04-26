import {
  SESSION_COOKIE_NAME,
  getIdentityShard,
  getSessionFromRequest,
  readCookie,
} from "../../_shared/auth";
import { jsonResponse, methodNotAllowed, unauthorized } from "../../_shared/http";
import type { CiphoraEnv } from "../../_shared/env";

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (!token) return unauthorized();

  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const nowIso = new Date().toISOString();
  const statements = [
    shard
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ? AND user_id = ?")
      .bind(nowIso, session.sessionId, session.userId),
  ];
  if (session.deviceId) {
    statements.push(
      shard
        .prepare("UPDATE devices SET last_seen_at = ? WHERE device_id = ? AND user_id = ?")
        .bind(nowIso, session.deviceId, session.userId),
    );
  }
  await shard.batch(statements);

  return jsonResponse({
    ok: true,
    user: {
      userId: session.userId,
      shardId: session.shardId,
      accountStatus: session.accountStatus,
    },
    session: {
      expiresAt: session.expiresAt,
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

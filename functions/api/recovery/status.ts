import { getIdentityShard, getSessionFromRequest } from "../../_shared/auth";
import {
  getActiveRecoveryWrapperCount,
  getRecoveryMetadata,
  getStoredRecoveryVerifier,
  serializeRecoveryStatus,
} from "../../_shared/account";
import { jsonResponse, methodNotAllowed, unauthorized } from "../../_shared/http";
import type { CiphoraEnv } from "../../_shared/env";

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const [metadata, activeWrapperCount, recoveryVerifier] = await Promise.all([
    getRecoveryMetadata(shard, session.userId),
    getActiveRecoveryWrapperCount(shard, session.userId),
    getStoredRecoveryVerifier(shard, session.userId),
  ]);

  return jsonResponse({
    ok: true,
    recovery: serializeRecoveryStatus(metadata, activeWrapperCount, !!recoveryVerifier),
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

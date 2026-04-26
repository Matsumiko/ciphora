import {
  getIdentityShard,
  getSessionFromRequest,
  requireDirectory,
} from "../../../_shared/auth";
import {
  getEmailVerificationStatus,
  getPrimaryEmailHash,
} from "../../../_shared/account";
import { jsonResponse, methodNotAllowed, unauthorized } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const primaryEmailHash = await getPrimaryEmailHash(shard, session.userId);
  if (!primaryEmailHash) return unauthorized();

  const status = await getEmailVerificationStatus(directory, primaryEmailHash, session.userId);

  return jsonResponse({
    ok: true,
    emailVerification: status,
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

import {
  getIdentityShard,
  getSessionFromRequest,
} from "../../../_shared/auth";
import { getAuthMetadata, getOpaqueCredential, serializeAuthMetadata } from "../../../_shared/account";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const metadata = await getAuthMetadata(shard, session.userId);
  if (!metadata) {
    const opaqueCredential = await getOpaqueCredential(shard, session.userId);
    if (opaqueCredential) {
      return jsonResponse({
        ok: true,
        authMode: "opaque",
      });
    }
    return errorResponse("account_password_not_configured", 409);
  }

  return jsonResponse({
    ok: true,
    password: serializeAuthMetadata(metadata),
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

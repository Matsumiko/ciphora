import {
  assertSameOrigin,
  createLoginChallenge,
  emailHash,
  fakeLoginMetadata,
  normalizeEmail,
  readJsonObject,
  requireAuthSecret,
  requireDirectory,
} from "../../../_shared/auth";
import { findDirectoryUser, getAuthMetadata, serializeAuthMetadata } from "../../../_shared/account";
import { getIdentityShard } from "../../../_shared/auth";
import { jsonResponse, methodNotAllowed } from "../../../_shared/http";
import type { CiphoraEnv } from "../../../_shared/env";

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const directory = requireDirectory(env);
  if (directory instanceof Response) return directory;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const normalizedEmail = normalizeEmail(body.email);
  if (normalizedEmail instanceof Response) return normalizedEmail;

  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  const directoryUser = await findDirectoryUser(directory, normalizedEmailHash);
  if (!directoryUser || directoryUser.account_status !== "active") {
    return jsonResponse({
      ok: true,
      login: await fakeLoginMetadata(authSecret, normalizedEmail),
    });
  }

  const shard = getIdentityShard(env, directoryUser.shard_id);
  if (shard instanceof Response) return shard;

  const metadata = await getAuthMetadata(shard, directoryUser.user_id);
  if (!metadata) {
    return jsonResponse({
      ok: true,
      login: await fakeLoginMetadata(authSecret, normalizedEmail),
    });
  }

  return jsonResponse({
    ok: true,
    login: {
      ...serializeAuthMetadata(metadata),
      challenge: await createLoginChallenge(authSecret, normalizedEmailHash),
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["POST"]);

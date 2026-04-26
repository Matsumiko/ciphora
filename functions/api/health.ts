import { getIdentityShardBindings, isConfigured, type CiphoraEnv } from "../_shared/env";
import { jsonResponse, methodNotAllowed } from "../_shared/http";

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env }) => {
  const identityShards = getIdentityShardBindings(env);
  const configuredIdentityShards = identityShards.filter((item) => item.database).length;

  return jsonResponse({
    ok: true,
    service: "ciphora-api",
    status: "foundation_ready",
    environment: env.CIPHORA_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
    components: {
      d1: {
        directoryConfigured: Boolean(env.CIPHORA_DIRECTORY),
        identityShardCount: identityShards.length,
        identityShardsConfigured: configuredIdentityShards,
        opsRuntimeConfigured: Boolean(env.CIPHORA_OPS_RUNTIME),
      },
      tursoArchive: {
        urlConfigured: isConfigured(env.TURSO_URL_DB),
        tokenConfigured: isConfigured(env.TURSO_TOKEN),
      },
    },
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

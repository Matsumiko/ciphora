import { getIdentityShardBindings, isInternalRequest, type CiphoraEnv } from "../../_shared/env";
import { jsonResponse, methodNotAllowed, unauthorized } from "../../_shared/http";

async function checkD1(name: string, database?: D1Database) {
  if (!database) {
    return {
      name,
      configured: false,
      ok: false,
    };
  }

  try {
    await database.prepare("SELECT 1 AS ok").first();
    return {
      name,
      configured: true,
      ok: true,
    };
  } catch {
    return {
      name,
      configured: true,
      ok: false,
    };
  }
}

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  if (!isInternalRequest(request, env)) {
    return unauthorized();
  }

  const checks = await Promise.all([
    checkD1("CIPHORA_DIRECTORY", env.CIPHORA_DIRECTORY),
    ...getIdentityShardBindings(env).map((item) => checkD1(item.binding, item.database)),
    checkD1("CIPHORA_OPS_RUNTIME", env.CIPHORA_OPS_RUNTIME),
  ]);

  return jsonResponse({
    ok: checks.every((item) => item.ok),
    service: "ciphora-api",
    component: "d1",
    timestamp: new Date().toISOString(),
    checks,
  });
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

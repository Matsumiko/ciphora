import { createClient } from "@libsql/client/web";
import { isConfigured, isInternalRequest, type CiphoraEnv } from "../../_shared/env";
import { jsonResponse, methodNotAllowed, unauthorized } from "../../_shared/http";

const expectedTables = [
  "archive_schema_migrations",
  "audit_archive",
  "email_delivery_archive",
  "ops_metrics_daily",
  "privacy_safe_usage_daily",
  "incident_notes",
];

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  if (!isInternalRequest(request, env)) {
    return unauthorized();
  }

  if (!isConfigured(env.TURSO_URL_DB) || !isConfigured(env.TURSO_TOKEN)) {
    return jsonResponse(
      {
        ok: false,
        service: "ciphora-api",
        component: "turso_archive",
        error: "turso_archive_not_configured",
      },
      { status: 503 },
    );
  }

  try {
    const client = createClient({
      url: env.TURSO_URL_DB as string,
      authToken: env.TURSO_TOKEN as string,
    });
    const ping = await client.execute("SELECT 1 AS ok");
    const tables = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?,?,?,?,?,?) ORDER BY name",
      args: expectedTables,
    });
    client.close();

    return jsonResponse({
      ok: Number(ping.rows[0]?.ok ?? 0) === 1,
      service: "ciphora-api",
      component: "turso_archive",
      timestamp: new Date().toISOString(),
      schema: {
        expectedTables: expectedTables.length,
        presentTables: tables.rows.map((row) => String(row.name)),
      },
    });
  } catch {
    return jsonResponse(
      {
        ok: false,
        service: "ciphora-api",
        component: "turso_archive",
        error: "turso_archive_unavailable",
      },
      { status: 503 },
    );
  }
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET"]);

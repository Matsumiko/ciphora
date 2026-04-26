import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSecretPath = resolve(rootDir, ".env.turso.local");
const archiveSchemaPath = resolve(rootDir, "schema", "turso", "archive.sql");
const expectedTables = [
  "archive_schema_migrations",
  "audit_archive",
  "email_delivery_archive",
  "ops_metrics_daily",
  "privacy_safe_usage_daily",
  "incident_notes",
];

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function splitSqlStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));
}

function createArchiveClient(env) {
  if (!env.TURSO_URL_DB || !env.TURSO_TOKEN) {
    throw new Error("Missing TURSO_URL_DB or TURSO_TOKEN.");
  }

  return createClient({
    url: env.TURSO_URL_DB,
    authToken: env.TURSO_TOKEN,
  });
}

async function checkArchive(client) {
  const ping = await client.execute("SELECT 1 AS ok");
  const tables = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?,?,?,?,?,?) ORDER BY name",
    args: expectedTables,
  });

  return {
    connected: Number(ping.rows[0]?.ok ?? 0) === 1,
    expectedTables: expectedTables.length,
    presentTables: tables.rows.map((row) => String(row.name)),
  };
}

async function migrateArchive(client) {
  const sql = readFileSync(archiveSchemaPath, "utf8");
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    await client.execute(statement);
  }

  return statements.length;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const shouldMigrate = args.has("--migrate");
  const shouldCheck = args.has("--check") || !shouldMigrate;
  const env = {
    ...process.env,
    ...loadEnvFile(defaultSecretPath),
  };
  const client = createArchiveClient(env);

  try {
    let statementsApplied = 0;
    if (shouldMigrate) {
      statementsApplied = await migrateArchive(client);
    }

    const health = shouldCheck || shouldMigrate ? await checkArchive(client) : null;
    console.log(
      JSON.stringify(
        {
          ok: health ? health.connected : true,
          secretFilePresent: existsSync(defaultSecretPath),
          urlConfigured: Boolean(env.TURSO_URL_DB),
          tokenConfigured: Boolean(env.TURSO_TOKEN),
          statementsApplied,
          health,
        },
        null,
        2,
      ),
    );
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Turso archive error.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

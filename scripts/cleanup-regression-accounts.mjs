import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_ENV_FILE = ".env.cloudflare.local";
const DEFAULT_OWNER_ENV_FILE = ".env.owner.local";
const DIRECTORY_DATABASE = "ciphora_directory";
const OPS_DATABASE = "ciphora_ops_runtime";
const IDENTITY_DATABASES = [
  "ciphora_identity_00",
  "ciphora_identity_01",
  "ciphora_identity_02",
  "ciphora_identity_03",
  "ciphora_identity_04",
  "ciphora_identity_05",
  "ciphora_identity_06",
  "ciphora_identity_07",
];

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_HASH_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/i;

const USER_RATE_LIMIT_SCOPES = [
  "device-session:user",
  "email-verification-confirm:user",
  "email-verification-send:user",
  "opaque-password-change-start:user",
  "opaque-password-change-finish:user",
  "opaque-upgrade-start:user",
  "opaque-upgrade-finish:user",
  "password-change:user",
  "recovery-setup:user",
  "sync-profile-save:user",
  "sync-profile-disable:user",
];

const EMAIL_RATE_LIMIT_SCOPES = [
  "signup:email",
  "login:email",
  "email-verification-send:email",
  "recovery-email-reset-request:email",
  "recovery-reset-start:email",
  "recovery-reset-finish:email",
];

const IP_RATE_LIMIT_SCOPES = [
  "signup:ip",
  "login:ip",
  "device-session:ip",
  "email-verification-confirm:ip",
  "email-verification-send:ip",
  "opaque-password-change-start:ip",
  "opaque-password-change-finish:ip",
  "opaque-upgrade-start:ip",
  "opaque-upgrade-finish:ip",
  "password-change:ip",
  "recovery-email-reset-request:ip",
  "recovery-reset-start:ip",
  "recovery-reset-finish:ip",
  "recovery-setup:ip",
  "sync-profile-save:ip",
  "sync-profile-disable:ip",
];

function parseArgs(argv) {
  const options = {
    envFile: process.env.CIPHORA_CLOUDFLARE_ENV_FILE || DEFAULT_ENV_FILE,
    ownerEnvFile: process.env.CIPHORA_OWNER_ENV_FILE || DEFAULT_OWNER_ENV_FILE,
    dryRun: false,
    forceUserIdOnly: false,
    includeIpRateLimits: false,
    clientIp: "",
    accounts: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") options.envFile = argv[++index] || options.envFile;
    else if (arg === "--owner-env-file") options.ownerEnvFile = argv[++index] || options.ownerEnvFile;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force-user-id-only") options.forceUserIdOnly = true;
    else if (arg === "--include-ip-rate-limits") options.includeIpRateLimits = true;
    else if (arg === "--client-ip") options.clientIp = argv[++index] || "";
    else if (arg === "--user-id") {
      const userId = argv[++index];
      options.accounts.push({
        userId,
        shardId: null,
        email: null,
      });
    } else if (arg === "--shard-id") {
      const shardId = argv[++index];
      const account = options.accounts.at(-1);
      if (!account || account.shardId !== null) throw new Error("--shard-id must follow a --user-id account");
      account.shardId = shardId;
    } else if (arg === "--email") {
      const email = argv[++index];
      const account = options.accounts.at(-1);
      if (!account || account.email !== null) throw new Error("--email must follow a --user-id account");
      account.email = email;
    } else if (arg === "--account-json") {
      options.accounts.push(...parseAccountJson(argv[++index] || "[]"));
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    ...options,
    clientIp: normalizeClientIp(options.clientIp, options.includeIpRateLimits),
    accounts: options.accounts.map((account) => normalizeAccount(account, options.forceUserIdOnly)),
  };
}

function printHelp() {
  console.log(`Ciphora regression QA cleanup

Usage:
  node scripts/cleanup-regression-accounts.mjs --account-json '[{"userId":"...","shardId":0,"email":"qa@example.invalid"}]'
  node scripts/cleanup-regression-accounts.mjs --user-id <uuid> --shard-id <0-7> --email <qa@example.invalid>

Options:
  --env-file <path>          Cloudflare env file. Default: ${DEFAULT_ENV_FILE}
  --owner-env-file <path>    Owner secret env file for auth-secret-derived cleanup hashes. Default: ${DEFAULT_OWNER_ENV_FILE}
  --dry-run                  Validate targets and print databases that would be touched.
  --force-user-id-only       Allow cleanup without a .example.invalid email. Avoid unless manually recovering known smoke residue.
  --include-ip-rate-limits   Also remove rate-limit buckets for --client-ip. Explicit because IP buckets are shared abuse signals.
  --client-ip <ip>           Client IP to use with --include-ip-rate-limits.
`);
}

function parseAccountJson(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid --account-json: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) throw new Error("--account-json must be an array");
  return parsed.map((item) => ({
    userId: item?.userId,
    shardId: item?.shardId,
    email: item?.email ?? null,
  }));
}

function normalizeAccount(account, forceUserIdOnly) {
  const userId = typeof account.userId === "string" ? account.userId.trim() : "";
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error(`Invalid userId for cleanup target: ${userId || "(empty)"}`);
  }

  const shardNumber = Number(account.shardId);
  if (!Number.isInteger(shardNumber) || shardNumber < 0 || shardNumber >= IDENTITY_DATABASES.length) {
    throw new Error(`Invalid shardId for cleanup target ${userId}: ${account.shardId}`);
  }

  const email = typeof account.email === "string" && account.email.trim()
    ? account.email.trim().toLowerCase()
    : null;
  if (!forceUserIdOnly && (!email || !email.endsWith("@example.invalid"))) {
    throw new Error(`Refusing cleanup for ${userId}: email must end with @example.invalid`);
  }

  return {
    userId,
    shardId: shardNumber,
    email,
  };
}

function normalizeClientIp(value, required) {
  const ip = typeof value === "string" ? value.trim() : "";
  if (!required) return ip;
  if (!ip || ip.length > 128 || !/^[0-9A-Fa-f:.]+$/.test(ip)) {
    throw new Error("--client-ip is required and must look like an IPv4 or IPv6 address when --include-ip-rate-limits is used");
  }
  return ip;
}

function readEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};

  const values = {};
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = stripEnvQuotes(match[2].trim());
  }
  return values;
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function hmacHex(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function emailHash(authSecret, email) {
  return `hmac-sha256:${hmacHex(authSecret, `email:${email}`)}`;
}

function rateBucketKey(authSecret, scope, key) {
  return `rl:${scope}:${hmacHex(authSecret, `rate:${scope}:${key}`)}`;
}

function sqlValue(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlList(values) {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) return "('')";
  return `(${unique.map(sqlValue).join(", ")})`;
}

function buildIdentitySql(accounts) {
  const ids = sqlList(accounts.map((account) => account.userId));
  return `
DELETE FROM sessions WHERE user_id IN ${ids};
DELETE FROM devices WHERE user_id IN ${ids};
DELETE FROM sync_profiles WHERE user_id IN ${ids};
DELETE FROM root_key_wrappers WHERE user_id IN ${ids};
DELETE FROM recovery_verifiers WHERE user_id IN ${ids};
DELETE FROM recovery_metadata WHERE user_id IN ${ids};
DELETE FROM opaque_credentials WHERE user_id IN ${ids};
DELETE FROM auth_verifiers WHERE user_id IN ${ids};
DELETE FROM user_kdf_params WHERE user_id IN ${ids};
DELETE FROM account_events WHERE user_id IN ${ids};
DELETE FROM users WHERE user_id IN ${ids};
SELECT 'identity_remaining' AS check_name,
  (
    (SELECT COUNT(*) FROM sessions WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM devices WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM sync_profiles WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM root_key_wrappers WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM recovery_verifiers WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM recovery_metadata WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM opaque_credentials WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM auth_verifiers WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM user_kdf_params WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM account_events WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM users WHERE user_id IN ${ids})
  ) AS remaining;
`.trim();
}

function buildDirectorySql(accounts) {
  const ids = sqlList(accounts.map((account) => account.userId));
  return `
DELETE FROM directory_email_aliases WHERE user_id IN ${ids};
DELETE FROM directory_users WHERE user_id IN ${ids};
SELECT 'directory_remaining' AS check_name,
  (
    (SELECT COUNT(*) FROM directory_email_aliases WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM directory_users WHERE user_id IN ${ids})
  ) AS remaining;
`.trim();
}

function buildOpsSql(accounts, authSecret, options) {
  const ids = sqlList(accounts.map((account) => account.userId));
  const emailHashes = authSecret
    ? accounts
      .map((account) => account.email ? emailHash(authSecret, account.email) : null)
      .filter((hash) => typeof hash === "string" && EMAIL_HASH_PATTERN.test(hash))
    : [];
  const emailHashClause = emailHashes.length > 0 ? ` OR email_hash IN ${sqlList(emailHashes)}` : "";
  const rateBucketKeys = authSecret
    ? buildRateBucketKeys(accounts, authSecret, emailHashes, options)
    : [];
  const rateBucketDelete = rateBucketKeys.length > 0
    ? `DELETE FROM rate_limit_buckets WHERE bucket_key IN ${sqlList(rateBucketKeys)};`
    : "";
  const rateBucketCount = rateBucketKeys.length > 0
    ? ` + (SELECT COUNT(*) FROM rate_limit_buckets WHERE bucket_key IN ${sqlList(rateBucketKeys)})`
    : "";

  return `
DELETE FROM email_verification_challenges WHERE user_id IN ${ids}${emailHashClause};
DELETE FROM password_reset_challenges WHERE user_id IN ${ids}${emailHashClause};
DELETE FROM password_reset_email_tokens WHERE user_id IN ${ids}${emailHashClause};
DELETE FROM opaque_login_challenges WHERE user_id IN ${ids}${emailHashClause};
DELETE FROM opaque_credential_epochs WHERE user_id IN ${ids};
DELETE FROM opaque_credential_revocations WHERE user_id IN ${ids};
DELETE FROM short_audit_events WHERE user_id IN ${ids};
DELETE FROM provider_health_checks WHERE user_id IN ${ids};
${rateBucketDelete}
SELECT 'ops_remaining' AS check_name,
  (
    (SELECT COUNT(*) FROM email_verification_challenges WHERE user_id IN ${ids}${emailHashClause}) +
    (SELECT COUNT(*) FROM password_reset_challenges WHERE user_id IN ${ids}${emailHashClause}) +
    (SELECT COUNT(*) FROM password_reset_email_tokens WHERE user_id IN ${ids}${emailHashClause}) +
    (SELECT COUNT(*) FROM opaque_login_challenges WHERE user_id IN ${ids}${emailHashClause}) +
    (SELECT COUNT(*) FROM opaque_credential_epochs WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM opaque_credential_revocations WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM short_audit_events WHERE user_id IN ${ids}) +
    (SELECT COUNT(*) FROM provider_health_checks WHERE user_id IN ${ids})
    ${rateBucketCount}
  ) AS remaining;
`.trim();
}

function buildRateBucketKeys(accounts, authSecret, emailHashes, options) {
  const keys = [];
  for (const account of accounts) {
    for (const scope of USER_RATE_LIMIT_SCOPES) {
      keys.push(rateBucketKey(authSecret, scope, account.userId));
    }
  }
  for (const hash of emailHashes) {
    for (const scope of EMAIL_RATE_LIMIT_SCOPES) {
      keys.push(rateBucketKey(authSecret, scope, hash));
    }
  }
  if (options.includeIpRateLimits && options.clientIp) {
    for (const scope of IP_RATE_LIMIT_SCOPES) {
      keys.push(rateBucketKey(authSecret, scope, options.clientIp));
    }
  }
  return keys;
}

function groupByShard(accounts) {
  const groups = new Map();
  for (const account of accounts) {
    const existing = groups.get(account.shardId) || [];
    existing.push(account);
    groups.set(account.shardId, existing);
  }
  return groups;
}

function runWranglerD1(database, sql, options) {
  if (options.dryRun) {
    console.log(`[DRY-RUN] Would clean ${database}`);
    return;
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), "ciphora-qa-cleanup-"));
  const sqlFile = path.join(tempDir, "cleanup.sql");
  writeFileSync(sqlFile, `${sql}\n`, "utf8");

  try {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = [
      "wrangler",
      "d1",
      "execute",
      database,
      "--remote",
      "--json",
      "--yes",
      "--file",
      sqlFile,
    ];
    if (options.envFile) {
      args.push("--env-file", options.envFile);
    }

    const result = spawnSync(executable, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: options.cloudflareToken,
      },
      shell: process.platform === "win32",
      windowsHide: true,
    });

    if (result.status !== 0) {
      const detail = result.error instanceof Error
        ? result.error.message
        : sanitizeOutput(result.stderr || result.stdout || `exit ${result.status}`);
      throw new Error(`Wrangler cleanup failed for ${database}: ${detail}`);
    }

    const remainingValues = extractRemainingValues(result.stdout);
    const badRemaining = remainingValues.filter((value) => value !== 0);
    if (badRemaining.length > 0) {
      throw new Error(`Cleanup verification failed for ${database}: remaining=${badRemaining.join(",")}`);
    }

    console.log(`[CLEANUP] ${database}: remaining=0`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractRemainingValues(output) {
  const values = [];
  const clean = output.trim();
  if (!clean) return values;

  try {
    const parsed = JSON.parse(clean);
    walkJson(parsed, values);
  } catch {
    for (const match of clean.matchAll(/"remaining"\s*:\s*(\d+)/g)) {
      values.push(Number(match[1]));
    }
  }

  return values;
}

function walkJson(value, results) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, results);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "remaining" && typeof child === "number") {
      results.push(child);
    } else {
      walkJson(child, results);
    }
  }
}

function sanitizeOutput(value) {
  return String(value || "")
    .replace(/CLOUDFLARE_API_TOKEN=[^\s]+/g, "CLOUDFLARE_API_TOKEN=[REDACTED]")
    .slice(0, 1200);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.accounts.length === 0) {
    throw new Error("No cleanup accounts provided");
  }

  const cloudflareEnv = readEnvFile(options.envFile);
  const ownerEnv = readEnvFile(options.ownerEnvFile);
  const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN || cloudflareEnv.CLOUDFLARE_API_TOKEN;
  if (!cloudflareToken && !options.dryRun) {
    throw new Error(`CLOUDFLARE_API_TOKEN missing; expected it in environment or ${options.envFile}`);
  }

  const authSecret = process.env.CIPHORA_AUTH_SECRET || ownerEnv.CIPHORA_AUTH_SECRET || "";
  const runOptions = {
    ...options,
    cloudflareToken,
  };

  const targetLabel = options.accounts.length === 1 ? "account" : "accounts";
  console.log(`[CLEANUP] Targeting ${options.accounts.length} disposable QA ${targetLabel}`);
  if (!authSecret) {
    console.log("[CLEANUP] CIPHORA_AUTH_SECRET unavailable; user-scoped rows will be cleaned, email-hash/rate-limit cleanup skipped.");
  }
  if (options.includeIpRateLimits) {
    console.log("[CLEANUP] Client IP rate-limit cleanup explicitly enabled.");
  }

  for (const [shardId, shardAccounts] of groupByShard(options.accounts).entries()) {
    runWranglerD1(IDENTITY_DATABASES[shardId], buildIdentitySql(shardAccounts), runOptions);
  }
  runWranglerD1(OPS_DATABASE, buildOpsSql(options.accounts, authSecret, options), runOptions);
  runWranglerD1(DIRECTORY_DATABASE, buildDirectorySql(options.accounts), runOptions);

  console.log(options.includeIpRateLimits
    ? "[CLEANUP] Done. Only the provided client IP rate-limit buckets were targeted."
    : "[CLEANUP] Done. Shared IP rate-limit buckets are intentionally left to expire.");
}

main().catch((error) => {
  console.error(`[CLEANUP:FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

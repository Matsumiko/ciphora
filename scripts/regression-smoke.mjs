#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://app.ciphora.indevs.in";
const REQUEST_TIMEOUT_MS = 20_000;
const BROWSER_TIMEOUT_MS = 30_000;
const BROWSER_COMMAND_TIMEOUT_MS = 30_000;
const OPAQUE_KEY_STRETCHING = "memory-constrained";
const OPAQUE_ROOT_WRAPPER_KDF = "opaque-rfc9807-export-key-hkdf-sha256";
const ACCOUNT_KDF_ALGORITHM = "client-pbkdf2-sha256";
const ACCOUNT_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-proof-v1";
const ACCOUNT_KDF_ITERATIONS = 310000;
const ACCOUNT_SALT_BYTES = 32;
const ACCOUNT_KEY_BYTES = 32;
const ACCOUNT_DERIVED_BYTES = ACCOUNT_KEY_BYTES * 2;

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.CIPHORA_REGRESSION_BASE_URL ?? DEFAULT_BASE_URL,
    browserPath: process.env.CHROME_PATH ?? "",
    skipApi: false,
    skipBrowser: false,
    includeRecoveryWrite: false,
    includeOpaqueLoginWrite: false,
    includeOpaqueAccountWrite: false,
    includeLegacyUpgradeWrite: false,
    cleanupStatefulAccounts: false,
    cleanupEnvFile: process.env.CIPHORA_CLOUDFLARE_ENV_FILE ?? ".env.cloudflare.local",
    cleanupOwnerEnvFile: process.env.CIPHORA_OWNER_ENV_FILE ?? ".env.owner.local",
    cleanupClientIp: process.env.CIPHORA_REGRESSION_CLEANUP_CLIENT_IP ?? "",
    statefulCleanupTargets: [],
    tursoUrl: process.env.CIPHORA_REGRESSION_TURSO_URL ?? "",
    tursoToken: process.env.CIPHORA_REGRESSION_TURSO_TOKEN ?? "",
    d1BridgeUrl: process.env.CIPHORA_REGRESSION_D1_BRIDGE_URL ?? "",
    d1BridgeToken: process.env.CIPHORA_REGRESSION_D1_BRIDGE_TOKEN ?? "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") options.baseUrl = argv[++index] ?? options.baseUrl;
    else if (arg === "--browser-path") options.browserPath = argv[++index] ?? options.browserPath;
    else if (arg === "--skip-api") options.skipApi = true;
    else if (arg === "--skip-browser") options.skipBrowser = true;
    else if (arg === "--include-recovery-write") options.includeRecoveryWrite = true;
    else if (arg === "--include-opaque-login-write") options.includeOpaqueLoginWrite = true;
    else if (arg === "--include-opaque-account-write") options.includeOpaqueAccountWrite = true;
    else if (arg === "--include-legacy-upgrade-write") options.includeLegacyUpgradeWrite = true;
    else if (arg === "--cleanup-stateful-accounts") options.cleanupStatefulAccounts = true;
    else if (arg === "--cleanup-env-file") options.cleanupEnvFile = argv[++index] ?? options.cleanupEnvFile;
    else if (arg === "--cleanup-owner-env-file") options.cleanupOwnerEnvFile = argv[++index] ?? options.cleanupOwnerEnvFile;
    else if (arg === "--cleanup-client-ip") options.cleanupClientIp = argv[++index] ?? options.cleanupClientIp;
    else if (arg === "--turso-url") options.tursoUrl = argv[++index] ?? options.tursoUrl;
    else if (arg === "--turso-token") options.tursoToken = argv[++index] ?? options.tursoToken;
    else if (arg === "--d1-bridge-url") options.d1BridgeUrl = argv[++index] ?? options.d1BridgeUrl;
    else if (arg === "--d1-bridge-token") options.d1BridgeToken = argv[++index] ?? options.d1BridgeToken;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl);
  return options;
}

function printHelp() {
  console.log(`Ciphora regression smoke

Usage:
  node scripts/regression-smoke.mjs [options]

Options:
  --base-url <url>            Target app URL. Default: ${DEFAULT_BASE_URL}
  --browser-path <path>       Chrome/Chromium executable path. Default: auto-detect or CHROME_PATH.
  --skip-api                  Skip API and provider checks.
  --skip-browser              Skip headless browser route checks.
  --include-recovery-write    Also call recovery reset start with a random .invalid email.
  --include-opaque-login-write Also create an ephemeral fake OPAQUE login challenge.
  --include-opaque-account-write Also create and log into a disposable OPAQUE account.
  --include-legacy-upgrade-write Also create a disposable legacy verifier account and upgrade it to OPAQUE.
  --cleanup-stateful-accounts Cleanup disposable .example.invalid accounts created by stateful write checks.
  --cleanup-env-file <path>   Cloudflare env file for cleanup. Default: .env.cloudflare.local
  --cleanup-owner-env-file <path> Owner secret env file for auth-secret-derived cleanup hashes.
  --cleanup-client-ip <ip>    Also cleanup rate-limit buckets for this client IP when cleanup runs.
  --turso-url <url>           Optional BYODB Turso URL for read-only provider ping.
  --turso-token <token>       Optional BYODB Turso token for read-only provider ping.
  --d1-bridge-url <url>       Optional D1 Bridge Worker URL for /health ping.
  --d1-bridge-token <token>   Optional D1 Bridge bearer token for /health ping.

Environment:
  CIPHORA_REGRESSION_BASE_URL, CHROME_PATH,
  CIPHORA_REGRESSION_TURSO_URL, CIPHORA_REGRESSION_TURSO_TOKEN,
  CIPHORA_REGRESSION_D1_BRIDGE_URL, CIPHORA_REGRESSION_D1_BRIDGE_TOKEN
`);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function routeUrl(baseUrl, routePath) {
  return new URL(routePath, `${baseUrl}/`).toString();
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON but received: ${text.slice(0, 160)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomBase64Url(byteLength) {
  const bytes = new Uint8Array(byteLength);
  webcrypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function loadOpaque() {
  const opaque = await import("@serenity-kit/opaque");
  await opaque.ready;
  return opaque;
}

function sessionCookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "session cookie missing");
  return setCookie.split(";")[0];
}

function createOpaqueSmokeWrapper(options = {}) {
  return {
    wrapperType: "password",
    kdfAlgorithm: OPAQUE_ROOT_WRAPPER_KDF,
    kdfParams: {
      version: "ciphora-account-opaque-root-wrap-v1",
      opaqueConfigId: options.configId ?? "opaque-rfc9807-serenity-v1",
      keyStretching: options.keyStretching ?? OPAQUE_KEY_STRETCHING,
      serverStaticPublicKey: options.serverStaticPublicKey ?? "regression-server-key-placeholder",
      hkdf: {
        salt: "ciphora-opaque-export-key-salt-v1",
        info: "ciphora-account-root-wrap-key-v1",
        hash: "SHA-256",
      },
      smoke: true,
    },
    algorithm: "AES-GCM-256",
    iv: randomBase64Url(12),
    ciphertext: randomBase64Url(96),
  };
}

async function deriveAccountMaterial(password, salt, iterations) {
  const passwordKey = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: Buffer.from(salt, "base64url"),
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    ACCOUNT_DERIVED_BYTES * 8,
  );
  const bytes = new Uint8Array(derivedBits);
  return {
    verifier: Buffer.from(bytes.slice(ACCOUNT_KEY_BYTES, ACCOUNT_DERIVED_BYTES)).toString("base64url"),
  };
}

function createLegacySmokeWrapper(salt) {
  return {
    wrapperType: "password",
    kdfAlgorithm: ACCOUNT_KDF_ALGORITHM,
    kdfParams: {
      version: "ciphora-account-root-wrap-v1",
      iterations: ACCOUNT_KDF_ITERATIONS,
      salt,
      smoke: true,
    },
    algorithm: "AES-GCM-256",
    iv: randomBase64Url(12),
    ciphertext: randomBase64Url(96),
  };
}

function createRecoverySmokeWrapper() {
  return {
    wrapperType: "recovery",
    kdfAlgorithm: "client-pbkdf2-sha256",
    kdfParams: {
      version: "ciphora-recovery-root-wrap-v1",
      iterations: 310000,
      salt: randomBase64Url(32),
      smoke: true,
    },
    algorithm: "AES-GCM-256",
    iv: randomBase64Url(12),
    ciphertext: randomBase64Url(96),
  };
}

function createResultCollector() {
  const results = [];

  return {
    results,
    async check(name, fn) {
      const startedAt = Date.now();
      try {
        const detail = await fn();
        results.push({ name, status: "pass", durationMs: Date.now() - startedAt, detail: detail ?? "" });
        console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ""}`);
      } catch (error) {
        results.push({
          name,
          status: "fail",
          durationMs: Date.now() - startedAt,
          detail: error instanceof Error ? error.message : String(error),
        });
        console.error(`[FAIL] ${name} - ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    skip(name, detail) {
      results.push({ name, status: "skip", durationMs: 0, detail });
      console.log(`[SKIP] ${name} - ${detail}`);
    },
  };
}

function registerStatefulCleanupTarget(options, target) {
  if (!target?.userId || !Number.isInteger(Number(target.shardId))) return;
  options.statefulCleanupTargets.push({
    userId: target.userId,
    shardId: Number(target.shardId),
    email: target.email ?? null,
  });
}

async function cleanupStatefulAccounts(options, collector) {
  if (!options.cleanupStatefulAccounts || options.statefulCleanupTargets.length === 0) return;

  const targets = dedupeCleanupTargets(options.statefulCleanupTargets);
  await collector.check("cleanup disposable stateful QA accounts", async () => {
    const executable = process.execPath;
    const cleanupArgs = [
      "scripts/cleanup-regression-accounts.mjs",
      "--env-file",
      options.cleanupEnvFile,
      "--owner-env-file",
      options.cleanupOwnerEnvFile,
      "--account-json",
      JSON.stringify(targets),
    ];
    if (options.cleanupClientIp) {
      cleanupArgs.push("--include-ip-rate-limits", "--client-ip", options.cleanupClientIp);
    }
    const result = spawnSync(executable, cleanupArgs, {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || "cleanup failed").slice(0, 1200));
    }

    return `cleaned ${targets.length} account${targets.length === 1 ? "" : "s"}`;
  });
}

function dedupeCleanupTargets(targets) {
  const seen = new Set();
  const unique = [];
  for (const target of targets) {
    const key = `${target.userId}:${target.shardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

async function runApiChecks(options, collector) {
  const origin = new URL(options.baseUrl).origin;

  const htmlRoutes = [
    "/",
    "/about",
    "/contact",
    "/terms",
    "/privacy",
    "/vault/unlock",
    "/vault/dashboard",
    "/vault/generator",
    "/vault/security/audit",
    "/vault/sync",
    "/vault/account",
    "/vault/security",
    "/vault/data",
    "/vault/preferences",
    "/vault/settings",
  ];

  for (const routePath of htmlRoutes) {
    await collector.check(`route ${routePath} returns SPA shell`, async () => {
      const response = await fetchWithTimeout(routeUrl(options.baseUrl, routePath));
      assert(response.status === 200, `expected 200, got ${response.status}`);
      const body = await response.text();
      assert(body.includes("<title>Ciphora</title>"), "SPA title missing");
      return "200 html";
    });
  }

  await collector.check("GET /api/health", async () => {
    const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/health"));
    assert(response.status === 200, `expected 200, got ${response.status}`);
    const body = await readJson(response);
    assert(body.ok === true, "health ok flag missing");
    assert(body.service === "ciphora-api", "unexpected service name");
    return `${body.status ?? "unknown"}; d1 shards ${body.components?.d1?.identityShardsConfigured ?? "?"}`;
  });

  await collector.check("GET /api/auth/session without cookie", async () => {
    const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/session"));
    assert([401, 404].includes(response.status), `expected 401/404, got ${response.status}`);
    return `rejected with ${response.status}`;
  });

  await collector.check("GET /api/recovery/status without cookie", async () => {
    const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/recovery/status"));
    assert([401, 404].includes(response.status), `expected 401/404, got ${response.status}`);
    return `rejected with ${response.status}`;
  });

  await collector.check("GET /api/account/devices without cookie", async () => {
    const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/devices"));
    assert([401, 404].includes(response.status), `expected 401/404, got ${response.status}`);
    return `rejected with ${response.status}`;
  });

  await collector.check("POST /api/auth/login/start fake account metadata", async () => {
    const email = `qa-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`;
    const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/login/start"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({ email }),
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    const body = await readJson(response);
    assert(body.ok === true, "ok flag missing");
    assert(typeof body.login?.kdf?.salt === "string", "fake login kdf missing");
    assert(typeof body.login?.challenge?.token === "string", "login challenge missing");
    return "fake metadata returned without account enumeration";
  });

  await runOpaqueApiChecks(options, collector, origin);

  if (options.includeRecoveryWrite) {
    await collector.check("POST /api/recovery/reset/start requires email reset token", async () => {
      const email = `recovery-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`;
      const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/recovery/reset/start"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({ email }),
      });
      assert([400, 401].includes(response.status), `expected 400/401, got ${response.status}`);
      return "reset challenge blocked until email reset token is supplied";
    });
  } else {
    collector.skip(
      "POST /api/recovery/reset/start requires email reset token",
      "stateful email-token gate check skipped; pass --include-recovery-write to run it",
    );
  }

  await runProviderChecks(options, collector);
}

async function runOpaqueApiChecks(options, collector, origin) {
  await collector.check("POST /api/auth/opaque/register/start protocol smoke", async () => {
    const opaque = await loadOpaque();
    const email = `opaque-register-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`;
    const registrationStart = opaque.client.startRegistration({ password: `CiphoraOpaque-${Date.now()}!` });
    const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/register/start"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({
        email,
        registrationRequest: registrationStart.registrationRequest,
      }),
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    const body = await readJson(response);
    assert(body.ok === true, "ok flag missing");
    assert(body.opaque?.configId === "opaque-rfc9807-serenity-v1", "unexpected OPAQUE config");
    assert(body.opaque?.keyStretching === OPAQUE_KEY_STRETCHING, "unexpected OPAQUE key stretching");
    assert(body.opaque?.rootWrapperKdf === OPAQUE_ROOT_WRAPPER_KDF, "unexpected root wrapper KDF");
    assert(typeof body.opaque?.registrationResponse === "string", "registration response missing");
    assert(typeof body.opaque?.serverStaticPublicKey === "string", "server static public key missing");
    return "registration start returned server OPAQUE material";
  });

  if (options.includeOpaqueLoginWrite) {
    await collector.check("POST /api/auth/opaque/login/start fake account challenge", async () => {
      const opaque = await loadOpaque();
      const password = `CiphoraOpaque-${Date.now()}!`;
      const email = `opaque-login-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`;
      const startLogin = opaque.client.startLogin({ password });
      const response = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/login/start"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
          startLoginRequest: startLogin.startLoginRequest,
        }),
      });
      assert(response.status === 200, `expected 200, got ${response.status}`);
      const body = await readJson(response);
      assert(body.ok === true, "ok flag missing");
      assert(typeof body.opaque?.challengeToken === "string", "challenge token missing");
      assert(typeof body.opaque?.loginResponse === "string", "login response missing");
      const loginFinish = opaque.client.finishLogin({
        clientLoginState: startLogin.clientLoginState,
        loginResponse: body.opaque.loginResponse,
        password,
        keyStretching: OPAQUE_KEY_STRETCHING,
      });
      if (!loginFinish || typeof loginFinish.finishLoginRequest !== "string") {
        return "stateful fake OPAQUE challenge created and rejected client-side";
      }

      const finishResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/login/finish"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
          challengeToken: body.opaque.challengeToken,
          finishLoginRequest: loginFinish.finishLoginRequest,
          device: {
            deviceId: randomBase64Url(24),
            deviceLabel: "Regression fake OPAQUE smoke",
          },
        }),
      });
      assert(finishResponse.status === 401, `fake OPAQUE finish expected 401, got ${finishResponse.status}`);
      return "stateful fake OPAQUE challenge created and rejected server-side";
    });
  } else {
    collector.skip(
      "POST /api/auth/opaque/login/start fake account challenge",
      "stateful challenge creation skipped; pass --include-opaque-login-write to run it",
    );
  }

  if (options.includeOpaqueAccountWrite) {
    await collector.check("OPAQUE disposable account signup and login", async () => {
      const opaque = await loadOpaque();
      const stamp = Date.now();
      const email = `opaque-account-${stamp}-${Math.random().toString(16).slice(2)}@example.invalid`;
      const password = `CiphoraOpaque-${stamp}!Aa1`;
      const deviceId = randomBase64Url(24);
      const device = {
        deviceId,
        deviceLabel: "Regression OPAQUE smoke",
      };

      const registrationStart = opaque.client.startRegistration({ password });
      const registerStartResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/register/start"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
          registrationRequest: registrationStart.registrationRequest,
        }),
      });
      assert(registerStartResponse.status === 200, `register/start expected 200, got ${registerStartResponse.status}`);
      const registerStart = await readJson(registerStartResponse);
      const registrationFinish = opaque.client.finishRegistration({
        clientRegistrationState: registrationStart.clientRegistrationState,
        registrationResponse: registerStart.opaque?.registrationResponse,
        password,
        keyStretching: OPAQUE_KEY_STRETCHING,
      });
      assert(registrationFinish.serverStaticPublicKey === registerStart.opaque?.serverStaticPublicKey, "server public key mismatch");

      const registerFinishResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/register/finish"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
          registrationRecord: registrationFinish.registrationRecord,
          rootKeyWrappers: [createOpaqueSmokeWrapper({
            configId: registerStart.opaque?.configId,
            keyStretching: registerStart.opaque?.keyStretching,
            serverStaticPublicKey: registerStart.opaque?.serverStaticPublicKey,
          })],
          device,
        }),
      });
      assert(registerFinishResponse.status === 201, `register/finish expected 201, got ${registerFinishResponse.status}`);
      const registered = await readJson(registerFinishResponse);
      assert(registered.ok === true, "registration ok flag missing");
      assert(registered.authMode === "opaque", "registration did not use OPAQUE");
      registerStatefulCleanupTarget(options, {
        userId: registered.user?.userId,
        shardId: registered.user?.shardId,
        email,
      });
      let sessionCookie = sessionCookieFrom(registerFinishResponse);

      await loginOpaqueDisposableAccount(options, origin, opaque, { email, password, device });

      const deviceStateResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/devices"), {
        headers: {
          cookie: sessionCookie,
        },
      });
      assert(deviceStateResponse.status === 200, `device/session state expected 200, got ${deviceStateResponse.status}`);
      const deviceState = await readJson(deviceStateResponse);
      assert(deviceState.ok === true, "device/session state ok flag missing");
      assert(typeof deviceState.currentSessionId === "string", "current session id missing");
      assert(typeof deviceState.currentDeviceId === "string", "current device id missing");
      assert(Array.isArray(deviceState.devices) && deviceState.devices.length >= 1, "device list missing");
      assert(Array.isArray(deviceState.sessions) && deviceState.sessions.length >= 1, "session list missing");
      assert(Array.isArray(deviceState.auditEvents), "audit event list missing");

      const trustResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/devices"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          action: "set_device_trust",
          deviceId: deviceState.currentDeviceId,
          trusted: true,
        }),
      });
      assert(trustResponse.status === 200, `device trust expected 200, got ${trustResponse.status}`);
      const trusted = await readJson(trustResponse);
      assert(trusted.ok === true && trusted.trusted === true, "device trust response invalid");

      const revokeOthersResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/devices"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          action: "revoke_sessions",
          includeCurrent: false,
        }),
      });
      assert(revokeOthersResponse.status === 200, `revoke other sessions expected 200, got ${revokeOthersResponse.status}`);
      const revokedOthers = await readJson(revokeOthersResponse);
      assert(revokedOthers.ok === true && revokedOthers.currentSessionRevoked === false, "revoke other sessions response invalid");

      const changedPassword = `CiphoraOpaqueChanged-${stamp}!Bb2`;
      const currentLoginStart = opaque.client.startLogin({ password });
      const nextRegistrationStart = opaque.client.startRegistration({ password: changedPassword });
      const changeStartResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/password/opaque/start"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          startLoginRequest: currentLoginStart.startLoginRequest,
          registrationRequest: nextRegistrationStart.registrationRequest,
        }),
      });
      assert(changeStartResponse.status === 200, `password opaque/start expected 200, got ${changeStartResponse.status}`);
      const changeStart = await readJson(changeStartResponse);
      const currentLoginFinish = opaque.client.finishLogin({
        clientLoginState: currentLoginStart.clientLoginState,
        loginResponse: changeStart.opaque?.loginResponse,
        password,
        keyStretching: OPAQUE_KEY_STRETCHING,
      });
      assert(currentLoginFinish !== null, "current password OPAQUE finish returned null");
      const nextRegistrationFinish = opaque.client.finishRegistration({
        clientRegistrationState: nextRegistrationStart.clientRegistrationState,
        registrationResponse: changeStart.opaque?.registrationResponse,
        password: changedPassword,
        keyStretching: OPAQUE_KEY_STRETCHING,
      });
      assert(nextRegistrationFinish.serverStaticPublicKey === changeStart.opaque?.serverStaticPublicKey, "password-change server key mismatch");
      assert(
        nextRegistrationFinish.registrationRecord !== registrationFinish.registrationRecord,
        "password-change registration record did not rotate client-side",
      );

      const changeFinishResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/password/opaque/finish"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          challengeToken: changeStart.opaque?.challengeToken,
          finishLoginRequest: currentLoginFinish.finishLoginRequest,
          registrationRecord: nextRegistrationFinish.registrationRecord,
          rootKeyWrappers: [createOpaqueSmokeWrapper({
            configId: changeStart.opaque?.configId,
            keyStretching: changeStart.opaque?.keyStretching,
            serverStaticPublicKey: changeStart.opaque?.serverStaticPublicKey,
          })],
        }),
      });
      assert(changeFinishResponse.status === 200, `password opaque/finish expected 200, got ${changeFinishResponse.status}`);
      const changeFinish = await readJson(changeFinishResponse);
      assert(changeFinish.credentialEpochUpdated === true, "password change did not report credential epoch update");
      assert(changeFinish.credentialFingerprintChanged === true, "password change did not report credential fingerprint rotation");
      assert(changeFinish.credentialRevocationRecorded === true, "password change did not report previous credential revocation");
      await assertOpaqueLoginRejected(options, origin, opaque, { email, password, device });
      const changedLogin = await loginOpaqueDisposableAccount(options, origin, opaque, { email, password: changedPassword, device });
      sessionCookie = changedLogin.cookie;

      const recoveryVerifier = randomBase64Url(48);
      const recoverySetupResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/recovery/setup"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          rootKeyWrapper: createRecoverySmokeWrapper(),
          recoveryKeyHint: "QA",
          recoveryVerifier,
          recoveryVerifierVersion: "v1",
          recoveryVerifierAlgorithm: "client-pbkdf2-sha256-verifier",
        }),
      });
      assert(recoverySetupResponse.status === 200, `recovery setup expected 200, got ${recoverySetupResponse.status}`);

      const resetEmailRequest = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/recovery/email-reset/request"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
        }),
      });
      assert(resetEmailRequest.status === 200, `recovery email-reset/request expected 200, got ${resetEmailRequest.status}`);

      const gatedResetStartResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/recovery/reset/start"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
        }),
      });
      assert([400, 401].includes(gatedResetStartResponse.status), `recovery reset/start without email token expected 400/401, got ${gatedResetStartResponse.status}`);
      await assertOpaqueLoginRejected(options, origin, opaque, { email, password, device });
      await loginOpaqueDisposableAccount(options, origin, opaque, { email, password: changedPassword, device });

      return `created OPAQUE QA account ${registered.user?.userId ?? "unknown"} on shard ${registered.user?.shardId ?? "?"}; password change and email-reset gate passed; cleanup required`;
    });
  } else {
    collector.skip(
      "OPAQUE disposable account signup and login",
      "stateful account creation skipped; pass --include-opaque-account-write to run it",
    );
  }

  if (options.includeLegacyUpgradeWrite) {
    await collector.check("Legacy verifier account upgrades to OPAQUE on password change", async () => {
      const opaque = await loadOpaque();
      const stamp = Date.now();
      const email = `legacy-upgrade-${stamp}-${Math.random().toString(16).slice(2)}@example.invalid`;
      const password = `CiphoraLegacy-${stamp}!Aa1`;
      const upgradedPassword = `CiphoraLegacyOpaque-${stamp}!Bb2`;
      const salt = randomBase64Url(ACCOUNT_SALT_BYTES);
      const currentMaterial = await deriveAccountMaterial(password, salt, ACCOUNT_KDF_ITERATIONS);
      const device = {
        deviceId: randomBase64Url(24),
        deviceLabel: "Regression legacy upgrade smoke",
      };

      const signupResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/signup"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          email,
          verifier: currentMaterial.verifier,
          verifierVersion: "v2",
          verifierAlgorithm: ACCOUNT_VERIFIER_ALGORITHM,
          kdf: {
            algorithm: ACCOUNT_KDF_ALGORITHM,
            iterations: ACCOUNT_KDF_ITERATIONS,
            salt,
          },
          rootKeyWrappers: [createLegacySmokeWrapper(salt)],
          device,
        }),
      });
      assert(signupResponse.status === 201, `legacy signup expected 201, got ${signupResponse.status}`);
      const signedUp = await readJson(signupResponse);
      assert(signedUp.ok === true, "legacy signup ok flag missing");
      registerStatefulCleanupTarget(options, {
        userId: signedUp.user?.userId,
        shardId: signedUp.user?.shardId,
        email,
      });
      const sessionCookie = sessionCookieFrom(signupResponse);

      const registrationStart = opaque.client.startRegistration({ password: upgradedPassword });
      const upgradeStartResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/password/opaque/upgrade/start"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          registrationRequest: registrationStart.registrationRequest,
        }),
      });
      assert(upgradeStartResponse.status === 200, `opaque upgrade/start expected 200, got ${upgradeStartResponse.status}`);
      const upgradeStart = await readJson(upgradeStartResponse);
      assert(upgradeStart.authMode === "legacy_upgrade_to_opaque", "upgrade start did not identify legacy OPAQUE upgrade");
      const registrationFinish = opaque.client.finishRegistration({
        clientRegistrationState: registrationStart.clientRegistrationState,
        registrationResponse: upgradeStart.opaque?.registrationResponse,
        password: upgradedPassword,
        keyStretching: OPAQUE_KEY_STRETCHING,
      });
      assert(registrationFinish.serverStaticPublicKey === upgradeStart.opaque?.serverStaticPublicKey, "legacy upgrade server key mismatch");

      const upgradeFinishResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/account/password/opaque/upgrade/finish"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: sessionCookie,
        },
        body: JSON.stringify({
          currentVerifier: currentMaterial.verifier,
          registrationRecord: registrationFinish.registrationRecord,
          rootKeyWrappers: [createOpaqueSmokeWrapper({
            configId: upgradeStart.opaque?.configId,
            keyStretching: upgradeStart.opaque?.keyStretching,
            serverStaticPublicKey: upgradeStart.opaque?.serverStaticPublicKey,
          })],
        }),
      });
      assert(upgradeFinishResponse.status === 200, `opaque upgrade/finish expected 200, got ${upgradeFinishResponse.status}`);
      const upgraded = await readJson(upgradeFinishResponse);
      assert(upgraded.authMode === "opaque", "legacy upgrade did not finish as OPAQUE");

      await assertOpaqueLoginRejected(options, origin, opaque, { email, password, device });
      await loginOpaqueDisposableAccount(options, origin, opaque, { email, password: upgradedPassword, device });

      return `created legacy QA account ${signedUp.user?.userId ?? "unknown"} on shard ${signedUp.user?.shardId ?? "?"}; upgraded to OPAQUE; cleanup required`;
    });
  } else {
    collector.skip(
      "Legacy verifier account upgrades to OPAQUE on password change",
      "stateful legacy upgrade skipped; pass --include-legacy-upgrade-write to run it",
    );
  }
}

async function loginOpaqueDisposableAccount(options, origin, opaque, input) {
  const startLogin = opaque.client.startLogin({ password: input.password });
  const loginStartResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/login/start"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email: input.email,
      startLoginRequest: startLogin.startLoginRequest,
    }),
  });
  assert(loginStartResponse.status === 200, `login/start expected 200, got ${loginStartResponse.status}`);
  const loginStart = await readJson(loginStartResponse);
  const loginFinish = opaque.client.finishLogin({
    clientLoginState: startLogin.clientLoginState,
    loginResponse: loginStart.opaque?.loginResponse,
    password: input.password,
    keyStretching: OPAQUE_KEY_STRETCHING,
  });
  assert(loginFinish !== null, "OPAQUE login finish returned null");
  assert(loginFinish.serverStaticPublicKey === loginStart.opaque?.serverStaticPublicKey, "login server public key mismatch");

  const loginFinishResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/login/finish"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email: input.email,
      challengeToken: loginStart.opaque?.challengeToken,
      finishLoginRequest: loginFinish.finishLoginRequest,
      device: input.device,
    }),
  });
  assert(loginFinishResponse.status === 200, `login/finish expected 200, got ${loginFinishResponse.status}`);
  const loggedIn = await readJson(loginFinishResponse);
  assert(loggedIn.ok === true, "login ok flag missing");
  assert(loggedIn.authMode === "opaque", "login did not use OPAQUE");
  assert(Array.isArray(loggedIn.rootKeyWrappers) && loggedIn.rootKeyWrappers.length >= 1, "root key wrapper missing");

  return {
    body: loggedIn,
    cookie: sessionCookieFrom(loginFinishResponse),
  };
}

async function assertOpaqueLoginRejected(options, origin, opaque, input) {
  const startLogin = opaque.client.startLogin({ password: input.password });
  const loginStartResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/login/start"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email: input.email,
      startLoginRequest: startLogin.startLoginRequest,
    }),
  });
  assert(loginStartResponse.status === 200, `old login/start expected 200, got ${loginStartResponse.status}`);
  const loginStart = await readJson(loginStartResponse);
  const loginFinish = opaque.client.finishLogin({
    clientLoginState: startLogin.clientLoginState,
    loginResponse: loginStart.opaque?.loginResponse,
    password: input.password,
    keyStretching: OPAQUE_KEY_STRETCHING,
  });
  if (!loginFinish) return;

  const loginFinishResponse = await fetchWithTimeout(routeUrl(options.baseUrl, "/api/auth/opaque/login/finish"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email: input.email,
      challengeToken: loginStart.opaque?.challengeToken,
      finishLoginRequest: loginFinish.finishLoginRequest,
      device: input.device,
    }),
  });
  assert(loginFinishResponse.status === 401, `old password login expected 401, got ${loginFinishResponse.status}`);
}

async function runProviderChecks(options, collector) {
  if (options.tursoUrl && options.tursoToken) {
    await collector.check("Turso BYODB read-only ping", async () => {
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url: options.tursoUrl, authToken: options.tursoToken });
      try {
        const result = await client.execute("SELECT 1 AS ok");
        assert(Number(result.rows?.[0]?.ok ?? 0) === 1, "SELECT 1 did not return ok=1");
        return "SELECT 1 ok";
      } finally {
        client.close?.();
      }
    });
  } else {
    collector.skip("Turso BYODB read-only ping", "set CIPHORA_REGRESSION_TURSO_URL and CIPHORA_REGRESSION_TURSO_TOKEN");
  }

  if (options.d1BridgeUrl && options.d1BridgeToken) {
    await collector.check("D1 Bridge /health ping", async () => {
      const response = await fetchWithTimeout(routeUrl(normalizeBaseUrl(options.d1BridgeUrl), "/health"), {
        headers: {
          authorization: `Bearer ${options.d1BridgeToken}`,
        },
      });
      assert(response.status === 200, `expected 200, got ${response.status}`);
      const body = await readJson(response);
      assert(body.ok === true, "health ok flag missing");
      return "bridge healthy";
    });
  } else {
    collector.skip("D1 Bridge /health ping", "set CIPHORA_REGRESSION_D1_BRIDGE_URL and CIPHORA_REGRESSION_D1_BRIDGE_TOKEN");
  }
}

function detectChromePath(explicitPath) {
  const candidates = [
    explicitPath,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

async function waitForDevtoolsPort(userDataDir) {
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  const startedAt = Date.now();

  while (Date.now() - startedAt < BROWSER_TIMEOUT_MS) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, "utf8").trim().split(/\r?\n/);
      if (port) return Number(port);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Chrome did not expose DevToolsActivePort");
}

async function getCdpTarget(port) {
  const listResponse = await fetchWithTimeout(`http://127.0.0.1:${port}/json/list`);
  const targets = await listResponse.json();
  const target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
  if (!target) throw new Error("No Chrome page target found");
  return target.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.browserErrors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.url);
      const timeoutId = setTimeout(() => reject(new Error("CDP websocket connect timed out")), 10_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeoutId);
        resolve();
      });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeoutId);
        reject(new Error("CDP websocket failed to connect"));
      });
      this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
      this.socket.addEventListener("close", () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error("CDP websocket closed"));
        }
        this.pending.clear();
      });
    });
  }

  handleMessage(rawData) {
    const payload = typeof rawData === "string"
      ? rawData
      : rawData instanceof ArrayBuffer
        ? Buffer.from(rawData).toString("utf8")
        : ArrayBuffer.isView(rawData)
          ? Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString("utf8")
          : String(rawData);
    const message = JSON.parse(payload);

    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeoutId);
      if (message.error) pending.reject(new Error(message.error.message ?? "CDP command failed"));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      this.browserErrors.push(details?.exception?.description ?? details?.text ?? "runtime exception");
    }

    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry;
      if (entry?.level === "error") {
        this.browserErrors.push(entry.text ?? "browser log error");
      }
    }

    const listeners = this.events.get(message.method);
    if (listeners) {
      for (const listener of listeners) listener(message.params);
    }
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const command = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, BROWSER_COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeoutId });
      this.socket.send(command);
    });
  }

  clearErrors() {
    this.browserErrors = [];
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  close() {
    this.socket?.close();
  }
}

async function waitForExpression(client, expression, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const browserErrors = client.browserErrors?.filter((message) => /ReferenceError|TypeError|SyntaxError|Failed to load module|error/i.test(String(message))).slice(-5) ?? [];
  throw new Error(`${label} timed out${lastError ? `; last error: ${lastError}` : ""}${browserErrors.length ? `; browser errors: ${browserErrors.join(" | ").slice(0, 700)}` : ""}`);
}

async function navigateAndAssert(client, options) {
  const {
    baseUrl,
    pathName,
    theme,
    language = "id",
    viewport,
    expectedPath,
    expectedText,
    expectUnlockedShell = false,
    maxHorizontalOverflow = 6,
  } = options;

  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });

  await client.send("Page.navigate", { url: routeUrl(baseUrl, "/") });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, "initial route load");
  await client.evaluate(`localStorage.setItem('ciphora_theme', ${JSON.stringify(theme)})`);
  await client.evaluate(`localStorage.setItem('ciphora_language', ${JSON.stringify(language)})`);

  client.clearErrors();
  await client.send("Page.navigate", { url: routeUrl(baseUrl, pathName) });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, `route load ${pathName}`);
  await waitForExpression(client, "document.getElementById('app')?.children.length > 0", BROWSER_TIMEOUT_MS, `app render ${pathName}`);
  await waitForExpression(
    client,
    theme === "light"
      ? "document.documentElement.classList.contains('light')"
      : "!document.documentElement.classList.contains('light')",
    BROWSER_TIMEOUT_MS,
    `theme class ${theme}`,
  );
  await waitForExpression(
    client,
    `document.documentElement.lang === ${JSON.stringify(language === "en" ? "en" : "id")}`,
    BROWSER_TIMEOUT_MS,
    `language ${language}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));

  const state = await client.evaluate(`(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      title: document.title,
      path: window.location.pathname,
      appChildren: document.getElementById("app")?.children.length ?? 0,
      htmlClass: root.className,
      bodyText: body.innerText.slice(0, 1000),
      viewportWidth: window.innerWidth,
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      hasDesktopSidebar: Boolean(document.querySelector("aside")),
      hasMobileBottomNav: Boolean(document.querySelector('[aria-label="Mobile vault navigation"]')),
    };
  })()`);

  assert(state.title === "Ciphora", `expected title Ciphora, got ${state.title}`);
  assert(state.appChildren > 0, "app root is empty");
  if (theme === "light") {
    assert(state.htmlClass.includes("light"), "expected html class to include light");
  } else {
    assert(!state.htmlClass.includes("light"), "expected dark default without light class");
  }
  if (expectedPath) assert(state.path === expectedPath, `expected path ${expectedPath}, got ${state.path}`);
  if (expectUnlockedShell) assert(state.bodyText.toLowerCase().includes("vault"), "expected unlocked vault shell text");
  if (expectedText) assert(state.bodyText.includes(expectedText), `expected page text ${expectedText}`);
  assert(
    state.scrollWidth <= state.viewportWidth + maxHorizontalOverflow,
    `horizontal overflow ${state.scrollWidth}px > viewport ${state.viewportWidth}px`,
  );

  const relevantErrors = client.browserErrors.filter((message) => {
    const text = String(message);
    return /ReferenceError|TypeError|SyntaxError|Cannot access .* before initialization|Failed to load module/i.test(text);
  });
  assert(relevantErrors.length === 0, `browser runtime errors: ${relevantErrors.join(" | ").slice(0, 500)}`);

  return `${state.path}; ${theme}; ${language}; ${viewport.width}x${viewport.height}; scroll ${state.scrollWidth}/${state.viewportWidth}`;
}

async function assertOpaqueBrowserModule(client, baseUrl) {
  client.clearErrors();
  await client.send("Page.navigate", { url: routeUrl(baseUrl, "/") });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, "OPAQUE module route load");
  await waitForExpression(client, "document.querySelector('script[type=\"module\"][src]') !== null", BROWSER_TIMEOUT_MS, "main module script");

  const result = await client.evaluate(`(async () => {
    const mainScript = document.querySelector('script[type="module"][src]')?.src;
    if (!mainScript) return { ok: false, error: "main module script missing" };
    const seen = new Set();
    const queue = [
      mainScript,
      ...Array.from(document.querySelectorAll('link[rel="modulepreload"][href]')).map((link) => link.href),
    ];
    const candidates = new Set();
    while (queue.length > 0) {
      const scriptUrl = queue.shift();
      if (!scriptUrl || seen.has(scriptUrl)) continue;
      seen.add(scriptUrl);
      const source = await fetch(scriptUrl, { cache: "no-store" }).then((response) => response.text());
      candidates.add(scriptUrl);
      for (const match of source.matchAll(/import\\("\\.\\/([^"]+\\.js)"\\)/g)) {
        const nextUrl = new URL(match[1], scriptUrl).toString();
        if (!seen.has(nextUrl)) queue.push(nextUrl);
      }
    }
    for (const chunkUrl of candidates) {
      const chunkSource = await fetch(chunkUrl, { cache: "no-store" }).then((response) => response.text());
      if (!chunkSource.includes("startClientRegistration") || !chunkSource.includes("startServerLogin")) {
        continue;
      }
      const opaque = await import(chunkUrl);
      await opaque.ready;
      const registration = opaque.client.startRegistration({ password: "CiphoraBrowserOpaque-Regression-1!" });
      return {
        ok: true,
        chunk: new URL(chunkUrl).pathname.split("/").pop(),
        registrationRequestLength: String(registration.registrationRequest || "").length,
      };
    }
    return { ok: false, error: "OPAQUE dynamic chunk not found" };
  })()`);

  assert(result?.ok === true, result?.error ?? "OPAQUE browser module did not load");
  assert(result.registrationRequestLength >= 16, "OPAQUE browser registration request missing");

  const relevantErrors = client.browserErrors.filter((message) => {
    const text = String(message);
    return /Content Security Policy|WebAssembly|wasm|ReferenceError|TypeError|SyntaxError|Failed to load module/i.test(text);
  });
  assert(relevantErrors.length === 0, `browser OPAQUE runtime errors: ${relevantErrors.join(" | ").slice(0, 500)}`);

  return `${result.chunk}; registration request ${result.registrationRequestLength} chars`;
}

async function setupDisposableVault(client, baseUrl) {
  const password = `CiphoraQa-${Date.now()}!`;
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  client.clearErrors();
  await client.send("Page.navigate", { url: routeUrl(baseUrl, "/vault/unlock") });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, "unlock route load");
  await waitForExpression(client, "document.querySelector('#master-password') !== null", BROWSER_TIMEOUT_MS, "setup password field");

  const escapedPassword = JSON.stringify(password);
  await client.evaluate(`(() => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      if (!input) throw new Error("missing input " + selector);
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      input.focus();
      valueSetter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setValue("#master-password", ${escapedPassword});
    setValue("#confirm-master-password", ${escapedPassword});
    document.querySelector("form").requestSubmit();
    return true;
  })()`);

  await waitForExpression(client, "window.location.pathname === '/vault/dashboard'", BROWSER_TIMEOUT_MS, "vault setup redirect");
  const errors = client.browserErrors.filter((message) => /ReferenceError|TypeError|SyntaxError/i.test(String(message)));
  assert(errors.length === 0, `setup produced runtime errors: ${errors.join(" | ").slice(0, 500)}`);
  return "disposable local vault created";
}

async function assertExpandedVaultItemTypes(client, baseUrl) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1366,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  client.clearErrors();
  await client.send("Page.navigate", { url: routeUrl(baseUrl, "/vault/items") });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, "item library route load");
  await waitForExpression(client, "document.body.innerText.includes('Vault Library')", BROWSER_TIMEOUT_MS, "item library render");

  const createItem = async ({ typeLabel, fields, expectedTitle }) => {
    await client.evaluate(`(() => {
      const addButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Add Item");
      if (!addButton) throw new Error("Add Item button missing");
      addButton.click();
    })()`);
    await waitForExpression(client, "document.body.innerText.includes('Add New Item')", BROWSER_TIMEOUT_MS, "add item modal");

    await client.evaluate(`(() => {
      const typeButtons = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === ${JSON.stringify(typeLabel)});
      const typeButton = typeButtons[typeButtons.length - 1];
      if (!typeButton) throw new Error("item type button missing: " + ${JSON.stringify(typeLabel)});
      typeButton.click();
    })()`);

    for (const [placeholder, value] of Object.entries(fields)) {
      await waitForExpression(
        client,
        `Array.from(document.querySelectorAll("input, textarea")).some((field) => field.getAttribute("placeholder") === ${JSON.stringify(placeholder)})`,
        BROWSER_TIMEOUT_MS,
        `field ${placeholder}`,
      );
      await client.evaluate(`(() => {
        const placeholder = ${JSON.stringify(placeholder)};
        const value = ${JSON.stringify(value)};
        const input = Array.from(document.querySelectorAll("input, textarea")).find((field) => field.getAttribute("placeholder") === placeholder);
        if (!input) throw new Error("field missing: " + placeholder);
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const valueSetter = Object.getOwnPropertyDescriptor(proto, "value").set;
        input.focus();
        valueSetter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
    }

    await client.evaluate(`(() => {
      const saveButtons = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "Add Item");
      const saveButton = saveButtons[saveButtons.length - 1];
      if (!saveButton) throw new Error("modal Add Item button missing");
      saveButton.click();
    })()`);
    await waitForExpression(
      client,
      `document.body.innerText.includes(${JSON.stringify(expectedTitle)}) && !document.body.innerText.includes('Add New Item')`,
      BROWSER_TIMEOUT_MS,
      `saved item ${expectedTitle}`,
    );
  };

  await createItem({
    typeLabel: "SSH",
    fields: {
      "e.g. Production Deploy Key": "Regression SSH Key",
      "server.example.com": "regression.example.invalid",
      "-----BEGIN OPENSSH PRIVATE KEY-----": "-----BEGIN OPENSSH PRIVATE KEY-----\\nfake-regression-key\\n-----END OPENSSH PRIVATE KEY-----",
    },
    expectedTitle: "Regression SSH Key",
  });

  await createItem({
    typeLabel: "Identity",
    fields: {
      "e.g. Personal ID, Work Profile": "Regression Identity",
      "Full legal name": "Regression User",
    },
    expectedTitle: "Regression Identity",
  });

  await createItem({
    typeLabel: "API",
    fields: {
      "e.g. Cloudflare deploy token": "Regression API Key",
      "Paste token or access key": "regression-token-value",
    },
    expectedTitle: "Regression API Key",
  });

  await createItem({
    typeLabel: "Wi-Fi",
    fields: {
      "Network name": "Regression-WiFi",
      "Wi-Fi password": "Regression-WiFi-Pass-123!",
    },
    expectedTitle: "Regression-WiFi",
  });

  await createItem({
    typeLabel: "Recovery",
    fields: {
      "e.g. GitHub recovery codes": "Regression Recovery Codes",
      "One code per line": "RECOVERY-1111\\nRECOVERY-2222",
      "When these were generated, remaining count, usage rules...": "Generated 2024-01-01; rotate after test.",
    },
    expectedTitle: "Regression Recovery Codes",
  });

  await createItem({
    typeLabel: "Software",
    fields: {
      "e.g. JetBrains IDE": "Regression License",
      "XXXX-XXXX-XXXX-XXXX": "REG-LIC-1234-5678",
      "YYYY-MM-DD / lifetime": "2024-01-01",
    },
    expectedTitle: "Regression License",
  });

  await createItem({
    typeLabel: "Database",
    fields: {
      "e.g. Production Postgres": "Regression Database",
      "db.example.com": "db-regression.example.invalid",
      "db_user": "root",
      "Database password": "regression-db-password",
    },
    expectedTitle: "Regression Database",
  });

  const libraryState = await client.evaluate(`(() => {
    const text = document.body.innerText;
    const normalizedText = text.toLowerCase();
    return {
      hasSshSection: normalizedText.includes("ssh keys"),
      hasIdentitySection: normalizedText.includes("identities"),
      hasApiSection: normalizedText.includes("api keys"),
      hasWifiSection: normalizedText.includes("wi-fi networks"),
      hasRecoverySection: normalizedText.includes("recovery codes"),
      hasLicenseSection: normalizedText.includes("software licenses"),
      hasDatabaseSection: normalizedText.includes("database credentials"),
      hasSshItem: text.includes("Regression SSH Key"),
      hasIdentityItem: text.includes("Regression Identity"),
      hasApiItem: text.includes("Regression API Key"),
      hasWifiItem: text.includes("Regression-WiFi"),
      hasRecoveryItem: text.includes("Regression Recovery Codes"),
      hasLicenseItem: text.includes("Regression License"),
      hasDatabaseItem: text.includes("Regression Database"),
      textSample: text.replace(/\\s+/g, " ").slice(0, 1000),
    };
  })()`);

  assert(libraryState.hasSshSection && libraryState.hasSshItem, `SSH item did not render in library: ${libraryState.textSample}`);
  assert(libraryState.hasIdentitySection && libraryState.hasIdentityItem, `Identity item did not render in library: ${libraryState.textSample}`);
  assert(libraryState.hasApiSection && libraryState.hasApiItem, `API key item did not render in library: ${libraryState.textSample}`);
  assert(libraryState.hasWifiSection && libraryState.hasWifiItem, `Wi-Fi item did not render in library: ${libraryState.textSample}`);
  assert(libraryState.hasRecoverySection && libraryState.hasRecoveryItem, `Recovery Codes item did not render in library: ${libraryState.textSample}`);
  assert(libraryState.hasLicenseSection && libraryState.hasLicenseItem, `Software License item did not render in library: ${libraryState.textSample}`);
  assert(libraryState.hasDatabaseSection && libraryState.hasDatabaseItem, `Database Credential item did not render in library: ${libraryState.textSample}`);

  await client.send("Page.navigate", { url: routeUrl(baseUrl, "/vault/generator") });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, "generator route load after new item types");
  await waitForExpression(client, "document.body.innerText.includes('Regression SSH Key')", BROWSER_TIMEOUT_MS, "generator sees expanded item types");
  const generatorState = await client.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasSsh: text.includes("SSH Key"),
      hasIdentity: text.includes("Identity"),
      hasApi: text.includes("API Key"),
      hasWifi: text.includes("Wi-Fi"),
      hasRecovery: text.includes("Recovery Codes"),
      hasLicense: text.includes("Software License"),
      hasDatabase: text.includes("Database Credential"),
    };
  })()`);
  assert(generatorState.hasSsh && generatorState.hasIdentity && generatorState.hasApi && generatorState.hasWifi && generatorState.hasRecovery && generatorState.hasLicense && generatorState.hasDatabase, "generator detail/list missing expanded type labels");

  await client.send("Page.navigate", { url: routeUrl(baseUrl, "/vault/security/audit") });
  await waitForExpression(client, "document.readyState === 'complete'", BROWSER_TIMEOUT_MS, "security audit route load after new item types");
  await waitForExpression(client, "document.body.innerText.toLowerCase().includes('overall health')", BROWSER_TIMEOUT_MS, "security audit render");
  const auditState = await client.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasRecoverySection: text.includes("Stale Recovery Codes"),
      hasRecoveryItem: text.includes("Regression Recovery Codes"),
      hasLicenseSection: text.includes("Software License Issues"),
      hasLicenseItem: text.includes("Regression License"),
      hasDatabaseSection: text.includes("Database Privilege Review"),
      hasDatabaseItem: text.includes("Regression Database"),
      hasPrivilegedBadge: text.includes("PRIVILEGED"),
      textSample: text.replace(/\\s+/g, " ").slice(0, 1000),
    };
  })()`);
  assert(auditState.hasRecoverySection && auditState.hasRecoveryItem, `stale Recovery Codes audit did not render: ${auditState.textSample}`);
  assert(auditState.hasLicenseSection && auditState.hasLicenseItem, `expired Software License audit did not render: ${auditState.textSample}`);
  assert(auditState.hasDatabaseSection && auditState.hasDatabaseItem && auditState.hasPrivilegedBadge, `privileged Database Credential audit did not render: ${auditState.textSample}`);

  const errors = client.browserErrors.filter((message) => /ReferenceError|TypeError|SyntaxError/i.test(String(message)));
  assert(errors.length === 0, `expanded item type flow produced runtime errors: ${errors.join(" | ").slice(0, 500)}`);

  return "created SSH, Identity, API Key, Wi-Fi, Recovery Codes, Software License, and Database Credential items in disposable browser vault";
}

async function runBrowserChecks(options, collector) {
  const chromePath = detectChromePath(options.browserPath);
  if (!chromePath) {
    collector.skip("headless Chrome browser regression", "Chrome/Chromium executable not found; set CHROME_PATH or --browser-path");
    return;
  }

  let chrome;
  let client;
  const userDataDir = mkdtempSync(path.join(tmpdir(), "ciphora-regression-"));

  try {
    chrome = spawn(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    const port = await waitForDevtoolsPort(userDataDir);
    const wsUrl = await getCdpTarget(port);
    client = new CdpClient(wsUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Log.enable");

    await collector.check("browser desktop landing dark", () => navigateAndAssert(client, {
      baseUrl: options.baseUrl,
      pathName: "/",
      theme: "dark",
      expectedPath: "/",
      viewport: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
    }));

    for (const publicRoute of [
      { pathName: "/about", expectedText: "Tentang Ciphora" },
      { pathName: "/contact", expectedText: "Kontak Ciphora" },
      { pathName: "/terms", expectedText: "Syarat & Ketentuan Ciphora" },
      { pathName: "/privacy", expectedText: "Kebijakan Privasi Ciphora" },
    ]) {
      await collector.check(`browser desktop public ${publicRoute.pathName} light`, () => navigateAndAssert(client, {
        baseUrl: options.baseUrl,
        pathName: publicRoute.pathName,
        theme: "light",
        expectedPath: publicRoute.pathName,
        expectedText: publicRoute.expectedText,
        viewport: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
      }));
    }

    await collector.check("browser OPAQUE client module loads", () => assertOpaqueBrowserModule(client, options.baseUrl));

    await collector.check("browser desktop unlock light", () => navigateAndAssert(client, {
      baseUrl: options.baseUrl,
      pathName: "/vault/unlock",
      theme: "light",
      expectedPath: "/vault/unlock",
      viewport: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
    }));

    await collector.check("browser create disposable local vault", () => setupDisposableVault(client, options.baseUrl));

    await collector.check("browser expanded vault item types", () => assertExpandedVaultItemTypes(client, options.baseUrl));

    await collector.check("browser mobile generator dark unlocked", () => navigateAndAssert(client, {
      baseUrl: options.baseUrl,
      pathName: "/vault/generator",
      theme: "dark",
      expectedPath: "/vault/generator",
      expectUnlockedShell: true,
      viewport: { width: 430, height: 932, deviceScaleFactor: 3, mobile: true },
      maxHorizontalOverflow: 12,
    }));

    await collector.check("browser mobile settings light unlocked", () => navigateAndAssert(client, {
      baseUrl: options.baseUrl,
      pathName: "/vault/settings",
      theme: "light",
      expectedPath: "/vault/settings",
      expectUnlockedShell: true,
      viewport: { width: 430, height: 932, deviceScaleFactor: 3, mobile: true },
      maxHorizontalOverflow: 12,
    }));

    await collector.check("browser desktop sync light unlocked", () => navigateAndAssert(client, {
      baseUrl: options.baseUrl,
      pathName: "/vault/sync",
      theme: "light",
      expectedPath: "/vault/sync",
      expectUnlockedShell: true,
      viewport: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
    }));

    for (const settingsRoute of ["/vault/account", "/vault/security", "/vault/data", "/vault/preferences"]) {
      const englishPreferences = settingsRoute === "/vault/preferences";
      await collector.check(`browser desktop ${settingsRoute} light unlocked`, () => navigateAndAssert(client, {
        baseUrl: options.baseUrl,
        pathName: settingsRoute,
        theme: "light",
        language: englishPreferences ? "en" : "id",
        expectedText: englishPreferences ? "Language" : undefined,
        expectedPath: settingsRoute,
        expectUnlockedShell: true,
        viewport: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
      }));
    }

    await collector.check("browser desktop dashboard light unlocked", () => navigateAndAssert(client, {
      baseUrl: options.baseUrl,
      pathName: "/vault/dashboard",
      theme: "light",
      expectedPath: "/vault/dashboard",
      expectUnlockedShell: true,
      viewport: { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false },
    }));
  } finally {
    client?.close();
    if (chrome && !chrome.killed) {
      chrome.kill("SIGTERM");
      await new Promise((resolve) => {
        const timeoutId = setTimeout(resolve, 2_000);
        chrome.once("exit", () => {
          clearTimeout(timeoutId);
          resolve();
        });
      });
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; final reporting still includes process status.
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const collector = createResultCollector();

  console.log(`Ciphora regression smoke target: ${options.baseUrl}`);

  try {
    if (!options.skipApi) {
      await runApiChecks(options, collector);
    } else {
      collector.skip("API regression checks", "skipped by --skip-api");
    }

    if (!options.skipBrowser) {
      await runBrowserChecks(options, collector);
    } else {
      collector.skip("browser regression checks", "skipped by --skip-browser");
    }
  } finally {
    await cleanupStatefulAccounts(options, collector);
  }

  const failed = collector.results.filter((result) => result.status === "fail");
  const skipped = collector.results.filter((result) => result.status === "skip");
  const passed = collector.results.filter((result) => result.status === "pass");

  console.log("");
  console.log(`Summary: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { IDENTITY_BINDINGS, isConfigured, type CiphoraEnv, type IdentityBinding } from "./env";
import {
  base64UrlDecodeText,
  base64UrlEncodeText,
  constantTimeEqual,
  decryptTextWithSecret,
  encryptTextWithSecret,
  hashVerifier,
  hmacBase64Url,
  hmacHex,
  randomBase64Url,
} from "./crypto";
import { errorResponse, isAllowedNativeAppOrigin, jsonResponse, serviceUnavailable } from "./http";

export const SESSION_COOKIE_NAME = "__Host-ciphora_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_JSON_BYTES = 24 * 1024;
const RESET_CHALLENGE_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;
const LOGIN_CHALLENGE_MAX_AGE_SECONDS = 5 * 60;
const LOGIN_PROOF_CONTEXT = "ciphora-login-proof-key-v1";
const LOGIN_PROOF_PREFIX = "login-proof-v1";

export const LEGACY_PASSWORD_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-verifier";
export const CHALLENGE_PASSWORD_VERIFIER_ALGORITHM = "client-pbkdf2-sha256-proof-v1";

export interface AuthenticatedSession {
  userId: string;
  shardId: number;
  sessionId: string;
  deviceId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  accountStatus: string;
  expiresAt: string;
}

export interface RootKeyWrapperInput {
  wrapperType: "password" | "recovery";
  kdfAlgorithm: string;
  kdfParams: Record<string, unknown>;
  algorithm: string;
  iv: string;
  ciphertext: string;
}

export interface DeviceInput {
  deviceId?: string;
  deviceLabel?: string;
  devicePublicKey?: string;
}

export interface LoginMetadata {
  verifierVersion: string;
  verifierAlgorithm: string;
  kdf: {
    algorithm: string;
    iterations: number | null;
    memoryCost: number | null;
    parallelism: number | null;
    salt: string;
  };
  challenge?: {
    token: string;
    expiresAt: string;
    proofAlgorithm: "hmac-sha256";
  };
}

export function requireAuthSecret(env: CiphoraEnv): string | Response {
  if (!isConfigured(env.CIPHORA_AUTH_SECRET)) {
    return serviceUnavailable("auth_not_configured");
  }
  return env.CIPHORA_AUTH_SECRET as string;
}

export function requireDirectory(env: CiphoraEnv): D1Database | Response {
  if (!env.CIPHORA_DIRECTORY) {
    return serviceUnavailable("directory_not_configured");
  }
  return env.CIPHORA_DIRECTORY;
}

export function requireOpsRuntime(env: CiphoraEnv): D1Database | Response {
  if (!env.CIPHORA_OPS_RUNTIME) {
    return serviceUnavailable("ops_runtime_not_configured");
  }
  return env.CIPHORA_OPS_RUNTIME;
}

export function getIdentityShard(env: CiphoraEnv, shardId: number): D1Database | Response {
  if (!Number.isInteger(shardId) || shardId < 0 || shardId >= IDENTITY_BINDINGS.length) {
    return serviceUnavailable("identity_shard_invalid");
  }

  const binding = IDENTITY_BINDINGS[shardId] as IdentityBinding;
  const database = env[binding];
  if (!database) {
    return serviceUnavailable("identity_shard_not_configured");
  }
  return database;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_JSON_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return errorResponse("invalid_json", 400);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return errorResponse("invalid_json", 400);
  }
}

export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (isAllowedNativeAppOrigin(origin)) return null;

  try {
    if (new URL(origin).host === new URL(request.url).host) {
      return null;
    }
  } catch {
    return errorResponse("invalid_origin", 403);
  }

  return errorResponse("invalid_origin", 403);
}

export function normalizeEmail(input: unknown): string | Response {
  if (typeof input !== "string") {
    return errorResponse("invalid_email", 400);
  }

  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return errorResponse("invalid_email", 400);
  }

  return email;
}

export async function emailHash(authSecret: string, normalizedEmail: string): Promise<string> {
  return `hmac-sha256:${await hmacHex(authSecret, `email:${normalizedEmail}`)}`;
}

export function shardFromEmailHash(hash: string): number {
  const hex = hash.split(":").pop() ?? "";
  const prefix = hex.slice(0, 8);
  const parsed = Number.parseInt(prefix, 16);
  return Number.isFinite(parsed) ? parsed % IDENTITY_BINDINGS.length : 0;
}

export function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "0.0.0.0";
}

export function getUserAgent(request: Request): string {
  return request.headers.get("user-agent")?.slice(0, 512) ?? "";
}

export async function hashRequestValue(authSecret: string, scope: string, value: string): Promise<string> {
  return `hmac-sha256:${await hmacHex(authSecret, `${scope}:${value}`)}`;
}

export async function enforceRateLimit(
  db: D1Database,
  authSecret: string,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + windowSeconds * 1000).toISOString();
  const bucketHash = await hmacHex(authSecret, `rate:${scope}:${key}`);
  const bucketKey = `rl:${scope}:${bucketHash}`;

  const existing = await db
    .prepare("SELECT count, expires_at FROM rate_limit_buckets WHERE bucket_key = ?")
    .bind(bucketKey)
    .first<{ count: number; expires_at: string }>();

  if (!existing || Date.parse(existing.expires_at) <= nowMs) {
    await db
      .prepare(
        "INSERT OR REPLACE INTO rate_limit_buckets (bucket_key, bucket_scope, count, window_started_at, expires_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
      )
      .bind(bucketKey, scope, now, expiresAt, now)
      .run();
    return null;
  }

  if (existing.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(existing.expires_at) - nowMs) / 1000));
    return jsonResponse(
      {
        ok: false,
        error: "rate_limited",
      },
      {
        status: 429,
        headers: {
          "retry-after": String(retryAfter),
        },
      },
    );
  }

  await db
    .prepare("UPDATE rate_limit_buckets SET count = count + 1, updated_at = ? WHERE bucket_key = ?")
    .bind(now, bucketKey)
    .run();

  return null;
}

export async function enforceAuthRateLimits(
  request: Request,
  db: D1Database,
  authSecret: string,
  action: "signup" | "login",
  normalizedEmail: string,
): Promise<Response | null> {
  const ip = getClientIp(request);
  const emailKey = await emailHash(authSecret, normalizedEmail);

  const ipLimit = action === "signup"
    ? { limit: 10, windowSeconds: 60 * 60 }
    : { limit: 60, windowSeconds: 15 * 60 };
  const emailLimit = action === "signup"
    ? { limit: 3, windowSeconds: 60 * 60 }
    : { limit: 20, windowSeconds: 15 * 60 };

  return (await enforceRateLimit(db, authSecret, `${action}:ip`, ip, ipLimit.limit, ipLimit.windowSeconds))
    ?? (await enforceRateLimit(db, authSecret, `${action}:email`, emailKey, emailLimit.limit, emailLimit.windowSeconds));
}

export function validateVerifier(input: unknown): string | Response {
  if (typeof input !== "string") {
    return errorResponse("invalid_verifier", 400);
  }

  const verifier = input.trim();
  if (verifier.length < 32 || verifier.length > 512 || !SAFE_TOKEN_PATTERN.test(verifier)) {
    return errorResponse("invalid_verifier", 400);
  }

  return verifier;
}

export function validateLoginProof(input: unknown): string | Response {
  if (typeof input !== "string") {
    return errorResponse("invalid_login_proof", 400);
  }

  const proof = input.trim();
  if (proof.length < 32 || proof.length > 512 || !SAFE_TOKEN_PATTERN.test(proof)) {
    return errorResponse("invalid_login_proof", 400);
  }

  return proof;
}

export function validateKdf(input: unknown): LoginMetadata["kdf"] | Response {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return errorResponse("invalid_kdf", 400);
  }

  const data = input as Record<string, unknown>;
  const algorithm = typeof data.algorithm === "string" ? data.algorithm.trim() : "";
  const salt = typeof data.salt === "string" ? data.salt.trim() : "";
  const iterations = Number(data.iterations);
  const memoryCost = data.memoryCost == null ? null : Number(data.memoryCost);
  const parallelism = data.parallelism == null ? null : Number(data.parallelism);

  if (!["client-pbkdf2-sha256", "client-argon2id", "client-scrypt"].includes(algorithm)) {
    return errorResponse("invalid_kdf", 400);
  }
  if (salt.length < 16 || salt.length > 512) {
    return errorResponse("invalid_kdf", 400);
  }
  if (algorithm === "client-pbkdf2-sha256" && (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000)) {
    return errorResponse("invalid_kdf", 400);
  }

  return {
    algorithm,
    iterations: Number.isFinite(iterations) ? iterations : null,
    memoryCost: Number.isFinite(memoryCost) ? memoryCost : null,
    parallelism: Number.isFinite(parallelism) ? parallelism : null,
    salt,
  };
}

function validateMetadataString(input: unknown, error: string, min = 1, max = 256): string | Response {
  if (typeof input !== "string") {
    return errorResponse(error, 400);
  }

  const value = input.trim();
  if (value.length < min || value.length > max || /[\u0000-\u001f]/.test(value)) {
    return errorResponse(error, 400);
  }

  return value;
}

export function validateRootKeyWrappers(
  input: unknown,
  options: { requirePasswordWrapper?: boolean } = {},
): RootKeyWrapperInput[] | Response {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4) {
    return errorResponse("invalid_root_key_wrappers", 400);
  }

  const requirePasswordWrapper = options.requirePasswordWrapper ?? true;
  const wrappers: RootKeyWrapperInput[] = [];
  let hasPasswordWrapper = false;

  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return errorResponse("invalid_root_key_wrappers", 400);
    }

    const data = item as Record<string, unknown>;
    const wrapperType = data.wrapperType === "password" || data.wrapperType === "recovery" ? data.wrapperType : null;
    if (!wrapperType) return errorResponse("invalid_root_key_wrappers", 400);

    const kdfAlgorithm = validateMetadataString(data.kdfAlgorithm, "invalid_root_key_wrappers", 1, 128);
    if (kdfAlgorithm instanceof Response) return kdfAlgorithm;

    const algorithm = validateMetadataString(data.algorithm, "invalid_root_key_wrappers", 1, 128);
    if (algorithm instanceof Response) return algorithm;

    const iv = validateMetadataString(data.iv, "invalid_root_key_wrappers", 8, 512);
    if (iv instanceof Response) return iv;

    const ciphertext = validateMetadataString(data.ciphertext, "invalid_root_key_wrappers", 16, 16384);
    if (ciphertext instanceof Response) return ciphertext;

    const kdfParams = data.kdfParams && typeof data.kdfParams === "object" && !Array.isArray(data.kdfParams)
      ? data.kdfParams as Record<string, unknown>
      : {};

    hasPasswordWrapper ||= wrapperType === "password";
    wrappers.push({ wrapperType, kdfAlgorithm, kdfParams, algorithm, iv, ciphertext });
  }

  if (requirePasswordWrapper && !hasPasswordWrapper) {
    return errorResponse("missing_password_wrapper", 400);
  }

  return wrappers;
}

export function validateRecoveryKeyHint(input: unknown): string | null | Response {
  if (input == null) {
    return null;
  }

  if (typeof input !== "string") {
    return errorResponse("invalid_recovery_hint", 400);
  }

  const value = input.trim();
  if (value.length > 32 || /[\u0000-\u001f]/.test(value)) {
    return errorResponse("invalid_recovery_hint", 400);
  }

  return value || null;
}

export function validateChallengeToken(input: unknown, errorCode = "invalid_challenge_token"): string | Response {
  if (typeof input !== "string") {
    return errorResponse(errorCode, 400);
  }

  const token = input.trim();
  if (token.length < 24 || token.length > 256 || !RESET_CHALLENGE_TOKEN_PATTERN.test(token)) {
    return errorResponse(errorCode, 400);
  }

  return token;
}

export function validateLoginChallengeToken(input: unknown): string | Response {
  if (typeof input !== "string") {
    return errorResponse("invalid_credentials", 401);
  }

  const token = input.trim();
  if (token.length < 80 || token.length > 1024 || !RESET_CHALLENGE_TOKEN_PATTERN.test(token)) {
    return errorResponse("invalid_credentials", 401);
  }

  return token;
}

export function validateDevice(input: unknown): DeviceInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const data = input as Record<string, unknown>;
  const device: DeviceInput = {};

  if (typeof data.deviceId === "string" && /^[A-Za-z0-9_-]{16,96}$/.test(data.deviceId)) {
    device.deviceId = data.deviceId;
  }
  if (typeof data.deviceLabel === "string") {
    device.deviceLabel = data.deviceLabel.trim().slice(0, 120);
  }
  if (typeof data.devicePublicKey === "string" && data.devicePublicKey.length <= 2048) {
    device.devicePublicKey = data.devicePublicKey.trim();
  }

  return device;
}

export function createSessionToken(shardId: number): string {
  return `v1.${shardId}.${randomBase64Url(32)}`;
}

export function parseSessionShard(token: string | null): number | null {
  if (!token) return null;
  const match = /^v1\.([0-7])\.[A-Za-z0-9_-]{32,128}$/.exec(token);
  if (!match) return null;
  return Number(match[1]);
}

export async function sessionTokenHash(authSecret: string, token: string): Promise<string> {
  return `hmac-sha256:${await hmacHex(authSecret, `session:${token}`)}`;
}

export function sessionCookie(token: string, expiresAt: Date, request?: Request): string {
  const sameSite = isAllowedNativeAppOrigin(request?.headers.get("origin") ?? null)
    ? "SameSite=None"
    : "SameSite=Lax";

  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `Expires=${expiresAt.toUTCString()}`,
    "HttpOnly",
    "Secure",
    sameSite,
  ].join("; ");
}

export function clearSessionCookie(request?: Request): string {
  const sameSite = isAllowedNativeAppOrigin(request?.headers.get("origin") ?? null)
    ? "SameSite=None"
    : "SameSite=Lax";

  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    sameSite,
  ].join("; ");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=") || "";
    }
  }

  return null;
}

export async function verifyStoredVerifier(authSecret: string, verifier: string, stored: string): Promise<boolean> {
  const nextHash = await hashVerifier(authSecret, verifier);
  const envelope = parseStoredChallengeVerifier(stored);
  return constantTimeEqual(nextHash, envelope?.verifierHash ?? stored);
}

export async function createStoredLoginVerifier(authSecret: string, verifier: string): Promise<string> {
  const verifierHash = await hashVerifier(authSecret, verifier);
  const encrypted = await encryptTextWithSecret(authSecret, LOGIN_PROOF_CONTEXT, verifier);
  return `${LOGIN_PROOF_PREFIX}:${base64UrlEncodeText(JSON.stringify({
    v: 1,
    verifierHash,
    encryptedVerifier: {
      algorithm: "AES-GCM-256",
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext,
    },
  }))}`;
}

export function isChallengeStoredVerifier(stored: string): boolean {
  return !!parseStoredChallengeVerifier(stored);
}

export async function createLoginChallenge(authSecret: string, normalizedEmailHash: string): Promise<LoginMetadata["challenge"]> {
  const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_MAX_AGE_SECONDS * 1000).toISOString();
  const payload = base64UrlEncodeText(JSON.stringify({
    v: 1,
    purpose: "login",
    emailHash: normalizedEmailHash,
    nonce: randomBase64Url(32),
    expiresAt,
  }));
  const signature = await hmacBase64Url(authSecret, `login-challenge:${payload}`);
  return {
    token: `${payload}.${signature}`,
    expiresAt,
    proofAlgorithm: "hmac-sha256",
  };
}

export async function verifyChallengeStoredLoginProof(
  authSecret: string,
  stored: string,
  normalizedEmailHash: string,
  challengeToken: string,
  proof: string,
): Promise<boolean> {
  const envelope = parseStoredChallengeVerifier(stored);
  if (!envelope) return false;

  if (!(await verifyLoginChallengeToken(authSecret, normalizedEmailHash, challengeToken))) {
    return false;
  }

  let verifier: string;
  try {
    verifier = await decryptTextWithSecret(
      authSecret,
      LOGIN_PROOF_CONTEXT,
      envelope.encryptedVerifier.iv,
      envelope.encryptedVerifier.ciphertext,
    );
  } catch {
    return false;
  }

  const expectedProof = await hmacBase64Url(verifier, `login-proof:${challengeToken}`);
  return constantTimeEqual(expectedProof, proof);
}

export async function fakeLoginMetadata(authSecret: string, normalizedEmail: string): Promise<LoginMetadata> {
  const salt = await hmacHex(authSecret, `fake-login-salt:${normalizedEmail}`);
  const normalizedEmailHash = await emailHash(authSecret, normalizedEmail);
  return {
    verifierVersion: "v2",
    verifierAlgorithm: CHALLENGE_PASSWORD_VERIFIER_ALGORITHM,
    kdf: {
      algorithm: "client-pbkdf2-sha256",
      iterations: 310000,
      memoryCost: null,
      parallelism: null,
      salt: salt.slice(0, 48),
    },
    challenge: await createLoginChallenge(authSecret, normalizedEmailHash),
  };
}

interface StoredChallengeVerifierEnvelope {
  v: 1;
  verifierHash: string;
  encryptedVerifier: {
    algorithm: "AES-GCM-256";
    iv: string;
    ciphertext: string;
  };
}

function parseStoredChallengeVerifier(stored: string): StoredChallengeVerifierEnvelope | null {
  if (!stored.startsWith(`${LOGIN_PROOF_PREFIX}:`)) {
    return null;
  }

  try {
    const encoded = stored.slice(LOGIN_PROOF_PREFIX.length + 1);
    const parsed = JSON.parse(base64UrlDecodeText(encoded)) as Partial<StoredChallengeVerifierEnvelope>;
    if (
      parsed.v !== 1
      || typeof parsed.verifierHash !== "string"
      || !parsed.verifierHash.startsWith("hmac-sha256:")
      || !parsed.encryptedVerifier
      || parsed.encryptedVerifier.algorithm !== "AES-GCM-256"
      || typeof parsed.encryptedVerifier.iv !== "string"
      || typeof parsed.encryptedVerifier.ciphertext !== "string"
    ) {
      return null;
    }
    return parsed as StoredChallengeVerifierEnvelope;
  } catch {
    return null;
  }
}

async function verifyLoginChallengeToken(authSecret: string, normalizedEmailHash: string, token: string): Promise<boolean> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || token.split(".").length !== 2) {
    return false;
  }

  const expectedSignature = await hmacBase64Url(authSecret, `login-challenge:${payload}`);
  if (!constantTimeEqual(expectedSignature, signature)) {
    return false;
  }

  try {
    const parsed = JSON.parse(base64UrlDecodeText(payload)) as {
      v?: unknown;
      purpose?: unknown;
      emailHash?: unknown;
      nonce?: unknown;
      expiresAt?: unknown;
    };
    return parsed.v === 1
      && parsed.purpose === "login"
      && parsed.emailHash === normalizedEmailHash
      && typeof parsed.nonce === "string"
      && parsed.nonce.length >= 32
      && typeof parsed.expiresAt === "string"
      && Date.parse(parsed.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

export function fakeRecoveryResetWrapper(): RootKeyWrapperInput {
  return {
    wrapperType: "recovery",
    kdfAlgorithm: "client-pbkdf2-sha256",
    kdfParams: {
      version: "ciphora-recovery-root-wrap-v1",
      iterations: 310000,
      salt: randomBase64Url(32),
    },
    algorithm: "AES-GCM-256",
    iv: randomBase64Url(12),
    ciphertext: randomBase64Url(96),
  };
}

export async function getSessionFromRequest(env: CiphoraEnv, request: Request): Promise<AuthenticatedSession | Response | null> {
  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const token = readCookie(request, SESSION_COOKIE_NAME);
  const shardId = parseSessionShard(token);
  if (shardId == null || !token) {
    return null;
  }

  const shard = getIdentityShard(env, shardId);
  if (shard instanceof Response) return shard;

  const tokenHash = await sessionTokenHash(authSecret, token);
  const row = await shard
    .prepare(
      "SELECT s.session_id, s.user_id, s.device_id, s.ip_hash, s.user_agent_hash, s.expires_at, u.account_status FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.session_token_hash = ? AND s.revoked_at IS NULL LIMIT 1",
    )
    .bind(tokenHash)
    .first<{
      session_id: string;
      user_id: string;
      device_id: string | null;
      ip_hash: string | null;
      user_agent_hash: string | null;
      expires_at: string;
      account_status: string;
    }>();

  if (!row || Date.parse(row.expires_at) <= Date.now() || row.account_status !== "active") {
    return null;
  }

  return {
    userId: row.user_id,
    shardId,
    sessionId: row.session_id,
    deviceId: row.device_id,
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
    accountStatus: row.account_status,
    expiresAt: row.expires_at,
  };
}

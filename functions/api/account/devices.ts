import {
  assertSameOrigin,
  clearSessionCookie,
  enforceRateLimit,
  getClientIp,
  getIdentityShard,
  getSessionFromRequest,
  getUserAgent,
  hashRequestValue,
  readJsonObject,
  requireAuthSecret,
  requireOpsRuntime,
} from "../../_shared/auth";
import { errorResponse, jsonResponse, methodNotAllowed, unauthorized } from "../../_shared/http";
import type { CiphoraEnv } from "../../_shared/env";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,96}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIT_EVENT_TYPES = [
  "account.signup",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.password_change",
  "auth.recovery_reset",
  "auth.session_revoked",
  "auth.sessions_revoked",
  "device.trusted",
  "device.trust_removed",
  "email.verified",
  "sync_profile.saved",
  "sync_profile.disabled",
] as const;

type DeviceAction = "revoke_session" | "revoke_sessions" | "set_device_trust";

interface DeviceRow {
  device_id: string;
  device_label: string | null;
  trusted_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  last_login_at: string | null;
  active_session_count: number;
  session_count: number;
}

interface SessionRow {
  session_id: string;
  device_id: string | null;
  device_label: string | null;
  trusted_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

interface EventRow {
  event_id: string;
  event_type: string;
  event_severity: "info" | "warning" | "critical";
  metadata_json: string | null;
  created_at: string;
}

export const onRequestGet: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const nowIso = new Date().toISOString();
  await touchCurrentSession(shard, session.userId, session.sessionId, session.deviceId, nowIso);

  const [deviceResult, sessionResult, eventResult] = await Promise.all([
    shard
      .prepare(
        `SELECT
          d.device_id,
          d.device_label,
          d.trusted_at,
          d.created_at,
          d.last_seen_at,
          d.revoked_at,
          MAX(s.created_at) AS last_login_at,
          SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at > ? THEN 1 ELSE 0 END) AS active_session_count,
          COUNT(s.session_id) AS session_count
        FROM devices d
        LEFT JOIN sessions s ON s.device_id = d.device_id AND s.user_id = d.user_id
        WHERE d.user_id = ?
        GROUP BY d.device_id, d.device_label, d.trusted_at, d.created_at, d.last_seen_at, d.revoked_at
        ORDER BY COALESCE(d.last_seen_at, last_login_at, d.created_at) DESC
        LIMIT 30`,
      )
      .bind(nowIso, session.userId)
      .all<DeviceRow>(),
    shard
      .prepare(
        `SELECT
          s.session_id,
          s.device_id,
          d.device_label,
          d.trusted_at,
          s.created_at,
          s.last_seen_at,
          s.expires_at,
          s.revoked_at,
          s.revoked_reason
        FROM sessions s
        LEFT JOIN devices d ON d.device_id = s.device_id AND d.user_id = s.user_id
        WHERE s.user_id = ?
        ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC
        LIMIT 50`,
      )
      .bind(session.userId)
      .all<SessionRow>(),
    shard
      .prepare(
        `SELECT event_id, event_type, event_severity, metadata_json, created_at
        FROM account_events
        WHERE user_id = ?
          AND event_type IN (${AUDIT_EVENT_TYPES.map(() => "?").join(", ")})
        ORDER BY created_at DESC
        LIMIT 50`,
      )
      .bind(session.userId, ...AUDIT_EVENT_TYPES)
      .all<EventRow>(),
  ]);

  const sessions = (sessionResult.results ?? []).map((row) => serializeSession(row, session.sessionId, nowIso));
  const devices = (deviceResult.results ?? []).map((row) => serializeDevice(row, session.deviceId));
  const lastLoginAt = sessions.reduce<string | null>((latest, item) => {
    if (!latest) return item.createdAt;
    return Date.parse(item.createdAt) > Date.parse(latest) ? item.createdAt : latest;
  }, null);

  return jsonResponse({
    ok: true,
    currentSessionId: session.sessionId,
    currentDeviceId: session.deviceId,
    devices,
    sessions,
    auditEvents: (eventResult.results ?? []).map(serializeAuditEvent),
    summary: {
      activeSessionCount: sessions.filter((item) => item.status === "active").length,
      trustedDeviceCount: devices.filter((item) => item.trusted).length,
      lastLoginAt,
    },
  });
};

export const onRequestPost: PagesFunction<CiphoraEnv> = async ({ env, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await getSessionFromRequest(env, request);
  if (session instanceof Response) return session;
  if (!session) return unauthorized();

  const authSecret = requireAuthSecret(env);
  if (authSecret instanceof Response) return authSecret;

  const ops = requireOpsRuntime(env);
  if (ops instanceof Response) return ops;

  const userRateLimited = await enforceRateLimit(ops, authSecret, "device-session:user", session.userId, 40, 60 * 60);
  if (userRateLimited) return userRateLimited;

  const ipRateLimited = await enforceRateLimit(ops, authSecret, "device-session:ip", getClientIp(request), 120, 60 * 60);
  if (ipRateLimited) return ipRateLimited;

  const body = await readJsonObject(request);
  if (body instanceof Response) return body;

  const action = validateAction(body.action);
  if (action instanceof Response) return action;

  const shard = getIdentityShard(env, session.shardId);
  if (shard instanceof Response) return shard;

  const nowIso = new Date().toISOString();
  const ipHash = await hashRequestValue(authSecret, "ip", getClientIp(request));
  const userAgentHash = await hashRequestValue(authSecret, "user-agent", getUserAgent(request));

  if (action === "set_device_trust") {
    const deviceId = validateDeviceId(body.deviceId);
    if (deviceId instanceof Response) return deviceId;
    const trusted = body.trusted !== false;

    const result = await shard.batch([
      shard
        .prepare("UPDATE devices SET trusted_at = ?, last_seen_at = COALESCE(last_seen_at, ?) WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL")
        .bind(trusted ? nowIso : null, nowIso, session.userId, deviceId),
      shard
        .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, ?, 'info', ?, ?, ?, ?)")
        .bind(
          crypto.randomUUID(),
          session.userId,
          trusted ? "device.trusted" : "device.trust_removed",
          ipHash,
          userAgentHash,
          JSON.stringify({
            shardId: session.shardId,
            currentDevice: deviceId === session.deviceId,
          }),
          nowIso,
        ),
    ]);

    if ((result[0].meta?.changes ?? 0) < 1) {
      return errorResponse("device_not_found", 404);
    }

    return jsonResponse({
      ok: true,
      trusted,
      currentSessionRevoked: false,
    });
  }

  if (action === "revoke_session") {
    const targetSessionId = validateSessionId(body.sessionId);
    if (targetSessionId instanceof Response) return targetSessionId;

    const target = await shard
      .prepare("SELECT session_id, device_id, revoked_at FROM sessions WHERE user_id = ? AND session_id = ? LIMIT 1")
      .bind(session.userId, targetSessionId)
      .first<{ session_id: string; device_id: string | null; revoked_at: string | null }>();
    if (!target) {
      return errorResponse("session_not_found", 404);
    }

    const currentSessionRevoked = target.session_id === session.sessionId;
    const result = await shard.batch([
      shard
        .prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, 'user_revoke') WHERE user_id = ? AND session_id = ?")
        .bind(nowIso, session.userId, target.session_id),
      shard
        .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.session_revoked', 'warning', ?, ?, ?, ?)")
        .bind(
          crypto.randomUUID(),
          session.userId,
          ipHash,
          userAgentHash,
          JSON.stringify({
            shardId: session.shardId,
            currentSession: currentSessionRevoked,
            targetHadDevice: !!target.device_id,
          }),
          nowIso,
        ),
    ]);

    return jsonResponse(
      {
        ok: true,
        revokedCount: result[0].meta?.changes ?? 0,
        currentSessionRevoked,
      },
      currentSessionRevoked
        ? { headers: { "set-cookie": clearSessionCookie(request) } }
        : undefined,
    );
  }

  const includeCurrent = body.includeCurrent === true;
  const updateResult = await shard.batch([
    includeCurrent
      ? shard
        .prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = COALESCE(revoked_reason, 'user_revoke_all') WHERE user_id = ? AND revoked_at IS NULL")
        .bind(nowIso, session.userId)
      : shard
        .prepare("UPDATE sessions SET revoked_at = ?, revoked_reason = COALESCE(revoked_reason, 'user_revoke_all_other') WHERE user_id = ? AND session_id != ? AND revoked_at IS NULL")
        .bind(nowIso, session.userId, session.sessionId),
    shard
      .prepare("INSERT INTO account_events (event_id, user_id, event_type, event_severity, ip_hash, user_agent_hash, metadata_json, created_at) VALUES (?, ?, 'auth.sessions_revoked', 'warning', ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        session.userId,
        ipHash,
        userAgentHash,
        JSON.stringify({
          shardId: session.shardId,
          includeCurrent,
        }),
        nowIso,
      ),
  ]);

  return jsonResponse(
    {
      ok: true,
      revokedCount: updateResult[0].meta?.changes ?? 0,
      currentSessionRevoked: includeCurrent,
    },
    includeCurrent
      ? { headers: { "set-cookie": clearSessionCookie(request) } }
      : undefined,
  );
};

export const onRequest: PagesFunction<CiphoraEnv> = async () => methodNotAllowed(["GET", "POST"]);

async function touchCurrentSession(
  shard: D1Database,
  userId: string,
  sessionId: string,
  deviceId: string | null,
  nowIso: string,
) {
  const statements = [
    shard
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ? AND user_id = ?")
      .bind(nowIso, sessionId, userId),
  ];

  if (deviceId) {
    statements.push(
      shard
        .prepare("UPDATE devices SET last_seen_at = ? WHERE device_id = ? AND user_id = ?")
        .bind(nowIso, deviceId, userId),
    );
  }

  await shard.batch(statements);
}

function validateAction(input: unknown): DeviceAction | Response {
  if (input === "revoke_session" || input === "revoke_sessions" || input === "set_device_trust") {
    return input;
  }
  return errorResponse("invalid_action", 400);
}

function validateDeviceId(input: unknown): string | Response {
  if (typeof input !== "string") {
    return errorResponse("invalid_device_id", 400);
  }
  const value = input.trim();
  return DEVICE_ID_PATTERN.test(value) ? value : errorResponse("invalid_device_id", 400);
}

function validateSessionId(input: unknown): string | Response {
  if (typeof input !== "string") {
    return errorResponse("invalid_session_id", 400);
  }
  const value = input.trim();
  return UUID_PATTERN.test(value) ? value : errorResponse("invalid_session_id", 400);
}

function serializeDevice(row: DeviceRow, currentDeviceId: string | null) {
  return {
    deviceId: row.device_id,
    label: row.device_label || "Ciphora Web Vault",
    trusted: !!row.trusted_at,
    trustedAt: row.trusted_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    lastLoginAt: row.last_login_at,
    revokedAt: row.revoked_at,
    activeSessionCount: Number(row.active_session_count ?? 0),
    sessionCount: Number(row.session_count ?? 0),
    isCurrentDevice: !!currentDeviceId && row.device_id === currentDeviceId,
  };
}

function serializeSession(row: SessionRow, currentSessionId: string, nowIso: string) {
  const status = row.revoked_at
    ? "revoked"
    : Date.parse(row.expires_at) <= Date.parse(nowIso)
      ? "expired"
      : "active";

  return {
    sessionId: row.session_id,
    type: "login",
    deviceId: row.device_id,
    deviceLabel: row.device_label || "Ciphora Web Vault",
    trustedDevice: !!row.trusted_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    status,
    isCurrent: row.session_id === currentSessionId,
  };
}

function serializeAuditEvent(row: EventRow) {
  return {
    eventId: row.event_id,
    type: row.event_type,
    label: getEventLabel(row.event_type),
    severity: row.event_severity,
    createdAt: row.created_at,
    metadata: sanitizeMetadata(row.metadata_json),
  };
}

function getEventLabel(eventType: string): string {
  if (eventType === "account.signup") return "Account created";
  if (eventType === "auth.login") return "Login succeeded";
  if (eventType === "auth.login_failed") return "Login failed";
  if (eventType === "auth.logout") return "Logged out";
  if (eventType === "auth.password_change") return "Password changed";
  if (eventType === "auth.recovery_reset") return "Recovery reset";
  if (eventType === "auth.session_revoked") return "Session revoked";
  if (eventType === "auth.sessions_revoked") return "Sessions revoked";
  if (eventType === "device.trusted") return "Device trusted";
  if (eventType === "device.trust_removed") return "Device trust removed";
  if (eventType === "email.verified") return "Email verified";
  if (eventType === "sync_profile.saved") return "Sync profile saved";
  if (eventType === "sync_profile.disabled") return "Sync profile disabled";
  return eventType;
}

function sanitizeMetadata(raw: string | null): Record<string, string | number | boolean | null> {
  if (!raw || raw.length > 2048) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9_.-]{1,48}$/.test(key)) continue;
      if (typeof value === "string") {
        output[key] = value.slice(0, 160);
      } else if (typeof value === "number" && Number.isFinite(value)) {
        output[key] = value;
      } else if (typeof value === "boolean" || value === null) {
        output[key] = value;
      }
    }
    return output;
  } catch {
    return {};
  }
}

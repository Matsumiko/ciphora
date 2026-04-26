import { useMemo, useState } from "react";
import {
  ShieldWarning,
  Warning,
  ArrowRight,
  CheckCircle,
  CreditCard,
  Key,
  Copy,
  Check,
  PencilSimple,
  Trash,
  Lifebuoy,
  Certificate,
  Database,
} from "@phosphor-icons/react";
import { APP_NAME } from "../lib/app-config";
import type { VaultItem } from "./ItemModal";

interface SecurityAuditProps {
  passwords: VaultItem[];
  cards: VaultItem[];
  recoveryCodes: VaultItem[];
  softwareLicenses: VaultItem[];
  databaseCredentials: VaultItem[];
  onEditItem: (item: VaultItem) => void;
  onDeleteItem: (id: number, type: string, name: string) => void;
  onNavigate: (id: string) => void;
}

type LicenseIssue = VaultItem & { _tag: "expired" | "expiring" };
type DatabasePrivilegeIssue = {
  item: VaultItem;
  reason: string;
};

const RECOVERY_STALE_DAYS = 180;
const LICENSE_EXPIRING_DAYS = 30;
const PRIVILEGED_DB_USERS = new Set([
  "root",
  "admin",
  "administrator",
  "postgres",
  "sa",
  "sys",
  "system",
  "dbo",
  "owner",
  "superuser",
  "rds_superuser",
  "cloudsqlsuperuser",
]);
const PRIVILEGED_DB_NOTE_PATTERNS = [
  "all privileges",
  "full access",
  "superuser",
  "schema owner",
  "database owner",
  "owner",
  "admin",
  "root",
  "read/write",
  "write access",
  "ddl",
  "drop table",
  "production admin",
];

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"
    >
      {copied ? <Check size={13} weight="duotone" className="text-amber-400" /> : <Copy size={13} weight="duotone" />}
    </button>
  );
}

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: "Excellent", color: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 70) return { label: "Good", color: "text-amber-700 dark:text-amber-400" };
  if (score >= 50) return { label: "Fair", color: "text-orange-600 dark:text-orange-400" };
  return { label: "At Risk", color: "text-red-600 dark:text-red-400" };
}

function parseDateLike(value?: string | null): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (["never", "lifetime", "perpetual", "none", "n/a", "-"].includes(lower)) return null;

  const isoDate = raw.match(/\b(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?\b/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3] ?? "1");
    if (year >= 1970 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day, 23, 59, 59, 999);
    }
  }

  const monthYear = raw.match(/\b(\d{1,2})\/(\d{2,4})\b/);
  if (monthYear) {
    const month = Number(monthYear[1]);
    const rawYear = Number(monthYear[2]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (year >= 1970 && month >= 1 && month <= 12) {
      return new Date(year, month, 0, 23, 59, 59, 999);
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function getRecoveryRotationDate(item: VaultItem): Date | null {
  const noteDate = parseDateLike(item.recoveryNotes);
  if (noteDate) return noteDate;
  return parseDateLike(item.modifiedAt);
}

function getLicenseExpiry(item: VaultItem): Date | null {
  return parseDateLike(item.licenseExpiry);
}

function extractConnectionUrlUsername(value?: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(new URL(value).username || "");
  } catch {
    const match = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^:@/]+)(?::[^@]*)?@/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }
}

function normalizeDbPrincipal(value?: string) {
  return value?.trim().toLowerCase().replace(/^["'`]+|["'`]+$/g, "") ?? "";
}

function getDatabasePrivilegeReason(item: VaultItem): string | null {
  const userCandidates = [
    item.dbUsername,
    extractConnectionUrlUsername(item.dbConnectionUrl),
  ].map(normalizeDbPrincipal).filter(Boolean);

  const privilegedUser = userCandidates.find((candidate) => (
    PRIVILEGED_DB_USERS.has(candidate)
    || candidate.endsWith("_admin")
    || candidate.includes("superuser")
  ));
  if (privilegedUser) return `Privileged principal: ${privilegedUser}`;

  const notes = item.dbNotes?.toLowerCase() ?? "";
  const noteHit = PRIVILEGED_DB_NOTE_PATTERNS.find((pattern) => notes.includes(pattern));
  if (noteHit) return `Notes mention broad access: ${noteHit}`;

  return null;
}

export default function SecurityAudit({ passwords, cards, recoveryCodes, softwareLicenses, databaseCredentials, onEditItem, onDeleteItem, onNavigate }: SecurityAuditProps) {
  const weakPasswords = useMemo(
    () => passwords.filter(p => p.strength === "weak"),
    [passwords]
  );

  const duplicates = useMemo(() => {
    const seen: Record<string, VaultItem[]> = {};
    passwords.forEach(p => {
      if (!p.password) return;
      if (!seen[p.password]) seen[p.password] = [];
      seen[p.password].push(p);
    });
    return Object.values(seen).filter(g => g.length > 1).flat();
  }, [passwords]);

  const expiredCards = useMemo(() => {
    const now = new Date();
    return cards.filter(c => {
      if (!c.expiry) return false;
      const [m, y] = c.expiry.split("/").map(Number);
      const exp = new Date(2000 + y, m - 1, 1);
      return exp < now;
    });
  }, [cards]);

  const expiringCards = useMemo(() => {
    const now = new Date();
    return cards.filter(c => {
      if (!c.expiry) return false;
      const [m, y] = c.expiry.split("/").map(Number);
      const exp = new Date(2000 + y, m - 1, 1);
      const diffMs = exp.getTime() - now.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 90;
    });
  }, [cards]);

  const staleRecoveryCodes = useMemo(() => {
    const now = new Date();
    return recoveryCodes.filter((item) => {
      const rotatedAt = getRecoveryRotationDate(item);
      if (!rotatedAt) return false;
      return daysBetween(rotatedAt, now) > RECOVERY_STALE_DAYS;
    });
  }, [recoveryCodes]);

  const expiredLicenses = useMemo(() => {
    const now = new Date();
    return softwareLicenses.filter((item) => {
      const expiry = getLicenseExpiry(item);
      return expiry ? expiry < now : false;
    });
  }, [softwareLicenses]);

  const expiringLicenses = useMemo(() => {
    const now = new Date();
    return softwareLicenses.filter((item) => {
      const expiry = getLicenseExpiry(item);
      if (!expiry || expiry < now) return false;
      const diffDays = daysBetween(now, expiry);
      return diffDays >= 0 && diffDays <= LICENSE_EXPIRING_DAYS;
    });
  }, [softwareLicenses]);

  const privilegedDatabaseCredentials = useMemo<DatabasePrivilegeIssue[]>(
    () => databaseCredentials
      .map((item) => ({ item, reason: getDatabasePrivilegeReason(item) }))
      .filter((issue): issue is DatabasePrivilegeIssue => Boolean(issue.reason)),
    [databaseCredentials]
  );

  // Security score: start 100, deduct per issue
  const score = Math.max(0, Math.min(100,
    100
    - weakPasswords.length * 10
    - duplicates.length * 5
    - expiredCards.length * 15
    - expiringCards.length * 5
    - staleRecoveryCodes.length * 8
    - expiredLicenses.length * 12
    - expiringLicenses.length * 4
    - privilegedDatabaseCredentials.length * 12
  ));
  const { label: scoreText, color: scoreColor } = scoreLabel(score);

  const totalIssues = weakPasswords.length
    + duplicates.length
    + expiredCards.length
    + expiringCards.length
    + staleRecoveryCodes.length
    + expiredLicenses.length
    + expiringLicenses.length
    + privilegedDatabaseCredentials.length;

  return (
    <section className="bg-background min-h-screen text-foreground">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05] z-0 text-border" style={{ backgroundImage: "linear-gradient(to right, hsl(var(--grid-line)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--grid-line)) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-1">{APP_NAME} - Security Audit</p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Security Audit</h1>
            <p className="text-sm text-muted-foreground mt-1">Identify weak credentials, stale recovery material, expired licenses, and risky database access.</p>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-4xl font-heading font-bold ${scoreColor}`}>{score}</div>
            <div className={`text-xs font-mono uppercase tracking-widest ${scoreColor}`}>{scoreText}</div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">Security Score</div>
          </div>
        </div>

        {/* Score bar */}
        <div className="bg-card border border-border rounded-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Overall Health</span>
            <span className={`text-sm font-bold font-heading ${scoreColor}`}>{score}/100</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-400" : score >= 50 ? "bg-orange-500" : "bg-red-500"}`}
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{weakPasswords.length} weak password{weakPasswords.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{duplicates.length} duplicate{duplicates.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{expiredCards.length} expired card{expiredCards.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{expiringCards.length} expiring soon</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{staleRecoveryCodes.length} stale recovery</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-lime-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{expiredLicenses.length + expiringLicenses.length} license issue{expiredLicenses.length + expiringLicenses.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-[11px] font-mono text-muted-foreground">{privilegedDatabaseCredentials.length} privileged DB</span>
            </div>
          </div>
        </div>

        {/* All clear */}
        {totalIssues === 0 && (
          <div className="bg-emerald-500/10 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 rounded-sm p-6 flex items-center gap-4">
            <CheckCircle weight="duotone" size={32} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <p className="font-heading font-semibold text-emerald-700 dark:text-emerald-400">No issues found!</p>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-600 font-mono mt-0.5">Passwords, cards, recovery codes, licenses, and database credentials have no heuristic issues.</p>
            </div>
          </div>
        )}

        {/* Weak passwords */}
        {weakPasswords.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Warning weight="duotone" size={16} className="text-red-600 dark:text-red-400" />
              <span className="text-sm font-heading font-semibold text-foreground">Weak Passwords</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-red-600 dark:text-red-400">{weakPasswords.length} issue{weakPasswords.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="bg-red-500/10 border border-red-200 dark:bg-red-950/20 dark:border-red-900/40 rounded-sm px-3 py-2 mb-3 flex items-start gap-2">
              <ShieldWarning weight="duotone" size={13} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-red-700/80 dark:text-red-400/80">Weak passwords are vulnerable to brute-force attacks. Update them to 16+ characters with mixed types.</p>
            </div>
            <div className="space-y-2">
              {weakPasswords.map((item, idx) => (
                <div key={item.id} style={{ animationDelay: `${idx * 0.06}s` }} className="animate-fade-in-up bg-card border border-red-200 dark:border-red-900/30 rounded-sm px-4 py-3 flex items-center gap-3 group card-hover">
                  <div className="w-8 h-8 bg-muted rounded-sm flex items-center justify-center text-[10px] font-mono font-bold text-muted-foreground shrink-0">{item.favicon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{item.site}</span>
                      <span className="text-[10px] font-mono text-red-700 bg-red-500/10 px-1.5 py-0.5 rounded-sm border border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-900/50">WEAK</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{item.username}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <CopyBtn value={item.password ?? ""} />
                    <button onClick={() => onEditItem(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                      <PencilSimple size={13} weight="duotone" />
                    </button>
                    <button onClick={() => onDeleteItem(item.id, item.type, item.site ?? "Item")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150">
                      <Trash size={13} weight="duotone" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Duplicate passwords */}
        {duplicates.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Key weight="duotone" size={16} className="text-amber-700 dark:text-amber-400" />
              <span className="text-sm font-heading font-semibold text-foreground">Duplicate Passwords</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-amber-700 dark:text-amber-400">{duplicates.length} affected</span>
            </div>
            <div className="bg-amber-500/10 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40 rounded-sm px-3 py-2 mb-3 flex items-start gap-2">
              <Warning weight="duotone" size={13} className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-amber-800/80 dark:text-amber-400/80">Reusing passwords across sites means one breach exposes all. Give each site a unique password.</p>
            </div>
            <div className="space-y-2">
              {duplicates.map((item, idx) => (
                <div key={item.id} style={{ animationDelay: `${idx * 0.06}s` }} className="animate-fade-in-up bg-card border border-amber-200 dark:border-amber-900/30 rounded-sm px-4 py-3 flex items-center gap-3 group card-hover">
                  <div className="w-8 h-8 bg-muted rounded-sm flex items-center justify-center text-[10px] font-mono font-bold text-muted-foreground shrink-0">{item.favicon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{item.site}</span>
                      <span className="text-[10px] font-mono text-amber-700 bg-amber-500/10 px-1.5 py-0.5 rounded-sm border border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-900/50">DUPLICATE</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{item.username}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => onEditItem(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                      <PencilSimple size={13} weight="duotone" />
                    </button>
                    <button onClick={() => onDeleteItem(item.id, item.type, item.site ?? "Item")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150">
                      <Trash size={13} weight="duotone" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expired / expiring cards */}
        {(expiredCards.length > 0 || expiringCards.length > 0) && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CreditCard weight="duotone" size={16} className="text-orange-600 dark:text-orange-400" />
              <span className="text-sm font-heading font-semibold text-foreground">Card Issues</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-orange-600 dark:text-orange-400">{expiredCards.length + expiringCards.length} issue{expiredCards.length + expiringCards.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-2">
              {[...expiredCards.map(c => ({ ...c, _tag: "expired" as const })), ...expiringCards.map(c => ({ ...c, _tag: "expiring" as const }))].map(item => (
                <div key={`${item._tag}-${item.id}`} className={`bg-card border rounded-sm px-4 py-3 flex items-center gap-3 group ${item._tag === "expired" ? "border-red-200 dark:border-red-900/40" : "border-orange-200 dark:border-orange-900/40"}`}>
                  <div className="w-8 h-8 bg-muted rounded-sm flex items-center justify-center shrink-0">
                    <CreditCard size={14} weight="duotone" className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{item.brand} {item.number?.slice(-4)}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm border ${item._tag === "expired" ? "text-red-700 bg-red-500/10 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-900/50" : "text-orange-700 bg-orange-500/10 border-orange-200 dark:text-orange-400 dark:bg-orange-950/40 dark:border-orange-900/50"}`}>
                        {item._tag === "expired" ? "EXPIRED" : "EXPIRING SOON"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{item.cardholder} - Exp {item.expiry}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => onEditItem(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                      <PencilSimple size={13} weight="duotone" />
                    </button>
                    <button onClick={() => onDeleteItem(item.id, item.type, `${item.brand} ${item.number?.slice(-4)}`)} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150">
                      <Trash size={13} weight="duotone" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stale recovery codes */}
        {staleRecoveryCodes.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Lifebuoy weight="duotone" size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-heading font-semibold text-foreground">Stale Recovery Codes</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">{staleRecoveryCodes.length} issue{staleRecoveryCodes.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/40 rounded-sm px-3 py-2 mb-3 flex items-start gap-2">
              <Warning weight="duotone" size={13} className="text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-emerald-800/80 dark:text-emerald-400/80">Recovery codes older than {RECOVERY_STALE_DAYS} days should be rotated, especially after device changes or suspected account exposure.</p>
            </div>
            <div className="space-y-2">
              {staleRecoveryCodes.map((item, idx) => {
                const rotatedAt = getRecoveryRotationDate(item);
                const daysOld = rotatedAt ? daysBetween(rotatedAt, new Date()) : null;
                return (
                  <div key={item.id} style={{ animationDelay: `${idx * 0.06}s` }} className="animate-fade-in-up bg-card border border-emerald-200 dark:border-emerald-900/30 rounded-sm px-4 py-3 flex items-center gap-3 group card-hover">
                    <div className="w-8 h-8 bg-muted rounded-sm flex items-center justify-center shrink-0">
                      <Lifebuoy size={14} weight="duotone" className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{item.recoveryName ?? "Recovery Codes"}</span>
                        <span className="text-[10px] font-mono text-emerald-700 bg-emerald-500/10 px-1.5 py-0.5 rounded-sm border border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-900/50">STALE</span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {[item.recoveryService, item.recoveryAccount].filter(Boolean).join(" - ") || "Recovery material"}
                        {daysOld !== null ? ` - ${daysOld}d old` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onEditItem(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                        <PencilSimple size={13} weight="duotone" />
                      </button>
                      <button onClick={() => onDeleteItem(item.id, item.type, item.recoveryName ?? "Recovery Codes")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150">
                        <Trash size={13} weight="duotone" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Software license issues */}
        {(expiredLicenses.length > 0 || expiringLicenses.length > 0) && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Certificate weight="duotone" size={16} className="text-lime-700 dark:text-lime-400" />
              <span className="text-sm font-heading font-semibold text-foreground">Software License Issues</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-lime-700 dark:text-lime-400">{expiredLicenses.length + expiringLicenses.length} issue{expiredLicenses.length + expiringLicenses.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-2">
              {([
                ...expiredLicenses.map((item) => ({ ...item, _tag: "expired" as const })),
                ...expiringLicenses.map((item) => ({ ...item, _tag: "expiring" as const })),
              ] satisfies LicenseIssue[]).map((item) => (
                <div key={`${item._tag}-${item.id}`} className={`bg-card border rounded-sm px-4 py-3 flex items-center gap-3 group ${item._tag === "expired" ? "border-red-200 dark:border-red-900/40" : "border-lime-200 dark:border-lime-900/40"}`}>
                  <div className="w-8 h-8 bg-muted rounded-sm flex items-center justify-center shrink-0">
                    <Certificate size={14} weight="duotone" className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{item.softwareName ?? "Software License"}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm border ${item._tag === "expired" ? "text-red-700 bg-red-500/10 border-red-200 dark:text-red-400 dark:bg-red-950/40 dark:border-red-900/50" : "text-lime-700 bg-lime-500/10 border-lime-200 dark:text-lime-400 dark:bg-lime-950/40 dark:border-lime-900/50"}`}>
                        {item._tag === "expired" ? "EXPIRED" : "EXPIRING SOON"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{[item.softwareVendor, item.licenseEmail].filter(Boolean).join(" - ") || "License"} - Exp {item.licenseExpiry}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => onEditItem(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                      <PencilSimple size={13} weight="duotone" />
                    </button>
                    <button onClick={() => onDeleteItem(item.id, item.type, item.softwareName ?? "Software License")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150">
                      <Trash size={13} weight="duotone" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Database privilege issues */}
        {privilegedDatabaseCredentials.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Database weight="duotone" size={16} className="text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-heading font-semibold text-foreground">Database Privilege Review</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">{privilegedDatabaseCredentials.length} issue{privilegedDatabaseCredentials.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="bg-indigo-500/10 border border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900/40 rounded-sm px-3 py-2 mb-3 flex items-start gap-2">
              <ShieldWarning weight="duotone" size={13} className="text-indigo-700 dark:text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-indigo-800/80 dark:text-indigo-400/80">Prefer least-privilege database users. Store admin/root credentials only when there is no safer scoped account.</p>
            </div>
            <div className="space-y-2">
              {privilegedDatabaseCredentials.map(({ item, reason }, idx) => (
                <div key={item.id} style={{ animationDelay: `${idx * 0.06}s` }} className="animate-fade-in-up bg-card border border-indigo-200 dark:border-indigo-900/30 rounded-sm px-4 py-3 flex items-center gap-3 group card-hover">
                  <div className="w-8 h-8 bg-muted rounded-sm flex items-center justify-center shrink-0">
                    <Database size={14} weight="duotone" className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">{item.dbName ?? "Database Credential"}</span>
                      <span className="text-[10px] font-mono text-indigo-700 bg-indigo-500/10 px-1.5 py-0.5 rounded-sm border border-indigo-200 dark:text-indigo-400 dark:bg-indigo-950/40 dark:border-indigo-900/50">PRIVILEGED</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{[item.dbEngine, item.dbHost, item.dbDatabase, item.dbUsername].filter(Boolean).join(" - ") || "Database access"}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{reason}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => onEditItem(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                      <PencilSimple size={13} weight="duotone" />
                    </button>
                    <button onClick={() => onDeleteItem(item.id, item.type, item.dbName ?? "Database Credential")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150">
                      <Trash size={13} weight="duotone" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Improvement tips */}
        <div className="bg-card border border-border rounded-sm p-5">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">Improvement Tips</p>
          <div className="space-y-3">
            {[
              { icon: Key, tip: "Use 16+ character passwords with mixed uppercase, lowercase, numbers, and symbols.", done: weakPasswords.length === 0 },
              { icon: ShieldWarning, tip: "Never reuse the same password across multiple sites.", done: duplicates.length === 0 },
              { icon: CreditCard, tip: "Update expired or soon-to-expire credit card details.", done: expiredCards.length === 0 && expiringCards.length === 0 },
              { icon: Lifebuoy, tip: `Rotate Recovery Codes at least every ${RECOVERY_STALE_DAYS} days or after account/device risk changes.`, done: staleRecoveryCodes.length === 0 },
              { icon: Certificate, tip: "Renew expired software licenses or mark lifetime licenses clearly.", done: expiredLicenses.length === 0 && expiringLicenses.length === 0 },
              { icon: Database, tip: "Replace root/admin database users with scoped read-only or task-specific credentials.", done: privilegedDatabaseCredentials.length === 0 },
            ].map(({ icon: Icon, tip, done }, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-sm flex items-center justify-center shrink-0 mt-0.5 border ${done ? "bg-emerald-500/[0.12] border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-800/60" : "bg-muted border-border"}`}>
                  {done ? <CheckCircle size={13} weight="duotone" className="text-emerald-600 dark:text-emerald-400" /> : <Icon size={13} weight="duotone" className="text-muted-foreground" />}
                </div>
                <p className={`text-xs font-mono leading-relaxed ${done ? "text-emerald-700/80 dark:text-emerald-300/75 line-through decoration-emerald-500/35 dark:decoration-emerald-400/45 decoration-1" : "text-muted-foreground"}`}>{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground font-mono">{totalIssues} issue{totalIssues !== 1 ? "s" : ""} found - Fix them to improve your score</p>
          <button
            onClick={() => onNavigate("item-library")}
            className="flex items-center gap-1.5 text-xs font-mono text-amber-700 hover:text-amber-800 border border-amber-300 hover:border-amber-400 hover:bg-amber-500/10 dark:text-amber-400 dark:hover:text-amber-300 dark:border-amber-800 dark:hover:border-amber-600 dark:hover:bg-amber-950/40 px-3 py-1.5 rounded-sm transition-all duration-150"
          >
            Go to Item Library <ArrowRight weight="duotone" size={12} />
          </button>
        </div>
      </div>
    </section>
  );
}

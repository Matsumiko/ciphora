import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Lock,
  Key,
  ClockCounterClockwise,
  CreditCard,
  Note,
  ShieldCheck,
  Database,
  Copy,
  PencilSimple,
  Trash,
  Export,
  LockOpen,
  Warning,
  CheckCircle,
  Timer,
  HardDrive,
  ArrowRight,
  Plus,
  Lightning,
  Vault,
  TerminalWindow,
  IdentificationCard,
  Code,
  WifiHigh,
  Lifebuoy,
  Certificate,
  EnvelopeSimple,
  Bank,
  Cloud,
} from "@phosphor-icons/react";
import { APP_NAME } from "../lib/app-config";
import type { VaultActivity } from "../lib/vault-storage";
import type { VaultItem } from "./ItemModal";

const quickActions = [
  { id: "add-password", label: "Add Password", icon: Key, color: "text-amber-400", action: "add-password" },
  { id: "add-totp", label: "Add TOTP", icon: Timer, color: "text-amber-400", action: "add-totp" },
  { id: "add-ssh", label: "Add SSH Key", icon: TerminalWindow, color: "text-cyan-400", action: "add-ssh" },
  { id: "add-identity", label: "Add Identity", icon: IdentificationCard, color: "text-violet-400", action: "add-identity" },
  { id: "add-recovery", label: "Add Recovery Codes", icon: Lifebuoy, color: "text-emerald-400", action: "add-recovery" },
  { id: "add-license", label: "Add Software License", icon: Certificate, color: "text-lime-400", action: "add-license" },
  { id: "add-database", label: "Add Database Credential", icon: Database, color: "text-indigo-400", action: "add-database" },
  { id: "generate", label: "Generate Password", icon: Lightning, color: "text-emerald-400", action: "navigate-generator" },
  { id: "export", label: "Export Vault", icon: Export, color: "text-muted-foreground", action: "export" },
];

const activityIcons = {
  unlock: LockOpen,
  copy: Copy,
  edit: PencilSimple,
  delete: Trash,
  export: Export,
  import: HardDrive,
  add: Plus,
  migration: ShieldCheck,
} as const;

const severityConfig: Record<string, { badge: string; dot: string }> = {
  info: { badge: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
  amber: { badge: "bg-amber-500/[0.12] text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25", dot: "bg-amber-500 dark:bg-amber-400" },
  warning: { badge: "bg-amber-500/[0.14] text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30", dot: "bg-amber-500 dark:bg-amber-300" },
  destructive: { badge: "bg-red-500/10 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25", dot: "bg-red-500 dark:bg-red-400" },
};

const indicatorConfig: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  neutral: "bg-muted-foreground",
};

const typeColors: Record<string, string> = {
  password: "bg-amber-500/10 text-amber-400 border border-amber-500/25",
  totp: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25",
  note: "bg-muted text-muted-foreground border border-border",
  card: "bg-blue-500/10 text-blue-400 border border-blue-500/25",
  ssh: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/25",
  identity: "bg-violet-500/10 text-violet-400 border border-violet-500/25",
  apiKey: "bg-orange-500/10 text-orange-400 border border-orange-500/25",
  wifi: "bg-sky-500/10 text-sky-400 border border-sky-500/25",
  recoveryCode: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25",
  softwareLicense: "bg-lime-500/10 text-lime-400 border border-lime-500/25",
  databaseCredential: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/25",
  emailAccount: "bg-rose-500/10 text-rose-400 border border-rose-500/25",
  bankAccount: "bg-teal-500/10 text-teal-400 border border-teal-500/25",
  cryptoWallet: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/25",
  domainDns: "bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/25",
  serverHosting: "bg-slate-500/10 text-slate-400 border border-slate-500/25",
};

const strengthColors: Record<string, string> = {
  strong: "text-emerald-400",
  weak: "text-red-400",
  fair: "text-amber-400",
};

interface DashboardProps {
  onNavigate?: (id: string) => void;
  onLock?: () => void;
  onAddItem?: (type?: VaultItem["type"]) => void;
  passwords: VaultItem[];
  totps: VaultItem[];
  notes: VaultItem[];
  cards: VaultItem[];
  sshKeys: VaultItem[];
  identities: VaultItem[];
  apiKeys: VaultItem[];
  wifiNetworks: VaultItem[];
  recoveryCodes: VaultItem[];
  softwareLicenses: VaultItem[];
  databaseCredentials: VaultItem[];
  emailAccounts: VaultItem[];
  bankAccounts: VaultItem[];
  cryptoWallets: VaultItem[];
  domainDnsRecords: VaultItem[];
  serverHostingAccounts: VaultItem[];
  activities: VaultActivity[];
  autoLockSeconds: number;
  autoLockDurationSeconds?: number | null;
  onNavigateSettings?: () => void;
  onExportVault?: () => void;
}

export default function VaultDashboard({
  onNavigate,
  onAddItem,
  passwords,
  totps,
  notes,
  cards,
  sshKeys,
  identities,
  apiKeys,
  wifiNetworks,
  recoveryCodes,
  softwareLicenses,
  databaseCredentials,
  emailAccounts,
  bankAccounts,
  cryptoWallets,
  domainDnsRecords,
  serverHostingAccounts,
  activities,
  autoLockSeconds,
  autoLockDurationSeconds = autoLockSeconds,
  onNavigateSettings,
  onExportVault,
}: DashboardProps) {
  const [hoveredLog, setHoveredLog] = useState<number | null>(null);
  const [copiedItem, setCopiedItem] = useState<number | null>(null);

  const autoLockDisabled = autoLockDurationSeconds === null;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const autoLockDisplay = autoLockDisabled ? "Off" : fmt(autoLockSeconds);
  const isWarning = !autoLockDisabled && autoLockSeconds < 60;

  const handleCopyItem = (id: number, value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedItem(id);
    setTimeout(() => setCopiedItem(null), 1800);
  };

  const totalItems = passwords.length + totps.length + notes.length + cards.length + sshKeys.length + identities.length + apiKeys.length + wifiNetworks.length + recoveryCodes.length + softwareLicenses.length + databaseCredentials.length + emailAccounts.length + bankAccounts.length + cryptoWallets.length + domainDnsRecords.length + serverHostingAccounts.length;
  const weakPasswords = passwords.filter(p => p.strength === "weak").length;
  const expiringCards = cards.filter(c => {
    if (!c.expiry) return false;
    const [m, y] = c.expiry.split("/").map(Number);
    const now = new Date();
    const expDate = new Date(2000 + y, m - 1, 1);
    const diffMonths = (expDate.getFullYear() - now.getFullYear()) * 12 + expDate.getMonth() - now.getMonth();
    return diffMonths <= 3;
  }).length;

  const securityScore = Math.max(40, 100 - (weakPasswords * 10) - (expiringCards * 5));
  const dashboardEvents = activities.slice(0, 7).map((activity) => ({
      ...activity,
      icon: activityIcons[activity.type as keyof typeof activityIcons] ?? ShieldCheck,
    }));
  const lastActivity = dashboardEvents[0];
  const statusPanels = [
    {
      id: "encryption",
      label: "Vault Runtime",
      icon: ShieldCheck,
      statusLabel: "AES-GCM Local Vault",
      detail: "Master-password-derived key - static frontend runtime",
      indicator: "green",
    },
    {
      id: "session",
      label: "Session State",
      icon: LockOpen,
      statusLabel: autoLockDisabled ? "Unlocked - Auto-lock Off" : "Unlocked",
      detail: autoLockDisabled ? "Session active - automatic timeout disabled" : `Session active - auto-lock in ${autoLockDisplay}`,
      indicator: autoLockDisabled ? "neutral" : "amber",
    },
    {
      id: "storage",
      label: "Sync / Storage",
      icon: Database,
      statusLabel: "Encrypted Local Only",
      detail: "No default cloud sync - vault stays encrypted in this browser",
      indicator: "neutral",
    },
    {
      id: "activity",
      label: "Recent Activity",
      icon: Copy,
      statusLabel: activities.length ? `${activities.length} event${activities.length > 1 ? "s" : ""}` : "No events yet",
      detail: lastActivity ? `Last: ${lastActivity.label}` : "Activity appears after vault actions",
      indicator: activities.length ? "amber" : "neutral",
    },
  ];

  // Build recent items from real data
  const recentItems = [
    ...passwords.slice(0, 2).map(p => ({ id: p.id, type: "password" as const, name: p.site ?? "Unknown", user: p.username ?? "", favicon: p.favicon ?? "?", ago: "recently", strength: p.strength, copyValue: p.username ?? p.url ?? "" })),
    ...totps.slice(0, 1).map(t => ({ id: t.id, type: "totp" as const, name: t.issuer ?? "TOTP", user: t.account ?? "", favicon: (t.issuer ?? "T").slice(0, 2).toUpperCase(), ago: "recently", strength: null, copyValue: t.account ?? "" })),
    ...notes.slice(0, 1).map(n => ({ id: n.id, type: "note" as const, name: n.title ?? "Note", user: "Secure note", favicon: "SC", ago: n.updatedAt ?? "recently", strength: null, copyValue: n.preview ?? n.title ?? "" })),
    ...cards.slice(0, 1).map(c => ({ id: c.id, type: "card" as const, name: `${c.brand} ${c.number?.slice(-4) ?? ""}`, user: c.number ?? "****", favicon: "CC", ago: "recently", strength: null, copyValue: c.number ?? "" })),
    ...sshKeys.slice(0, 1).map(s => ({ id: s.id, type: "ssh" as const, name: s.sshName ?? "SSH Key", user: s.sshHost ?? s.sshFingerprint ?? "", favicon: "SH", ago: s.updatedAt ?? "recently", strength: null, copyValue: s.sshPublicKey ?? s.sshHost ?? "" })),
    ...identities.slice(0, 1).map(i => ({ id: i.id, type: "identity" as const, name: i.identityLabel ?? i.fullName ?? "Identity", user: i.email ?? i.phone ?? "", favicon: "ID", ago: i.updatedAt ?? "recently", strength: null, copyValue: i.email ?? i.phone ?? "" })),
    ...apiKeys.slice(0, 1).map(a => ({ id: a.id, type: "apiKey" as const, name: a.apiName ?? "API Key", user: a.apiProvider ?? a.apiScopes ?? "", favicon: "AK", ago: a.updatedAt ?? "recently", strength: null, copyValue: a.apiKey ?? "" })),
    ...wifiNetworks.slice(0, 1).map(w => ({ id: w.id, type: "wifi" as const, name: w.wifiName ?? w.ssid ?? "Wi-Fi", user: w.ssid ?? w.wifiSecurity ?? "", favicon: "WF", ago: w.updatedAt ?? "recently", strength: null, copyValue: w.wifiPassword ?? "" })),
    ...recoveryCodes.slice(0, 1).map(r => ({ id: r.id, type: "recoveryCode" as const, name: r.recoveryName ?? "Recovery Codes", user: r.recoveryService ?? r.recoveryAccount ?? "", favicon: "RC", ago: r.updatedAt ?? "recently", strength: null, copyValue: r.recoveryCodes ?? "" })),
    ...softwareLicenses.slice(0, 1).map(l => ({ id: l.id, type: "softwareLicense" as const, name: l.softwareName ?? "Software License", user: l.softwareVendor ?? l.licenseEmail ?? "", favicon: "SL", ago: l.updatedAt ?? "recently", strength: null, copyValue: l.licenseKey ?? "" })),
    ...databaseCredentials.slice(0, 1).map(d => ({ id: d.id, type: "databaseCredential" as const, name: d.dbName ?? "Database Credential", user: d.dbHost ?? d.dbDatabase ?? d.dbEngine ?? "", favicon: "DB", ago: d.updatedAt ?? "recently", strength: null, copyValue: d.dbConnectionUrl ?? d.dbPassword ?? "" })),
    ...emailAccounts.slice(0, 1).map(e => ({ id: e.id, type: "emailAccount" as const, name: e.emailAccountName ?? e.emailAddress ?? "Email Account", user: e.emailAddress ?? e.emailProvider ?? "", favicon: "EM", ago: e.updatedAt ?? "recently", strength: null, copyValue: e.emailAddress ?? e.emailPassword ?? "" })),
    ...bankAccounts.slice(0, 1).map(b => ({ id: b.id, type: "bankAccount" as const, name: b.bankLabel ?? b.bankName ?? "Bank Account", user: b.bankName ?? b.bankAccountHolder ?? "", favicon: "BK", ago: b.updatedAt ?? "recently", strength: null, copyValue: b.bankAccountNumber ?? b.bankIban ?? "" })),
    ...cryptoWallets.slice(0, 1).map(c => ({ id: c.id, type: "cryptoWallet" as const, name: c.cryptoWalletName ?? "Crypto Wallet", user: c.cryptoNetwork ?? c.cryptoPublicAddress ?? "", favicon: "CW", ago: c.updatedAt ?? "recently", strength: null, copyValue: c.cryptoPublicAddress ?? "" })),
    ...domainDnsRecords.slice(0, 1).map(d => ({ id: d.id, type: "domainDns" as const, name: d.domainName ?? "Domain / DNS", user: d.domainRegistrar ?? d.domainDnsProvider ?? "", favicon: "DN", ago: d.updatedAt ?? "recently", strength: null, copyValue: d.domainName ?? d.domainEppCode ?? "" })),
    ...serverHostingAccounts.slice(0, 1).map(s => ({ id: s.id, type: "serverHosting" as const, name: s.serverName ?? "Server / Hosting", user: s.serverHost ?? s.serverIp ?? s.serverProvider ?? "", favicon: "SV", ago: s.updatedAt ?? "recently", strength: null, copyValue: s.serverHost ?? s.serverPanelUrl ?? "" })),
  ].slice(0, 6);

  const metricCards = [
    { id: "passwords", label: "Passwords", value: passwords.length, icon: Key, status: weakPasswords > 0 ? "warning" : "nominal", sub: weakPasswords > 0 ? `${weakPasswords} weak detected` : "All strong", color: "border-l-amber-500/60" },
    { id: "totp", label: "TOTP Accounts", value: totps.length, icon: Timer, status: "active", sub: "All syncing", color: "border-l-amber-500" },
    { id: "notes", label: "Secure Notes", value: notes.length, icon: Note, status: "nominal", sub: "Encrypted locally", color: "border-l-neutral-700" },
    { id: "cards", label: "Credit Cards", value: cards.length, icon: CreditCard, status: expiringCards > 0 ? "warning" : "nominal", sub: expiringCards > 0 ? `${expiringCards} expiring soon` : "All valid", color: "border-l-amber-400" },
    { id: "dev-secrets", label: "Dev Secrets", value: sshKeys.length + apiKeys.length, icon: Code, status: "nominal", sub: "SSH and API keys", color: "border-l-cyan-500/60" },
    { id: "identity-wifi", label: "Identity / Wi-Fi", value: identities.length + wifiNetworks.length + emailAccounts.length, icon: EnvelopeSimple, status: "nominal", sub: "Profiles, mail, networks", color: "border-l-sky-500/60" },
    { id: "ops-access", label: "Ops Access", value: recoveryCodes.length + softwareLicenses.length + databaseCredentials.length, icon: Database, status: "nominal", sub: "Recovery, license, database", color: "border-l-indigo-500/60" },
    { id: "finance-domain", label: "Finance / Domain", value: bankAccounts.length + cryptoWallets.length + domainDnsRecords.length, icon: Bank, status: "nominal", sub: "Bank, wallet, DNS", color: "border-l-teal-500/60" },
    { id: "servers", label: "Servers", value: serverHostingAccounts.length, icon: Cloud, status: "nominal", sub: "Hosting inventory", color: "border-l-slate-500/60" },
    { id: "export", label: "Backup Export", value: "Manual", icon: HardDrive, status: "nominal", sub: "Encrypted JSON export", color: "border-l-neutral-700" },
    { id: "autolock", label: "Auto-Lock", value: autoLockDisplay, icon: Lock, status: isWarning ? "warning" : "active", sub: autoLockDisabled ? "Disabled" : isWarning ? "Locking soon!" : "Session active", color: isWarning ? "border-l-red-400" : "border-l-emerald-500/60" },
  ];

  return (
    <section className="bg-background min-h-screen text-foreground">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05] z-0 text-border" style={{ backgroundImage: "linear-gradient(to right, hsl(var(--grid-line)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--grid-line)) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Page header */}
        <div className="flex items-center justify-between border-b border-border pb-5">
          <div>
            <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-1">{APP_NAME} - Vault Overview</p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Vault Overview</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 border rounded-sm bg-card ${isWarning ? "border-red-200 dark:border-red-800" : "border-border"}`}>
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isWarning ? "bg-red-500 dark:bg-red-400" : "bg-emerald-500"}`} />
              <span className={`text-xs font-mono ${isWarning ? "text-red-700 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{autoLockDisplay}</span>
            </div>
            <button
              onClick={() => onAddItem?.("password")}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-xs font-mono rounded-sm hover:bg-primary/90 transition-all duration-150"
            >
              <Plus weight="duotone" size={14} />
              <span className="hidden sm:inline">Add Item</span>
            </button>
          </div>
        </div>

        {/* Metric strip */}
        <div>
          <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-3">Item Metrics</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            {metricCards.map((card, idx) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  style={{ animationDelay: `${idx * 0.07}s` }}
                  onClick={() => {
                    if (card.id === "export") onExportVault?.();
                    else onNavigate?.(card.id === "autolock" ? "security-settings" : "item-library");
                  }}
                  className={`animate-fade-in-up relative bg-card border border-border border-l-2 ${card.color} rounded-sm p-4 text-left transition-all duration-200 hover:border-primary hover:shadow-md hover:-translate-y-0.5 group`}
                >
                  {card.status === "warning" && <div className="absolute top-0 left-0 right-0 h-px bg-amber-400/60" />}
                  <div className="flex items-center justify-between mb-3">
                    <Icon weight="duotone" className={`w-4 h-4 ${card.status === "active" ? "text-amber-600 dark:text-amber-400" : card.status === "warning" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`} />
                    {card.status === "warning" && <Warning weight="duotone" className="w-3 h-3 text-amber-700 dark:text-amber-300" />}
                  </div>
                  <div className="text-2xl font-heading font-bold text-foreground mb-0.5">{card.value}</div>
                  <div className="text-xs font-medium text-foreground mb-1.5">{card.label}</div>
                  <p className="text-[11px] text-muted-foreground leading-tight">{card.sub}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick actions and recent items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-3">Quick Actions</p>
            <div className="space-y-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={() => {
                      if (action.action === "add-password") onAddItem?.("password");
                    else if (action.action === "add-totp") onAddItem?.("totp");
                    else if (action.action === "add-ssh") onAddItem?.("ssh");
                    else if (action.action === "add-identity") onAddItem?.("identity");
                    else if (action.action === "add-recovery") onAddItem?.("recoveryCode");
                    else if (action.action === "add-license") onAddItem?.("softwareLicense");
                    else if (action.action === "add-database") onAddItem?.("databaseCredential");
                    else if (action.action === "export") onExportVault?.();
                      else onNavigate?.("generator-tools");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-sm hover:border-primary transition-all duration-150 group text-left"
                  >
                    <div className="w-7 h-7 bg-muted rounded-sm flex items-center justify-center shrink-0">
                      <Icon weight="duotone" size={14} className={action.color} />
                    </div>
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors duration-150 flex-1">{action.label}</span>
                    <ArrowRight weight="duotone" size={13} className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-150" />
                  </button>
                );
              })}
            </div>

            {/* Security Score */}
            <div className="mt-4 bg-card border border-border rounded-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Security Score</span>
                <span className={`text-lg font-bold font-heading ${securityScore >= 80 ? "text-emerald-400" : securityScore >= 60 ? "text-amber-400" : "text-red-400"}`}>{securityScore}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
                <div className={`h-full rounded-full transition-all duration-500 ${securityScore >= 80 ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : securityScore >= 60 ? "bg-gradient-to-r from-amber-500 to-amber-400" : "bg-gradient-to-r from-red-600 to-red-400"}`} style={{ width: `${securityScore}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">
                {weakPasswords > 0 ? `${weakPasswords} weak password${weakPasswords > 1 ? "s" : ""} - ` : ""}
                {expiringCards > 0 ? `${expiringCards} expiring card - ` : ""}
                {totalItems} total items
              </p>
            </div>
          </div>

          {/* Recent Items */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Recent Items</p>
              <button onClick={() => onNavigate?.("item-library")} className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors duration-150">
                View all <ArrowRight weight="duotone" size={12} />
              </button>
            </div>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              {recentItems.length === 0 ? (
                <div className="py-12 text-center">
                  <Vault weight="duotone" size={28} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No items yet</p>
                  <button onClick={() => onAddItem?.("password")} className="mt-3 text-xs font-mono text-amber-400 hover:text-amber-300 transition-colors">+ Add your first item</button>
                </div>
              ) : recentItems.map((item, idx) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-muted transition-all duration-100 ${idx !== recentItems.length - 1 ? "border-b border-border" : ""} group`}
                >
                  <div className="w-8 h-8 rounded-sm bg-muted border border-border flex items-center justify-center shrink-0 text-[10px] font-mono font-bold text-muted-foreground">
                    {item.favicon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                      {item.strength && <span className={`text-[10px] font-mono ${strengthColors[item.strength]}`}>{item.strength}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{item.user}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-sm font-mono ${typeColors[item.type]}`}>{item.type.toUpperCase()}</span>
                    <span className="text-[10px] text-muted-foreground font-mono hidden md:block">{item.ago}</span>
                    <button
                      onClick={() => handleCopyItem(item.id, item.copyValue)}
                      disabled={!item.copyValue}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-muted transition-all duration-150"
                    >
                      {copiedItem === item.id ? <CheckCircle weight="duotone" size={13} className="text-emerald-400" /> : <Copy weight="duotone" size={13} className="text-muted-foreground" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Status matrix */}
        <div>
          <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase mb-3">Status Matrix</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {statusPanels.map((panel) => {
              const Icon = panel.icon;
              const dotColor = indicatorConfig[panel.indicator];
              return (
                <div key={panel.id} className="bg-card border border-border rounded-sm p-4 transition-all duration-150 hover:border-primary group">
                  <div className="flex items-center justify-between mb-2">
                    <Icon weight="duotone" className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                  </div>
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">{panel.label}</p>
                  <p className={`text-xs font-mono font-semibold mb-2 ${panel.indicator === "amber" ? "text-amber-700 dark:text-amber-400" : panel.indicator === "green" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>{panel.statusLabel}</p>
                  <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">{panel.detail}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Event log */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Event Log - Today</p>
            <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
              <ClockCounterClockwise weight="duotone" className="w-3 h-3" />
              <span>{dashboardEvents.length} events</span>
            </div>
          </div>
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-0 border-b border-border bg-muted px-4 py-2">
              <div className="col-span-1 text-xs font-mono text-muted-foreground uppercase">#</div>
              <div className="col-span-2 text-xs font-mono text-muted-foreground uppercase">Time</div>
              <div className="col-span-2 text-xs font-mono text-muted-foreground uppercase hidden sm:block">Type</div>
              <div className="col-span-5 sm:col-span-4 text-xs font-mono text-muted-foreground uppercase">Event</div>
              <div className="col-span-3 text-xs font-mono text-muted-foreground uppercase hidden md:block">Detail</div>
            </div>
            <div className="divide-y divide-border">
              {dashboardEvents.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <ClockCounterClockwise weight="duotone" className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">No activity yet</p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">Vault events appear here after unlock, add, edit, copy, import, or export actions.</p>
                </div>
              ) : dashboardEvents.map((entry, idx) => {
                const Icon = entry.icon;
                const cfg = severityConfig[entry.severity] ?? severityConfig.info;
                const isHovered = hoveredLog === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={`grid grid-cols-12 gap-0 px-4 py-3 transition-all duration-100 cursor-default border-l-2 ${isHovered ? `${entry.severity === "amber" || entry.severity === "warning" ? "border-l-amber-400 dark:border-l-amber-500" : entry.severity === "destructive" ? "border-l-red-400 dark:border-l-red-500" : "border-l-primary"} bg-muted` : "border-l-transparent"}`}
                    onMouseEnter={() => setHoveredLog(entry.id)}
                    onMouseLeave={() => setHoveredLog(null)}
                  >
                    <div className="col-span-1 flex items-center"><span className="text-xs font-mono text-muted-foreground">{String(idx + 1).padStart(2, "0")}</span></div>
                    <div className="col-span-2 flex items-center"><span className="text-xs font-mono text-muted-foreground">{entry.time}</span></div>
                    <div className="col-span-2 items-center hidden sm:flex">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs font-mono border ${cfg.badge}`}>
                        <span className={`w-1 h-1 rounded-full ${cfg.dot}`} />{entry.type}
                      </span>
                    </div>
                    <div className="col-span-5 sm:col-span-4 flex items-center gap-2">
                      <Icon weight="duotone" className={`w-3.5 h-3.5 flex-shrink-0 ${entry.severity === "amber" || entry.severity === "warning" ? "text-amber-700 dark:text-amber-400" : entry.severity === "destructive" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
                      <span className="text-xs font-medium text-foreground">{entry.label}</span>
                    </div>
                    <div className="col-span-3 items-center hidden md:flex"><span className="text-xs font-mono text-muted-foreground truncate">{entry.detail}</span></div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-border px-4 py-2.5 bg-muted flex items-center justify-between">
              <span className="text-xs font-mono text-muted-foreground">{dashboardEvents.length} events - Encrypted session</span>
              <button onClick={onNavigateSettings} className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
                View settings <ArrowRight weight="duotone" className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Auto-lock state */}
        <div className={`border rounded-sm px-4 py-3 flex items-center justify-between transition-colors duration-300 ${autoLockDisabled ? "border-border bg-card" : isWarning ? "border-red-200 bg-red-500/10 dark:border-red-800 dark:bg-red-950/30" : "border-amber-200 bg-amber-500/10 dark:border-amber-800 dark:bg-amber-950/30"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-0.5 h-8 rounded-full flex-shrink-0 ${autoLockDisabled ? "bg-muted-foreground" : isWarning ? "bg-red-500 dark:bg-red-400" : "bg-amber-500 dark:bg-amber-400"}`} />
            <div>
              <p className={`text-xs font-mono font-semibold tracking-wider uppercase ${autoLockDisabled ? "text-muted-foreground" : isWarning ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{autoLockDisabled ? "Auto-Lock Disabled" : isWarning ? "Locking Soon!" : "Auto-Lock Warning"}</p>
              <p className={`text-xs font-mono mt-0.5 ${autoLockDisabled ? "text-muted-foreground" : isWarning ? "text-red-700/85 dark:text-red-300" : "text-amber-800/85 dark:text-amber-300"}`}>
                {autoLockDisabled ? "Vault tetap terbuka sampai kamu lock manual." : <>Vault akan terkunci dalam <span className="font-bold">{autoLockDisplay}</span> - gerak mouse untuk reset</>}
              </p>
            </div>
          </div>
          <button onClick={onNavigateSettings} className={`hidden sm:flex items-center gap-1.5 text-xs font-mono border px-3 py-1.5 rounded-sm transition-all duration-150 ${autoLockDisabled ? "text-muted-foreground border-border hover:border-primary hover:bg-muted" : isWarning ? "text-red-700 border-red-300 hover:border-red-400 hover:bg-red-500/10 dark:text-red-400 dark:border-red-800 dark:hover:border-red-600 dark:hover:bg-red-950/40" : "text-amber-700 border-amber-300 hover:border-amber-400 hover:bg-amber-500/10 dark:text-amber-400 dark:border-amber-800 dark:hover:border-amber-600 dark:hover:bg-amber-950/40"}`}>
            Settings <ArrowRight weight="duotone" className="w-3 h-3" />
          </button>
        </div>
      </div>
    </section>
  );
}









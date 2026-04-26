import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  MagnifyingGlass,
  Plus,
  Copy,
  Eye,
  EyeSlash,
  PencilSimple,
  Trash,
  Key,
  Note,
  CreditCard,
  Timer,
  Check,
  FunnelSimple,
  ShieldCheck,
  TerminalWindow,
  IdentificationCard,
  Code,
  WifiHigh,
  Lifebuoy,
  Certificate,
  Database,
} from "@phosphor-icons/react";
import type { VaultItem } from "./ItemModal";
import type { TotpState } from "../hooks/useVaultStore";

const filterOptions = ["All", "Password", "TOTP", "Note", "Card", "SSH", "Identity", "API", "Wi-Fi", "Recovery", "License", "Database"];

const strengthMap: Record<string, { label: string; color: string; bar: string }> = {
  strong: { label: "Strong", color: "text-emerald-400", bar: "bg-emerald-500 w-full" },
  fair: { label: "Fair", color: "text-amber-400", bar: "bg-amber-500 w-2/3" },
  weak: { label: "Weak", color: "text-red-400", bar: "bg-red-500 w-1/3" },
};

function maskPassword(pw: string) { return "*".repeat(Math.min(pw.length, 20)); }

function TimerRing({ secondsLeft, hasError = false }: { secondsLeft: number; hasError?: boolean }) {
  const pct = (secondsLeft / 30) * 100;
  const isUrgent = !hasError && secondsLeft <= 8;
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative w-5 h-5">
        <svg viewBox="0 0 20 20" className="w-5 h-5 -rotate-90">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" />
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2"
            strokeDasharray={`${2 * Math.PI * 8}`}
            strokeDashoffset={`${2 * Math.PI * 8 * (1 - pct / 100)}`}
            className={hasError ? "stroke-red-400" : isUrgent ? "stroke-amber-400" : "stroke-primary"}
            strokeLinecap="butt"
          />
        </svg>
      </div>
      <span className={`text-xs font-mono font-semibold tabular-nums ${hasError ? "text-red-400" : isUrgent ? "text-amber-400" : "text-muted-foreground"}`}>
        {hasError ? "ERR" : `${secondsLeft}s`}
      </span>
    </div>
  );
}

function CopyButton({ value, label, disabled = false }: { value: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (disabled) return;
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={handleCopy}
      disabled={disabled}
      title={disabled ? `${label ?? "Value"} unavailable` : `Copy ${label ?? ""}`}
      className={`p-1.5 rounded transition-all duration-150 ${disabled ? "text-muted-foreground/40 cursor-not-allowed" : copied ? "text-amber-400 bg-amber-400/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
    >
      {copied ? <Check size={14} weight="duotone" /> : <Copy size={14} weight="duotone" />}
    </button>
  );
}

function PasswordCard({ item, onEdit, onDelete }: { item: VaultItem; onEdit: (i: VaultItem) => void; onDelete: (id: number, type: string, name: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  const str = strengthMap[item.strength ?? "fair"] ?? strengthMap.fair;
  return (
    <Card className="bg-card border border-border rounded-sm hover:border-primary transition-all duration-200 group relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border group-hover:bg-primary transition-colors duration-200" />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-sm bg-muted flex items-center justify-center flex-shrink-0 text-[10px] font-mono font-bold text-muted-foreground">{item.favicon}</div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-heading font-semibold text-foreground truncate">{item.site}</CardTitle>
              <p className="text-xs text-muted-foreground truncate">{item.url}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`text-[9px] font-mono ${str.color}`}>{str.label}</span>
            <Badge className="bg-muted text-muted-foreground border-0 text-[10px] px-1.5 py-0.5 rounded-sm font-mono">PWD</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <div className="h-0.5 bg-muted rounded-full overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all duration-300 ${str.bar}`} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 bg-muted/40 rounded-sm px-2.5 py-1.5">
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Username</p>
              <p className="text-xs text-foreground font-mono truncate">{item.username}</p>
            </div>
            <CopyButton value={item.username ?? ""} label="username" />
          </div>
          <div className="flex items-center justify-between gap-2 bg-muted/40 rounded-sm px-2.5 py-1.5">
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Password</p>
              <p className="text-xs text-foreground font-mono truncate">{revealed ? item.password : maskPassword(item.password ?? "")}</p>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button onClick={() => setRevealed(r => !r)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
                {revealed ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
              </button>
              <CopyButton value={item.password ?? ""} label="password" />
            </div>
          </div>
        </div>
        {item.notes && <p className="text-[11px] text-muted-foreground px-0.5 truncate">{item.notes}</p>}
        <div className="flex items-center justify-end gap-1 pt-1 border-t border-border">
          <button onClick={() => onEdit(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"><PencilSimple size={13} weight="duotone" /></button>
          <button onClick={() => onDelete(item.id, item.type, item.site ?? "Item")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"><Trash size={13} weight="duotone" /></button>
        </div>
      </CardContent>
    </Card>
  );
}

function TOTPCard({ item, totpState, onEdit, onDelete }: { item: VaultItem; totpState?: TotpState; onEdit: (i: VaultItem) => void; onDelete: (id: number, type: string, name: string) => void }) {
  const secondsLeft = totpState?.secondsLeft ?? 30;
  const code = totpState?.code ?? "--- ---";
  const hasError = !!totpState?.error;
  const isUrgent = !hasError && secondsLeft <= 8;
  const displayCode = hasError ? "INVALID" : code;
  return (
    <Card className={`bg-card border rounded-sm transition-all duration-200 group relative overflow-hidden ${hasError ? "border-red-400/50 hover:border-red-400" : isUrgent ? "border-amber-400/50 hover:border-amber-400" : "border-border hover:border-primary"}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 transition-colors duration-150 ${hasError ? "bg-red-400" : isUrgent ? "bg-amber-400" : "bg-border group-hover:bg-primary"}`} />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-sm bg-muted flex items-center justify-center flex-shrink-0">
              <Timer size={14} weight="duotone" className={hasError ? "text-red-400" : isUrgent ? "text-amber-400" : "text-muted-foreground"} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-heading font-semibold text-foreground truncate">{item.issuer}</CardTitle>
              <p className="text-xs text-muted-foreground truncate">{item.account}</p>
            </div>
          </div>
          <Badge className={`border-0 text-[10px] px-1.5 py-0.5 rounded-sm font-mono flex-shrink-0 ${hasError ? "bg-red-400/15 text-red-400" : isUrgent ? "bg-amber-400/15 text-amber-400" : "bg-muted text-muted-foreground"}`}>TOTP</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <div className="bg-muted/40 rounded-sm px-2.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{hasError ? "Secret Error" : "Live Code"}</p>
              <p className={`text-xl font-mono font-bold tracking-[0.2em] ${hasError ? "text-red-400 tracking-wider" : isUrgent ? "text-amber-400" : "text-foreground"}`}>{displayCode}</p>
              {hasError && <p className="text-[10px] text-red-400/80 font-mono mt-1">{totpState?.error}</p>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <TimerRing secondsLeft={secondsLeft} hasError={hasError} />
              <CopyButton value={code.replace(" ", "")} label="code" disabled={hasError} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 pt-1 border-t border-border">
          <button onClick={() => onEdit(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"><PencilSimple size={13} weight="duotone" /></button>
          <button onClick={() => onDelete(item.id, item.type, item.issuer ?? "TOTP")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"><Trash size={13} weight="duotone" /></button>
        </div>
      </CardContent>
    </Card>
  );
}

function NoteCard({ item, onEdit, onDelete }: { item: VaultItem; onEdit: (i: VaultItem) => void; onDelete: (id: number, type: string, name: string) => void }) {
  return (
    <Card className="bg-card border border-border rounded-sm hover:border-primary transition-all duration-200 group relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border group-hover:bg-primary transition-colors duration-200" />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-sm bg-muted flex items-center justify-center flex-shrink-0"><Note size={14} weight="duotone" className="text-muted-foreground" /></div>
            <CardTitle className="text-sm font-heading font-semibold text-foreground truncate">{item.title}</CardTitle>
          </div>
          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] px-1.5 py-0.5 rounded-sm font-mono flex-shrink-0">NOTE</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <div className="bg-muted/40 rounded-sm px-2.5 py-2">
          <p className="text-xs text-muted-foreground font-mono leading-relaxed line-clamp-2">{item.preview}</p>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-[10px] text-muted-foreground">Updated {item.updatedAt}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"><PencilSimple size={13} weight="duotone" /></button>
            <button onClick={() => onDelete(item.id, item.type, item.title ?? "Note")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"><Trash size={13} weight="duotone" /></button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreditCardCard({ item, onEdit, onDelete }: { item: VaultItem; onEdit: (i: VaultItem) => void; onDelete: (id: number, type: string, name: string) => void }) {
  const [cvvRevealed, setCvvRevealed] = useState(false);
  const isExpiring = (() => {
    if (!item.expiry) return false;
    const [m, y] = item.expiry.split("/").map(Number);
    const now = new Date();
    const expDate = new Date(2000 + y, m - 1, 1);
    const diffMonths = (expDate.getFullYear() - now.getFullYear()) * 12 + expDate.getMonth() - now.getMonth();
    return diffMonths <= 3;
  })();
  return (
    <Card className={`bg-card border rounded-sm transition-all duration-200 group relative overflow-hidden ${isExpiring ? "border-amber-500/40 hover:border-amber-500" : "border-border hover:border-primary"}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 transition-colors duration-200 ${isExpiring ? "bg-amber-500/60 group-hover:bg-amber-500" : "bg-border group-hover:bg-primary"}`} />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-sm bg-muted flex items-center justify-center flex-shrink-0"><CreditCard size={14} weight="duotone" className="text-muted-foreground" /></div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-heading font-semibold text-foreground truncate">{item.brand}</CardTitle>
              <p className="text-xs text-muted-foreground truncate">{item.cardholder}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isExpiring && <span className="text-[9px] font-mono text-amber-400">Expiring</span>}
            <Badge className="bg-muted text-muted-foreground border-0 text-[10px] px-1.5 py-0.5 rounded-sm font-mono flex-shrink-0">CARD</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <div className="flex items-center justify-between gap-2 bg-muted/40 rounded-sm px-2.5 py-1.5">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Card Number</p>
            <p className="text-xs text-foreground font-mono tracking-widest">{item.number}</p>
          </div>
          <CopyButton value={item.number ?? ""} label="number" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-muted/40 rounded-sm px-2.5 py-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Expiry</p>
            <p className={`text-xs font-mono ${isExpiring ? "text-amber-400" : "text-foreground"}`}>{item.expiry}</p>
          </div>
          <div className="flex items-center justify-between gap-1 bg-muted/40 rounded-sm px-2.5 py-1.5">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">CVV</p>
              <p className="text-xs text-foreground font-mono">{cvvRevealed ? (item.cvv ?? "***") : "***"}</p>
            </div>
            <button onClick={() => setCvvRevealed(r => !r)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
              {cvvRevealed ? <EyeSlash size={12} weight="duotone" /> : <Eye size={12} weight="duotone" />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 pt-1 border-t border-border">
          <button onClick={() => onEdit(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"><PencilSimple size={13} weight="duotone" /></button>
          <button onClick={() => onDelete(item.id, item.type, `${item.brand} ${item.number?.slice(-4)}`)} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"><Trash size={13} weight="duotone" /></button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecretItemCard({
  item,
  icon: Icon,
  title,
  subtitle,
  badge,
  secretLabel,
  secretValue,
  accent = "border-border group-hover:bg-primary",
  onEdit,
  onDelete,
}: {
  item: VaultItem;
  icon: typeof Key;
  title: string;
  subtitle: string;
  badge: string;
  secretLabel: string;
  secretValue?: string;
  accent?: string;
  onEdit: (i: VaultItem) => void;
  onDelete: (id: number, type: string, name: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Card className="bg-card border border-border rounded-sm hover:border-primary transition-all duration-200 group relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 transition-colors duration-200 ${accent}`} />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-sm bg-muted flex items-center justify-center flex-shrink-0"><Icon size={14} weight="duotone" className="text-muted-foreground" /></div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-heading font-semibold text-foreground truncate">{title}</CardTitle>
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            </div>
          </div>
          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] px-1.5 py-0.5 rounded-sm font-mono flex-shrink-0">{badge}</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <div className="flex items-center justify-between gap-2 bg-muted/40 rounded-sm px-2.5 py-1.5">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{secretLabel}</p>
            <p className="text-xs text-foreground font-mono truncate">{revealed ? (secretValue || "-") : secretValue ? "*".repeat(Math.min(secretValue.length, 18)) : "-"}</p>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={() => setRevealed((current) => !current)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150">
              {revealed ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
            </button>
            <CopyButton value={secretValue ?? ""} label={secretLabel.toLowerCase()} disabled={!secretValue} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 pt-1 border-t border-border">
          <button onClick={() => onEdit(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"><PencilSimple size={13} weight="duotone" /></button>
          <button onClick={() => onDelete(item.id, item.type, title)} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"><Trash size={13} weight="duotone" /></button>
        </div>
      </CardContent>
    </Card>
  );
}

function IdentityCard({ item, onEdit, onDelete }: { item: VaultItem; onEdit: (i: VaultItem) => void; onDelete: (id: number, type: string, name: string) => void }) {
  return (
    <Card className="bg-card border border-border rounded-sm hover:border-primary transition-all duration-200 group relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-border group-hover:bg-primary transition-colors duration-200" />
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-sm bg-muted flex items-center justify-center flex-shrink-0"><IdentificationCard size={14} weight="duotone" className="text-muted-foreground" /></div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-heading font-semibold text-foreground truncate">{item.identityLabel || item.fullName}</CardTitle>
              <p className="text-xs text-muted-foreground truncate">{item.fullName}</p>
            </div>
          </div>
          <Badge className="bg-muted text-muted-foreground border-0 text-[10px] px-1.5 py-0.5 rounded-sm font-mono flex-shrink-0">ID</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-muted/40 rounded-sm px-2.5 py-1.5 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Email</p>
            <p className="text-xs text-foreground font-mono truncate">{item.email || "-"}</p>
          </div>
          <div className="bg-muted/40 rounded-sm px-2.5 py-1.5 min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Phone</p>
            <p className="text-xs text-foreground font-mono truncate">{item.phone || "-"}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 pt-1 border-t border-border">
          <button onClick={() => onEdit(item)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"><PencilSimple size={13} weight="duotone" /></button>
          <button onClick={() => onDelete(item.id, item.type, item.identityLabel ?? item.fullName ?? "Identity")} className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"><Trash size={13} weight="duotone" /></button>
        </div>
      </CardContent>
    </Card>
  );
}

interface ItemLibraryProps {
  onNavigate?: (id: string) => void;
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
  totpStates: Record<number, TotpState>;
  onAddItem: () => void;
  onEditItem: (item: VaultItem) => void;
  onDeleteItem: (id: number, type: string, name: string) => void;
  autoLockSeconds: number | null;
  externalSearch?: string;
  onClearExternalSearch?: () => void;
}

export default function ItemLibrary({
  onNavigate,
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
  totpStates,
  onAddItem,
  onEditItem,
  onDeleteItem,
  autoLockSeconds,
  externalSearch = "",
  onClearExternalSearch,
}: ItemLibraryProps) {
  const [localSearch, setLocalSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");

  // Sync external search (from topbar) into local state
  useEffect(() => {
    if (externalSearch) setLocalSearch(externalSearch);
  }, [externalSearch]);

  const search = localSearch;

  const handleSearchChange = (v: string) => {
    setLocalSearch(v);
    if (!v && onClearExternalSearch) onClearExternalSearch();
  };

  const totalItems = passwords.length + totps.length + notes.length + cards.length + sshKeys.length + identities.length + apiKeys.length + wifiNetworks.length + recoveryCodes.length + softwareLicenses.length + databaseCredentials.length;
  const fmt = (s: number | null) => s === null ? "off" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const filterPassword = (item: VaultItem) =>
    !search || (item.site?.toLowerCase().includes(search.toLowerCase()) ?? false) || (item.username?.toLowerCase().includes(search.toLowerCase()) ?? false);
  const filterTotp = (item: VaultItem) =>
    !search || (item.issuer?.toLowerCase().includes(search.toLowerCase()) ?? false) || (item.account?.toLowerCase().includes(search.toLowerCase()) ?? false);
  const filterNote = (item: VaultItem) =>
    !search || (item.title?.toLowerCase().includes(search.toLowerCase()) ?? false);
  const filterCard = (item: VaultItem) =>
    !search || (item.brand?.toLowerCase().includes(search.toLowerCase()) ?? false) || (item.cardholder?.toLowerCase().includes(search.toLowerCase()) ?? false);
  const filterSsh = (item: VaultItem) =>
    !search || [item.sshName, item.sshUsername, item.sshHost, item.sshFingerprint].some((value) => value?.toLowerCase().includes(search.toLowerCase()));
  const filterIdentity = (item: VaultItem) =>
    !search || [item.identityLabel, item.fullName, item.email, item.phone, item.company, item.documentId].some((value) => value?.toLowerCase().includes(search.toLowerCase()));
  const filterApiKey = (item: VaultItem) =>
    !search || [item.apiName, item.apiProvider, item.apiScopes].some((value) => value?.toLowerCase().includes(search.toLowerCase()));
  const filterWifi = (item: VaultItem) =>
    !search || [item.wifiName, item.ssid, item.wifiSecurity, item.wifiNotes].some((value) => value?.toLowerCase().includes(search.toLowerCase()));
  const filterRecoveryCode = (item: VaultItem) =>
    !search || [item.recoveryName, item.recoveryService, item.recoveryAccount, item.recoveryNotes].some((value) => value?.toLowerCase().includes(search.toLowerCase()));
  const filterSoftwareLicense = (item: VaultItem) =>
    !search || [item.softwareName, item.softwareVendor, item.licenseEmail, item.licenseSeats, item.licenseExpiry, item.licenseNotes].some((value) => value?.toLowerCase().includes(search.toLowerCase()));
  const filterDatabaseCredential = (item: VaultItem) =>
    !search || [item.dbName, item.dbEngine, item.dbHost, item.dbDatabase, item.dbUsername, item.dbNotes].some((value) => value?.toLowerCase().includes(search.toLowerCase()));

  const showPasswords = activeFilter === "All" || activeFilter === "Password";
  const showTOTP = activeFilter === "All" || activeFilter === "TOTP";
  const showNotes = activeFilter === "All" || activeFilter === "Note";
  const showCards = activeFilter === "All" || activeFilter === "Card";
  const showSsh = activeFilter === "All" || activeFilter === "SSH";
  const showIdentities = activeFilter === "All" || activeFilter === "Identity";
  const showApiKeys = activeFilter === "All" || activeFilter === "API";
  const showWifi = activeFilter === "All" || activeFilter === "Wi-Fi";
  const showRecoveryCodes = activeFilter === "All" || activeFilter === "Recovery";
  const showSoftwareLicenses = activeFilter === "All" || activeFilter === "License";
  const showDatabaseCredentials = activeFilter === "All" || activeFilter === "Database";

  const filteredPwd = passwords.filter(filterPassword);
  const filteredTotp = totps.filter(filterTotp);
  const filteredNote = notes.filter(filterNote);
  const filteredCard = cards.filter(filterCard);
  const filteredSsh = sshKeys.filter(filterSsh);
  const filteredIdentity = identities.filter(filterIdentity);
  const filteredApiKey = apiKeys.filter(filterApiKey);
  const filteredWifi = wifiNetworks.filter(filterWifi);
  const filteredRecoveryCode = recoveryCodes.filter(filterRecoveryCode);
  const filteredSoftwareLicense = softwareLicenses.filter(filterSoftwareLicense);
  const filteredDatabaseCredential = databaseCredentials.filter(filterDatabaseCredential);
  const noResults = !filteredPwd.length && !filteredTotp.length && !filteredNote.length && !filteredCard.length && !filteredSsh.length && !filteredIdentity.length && !filteredApiKey.length && !filteredWifi.length && !filteredRecoveryCode.length && !filteredSoftwareLicense.length && !filteredDatabaseCredential.length;

  return (
    <section className="bg-background min-h-screen py-8 px-4 md:px-8 relative">
      <div className="absolute inset-0 pointer-events-none opacity-[0.05] text-border" style={{ backgroundImage: "linear-gradient(to right, hsl(var(--grid-line)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--grid-line)) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-5 bg-primary rounded-sm" />
              <h2 className="text-lg font-heading font-bold text-foreground tracking-tight">Vault Library</h2>
            </div>
            <p className="text-xs text-muted-foreground ml-3 font-mono">{totalItems} items stored in this browser</p>
          </div>
          <button onClick={() => onAddItem()} className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-sm hover:opacity-90 px-3 py-2 text-xs font-semibold flex-shrink-0">
            <Plus size={14} weight="duotone" />
            Add Item
          </button>
        </div>

        {/* Utility row */}
        <div className="flex flex-col sm:flex-row gap-2 mb-6">
          <div className="relative flex-1">
            <MagnifyingGlass size={14} weight="duotone" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search vault items..."
              className="pl-8 bg-card border-border rounded-sm text-sm placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary h-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 bg-card border border-border rounded-sm p-1">
            <FunnelSimple size={12} weight="duotone" className="text-muted-foreground ml-1 flex-shrink-0" />
            {filterOptions.map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-2.5 py-1 text-xs font-mono rounded-sm transition-all duration-150 ${activeFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              >{f}</button>
            ))}
          </div>
        </div>

        {/* passwords */}
        {showPasswords && filteredPwd.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Key size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Passwords</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredPwd.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredPwd.map(item => <PasswordCard key={item.id} item={item} onEdit={onEditItem} onDelete={onDeleteItem} />)}
            </div>
          </div>
        )}

        {/* TOTPs */}
        {showTOTP && filteredTotp.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Timer size={13} weight="duotone" className="text-amber-400" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">TOTP Authenticator</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredTotp.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredTotp.map(item => <TOTPCard key={item.id} item={item} totpState={totpStates[item.id]} onEdit={onEditItem} onDelete={onDeleteItem} />)}
            </div>
          </div>
        )}

        {/* Notes */}
        {showNotes && filteredNote.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Note size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Secure Notes</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredNote.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredNote.map(item => <NoteCard key={item.id} item={item} onEdit={onEditItem} onDelete={onDeleteItem} />)}
            </div>
          </div>
        )}

        {/* Cards */}
        {showCards && filteredCard.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Credit Cards</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredCard.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredCard.map(item => <CreditCardCard key={item.id} item={item} onEdit={onEditItem} onDelete={onDeleteItem} />)}
            </div>
          </div>
        )}

        {/* SSH Keys */}
        {showSsh && filteredSsh.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <TerminalWindow size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">SSH Keys</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredSsh.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredSsh.map(item => (
                <SecretItemCard
                  key={item.id}
                  item={item}
                  icon={TerminalWindow}
                  title={item.sshName ?? "SSH Key"}
                  subtitle={[item.sshUsername, item.sshHost].filter(Boolean).join("@") || item.sshFingerprint || "Private key"}
                  badge="SSH"
                  secretLabel="Private Key"
                  secretValue={item.sshPrivateKey}
                  accent="bg-border group-hover:bg-cyan-400"
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          </div>
        )}

        {/* Identities */}
        {showIdentities && filteredIdentity.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <IdentificationCard size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Identities</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredIdentity.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredIdentity.map(item => <IdentityCard key={item.id} item={item} onEdit={onEditItem} onDelete={onDeleteItem} />)}
            </div>
          </div>
        )}

        {/* API Keys */}
        {showApiKeys && filteredApiKey.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Code size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">API Keys</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredApiKey.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredApiKey.map(item => (
                <SecretItemCard
                  key={item.id}
                  item={item}
                  icon={Code}
                  title={item.apiName ?? "API Key"}
                  subtitle={item.apiProvider || item.apiScopes || "Token"}
                  badge="API"
                  secretLabel="Token"
                  secretValue={item.apiKey}
                  accent="bg-border group-hover:bg-orange-400"
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          </div>
        )}

        {/* Wi-Fi Networks */}
        {showWifi && filteredWifi.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <WifiHigh size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Wi-Fi Networks</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredWifi.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredWifi.map(item => (
                <SecretItemCard
                  key={item.id}
                  item={item}
                  icon={WifiHigh}
                  title={item.wifiName || item.ssid || "Wi-Fi Network"}
                  subtitle={[item.ssid, item.wifiSecurity].filter(Boolean).join(" - ")}
                  badge="WIFI"
                  secretLabel="Password"
                  secretValue={item.wifiPassword}
                  accent="bg-border group-hover:bg-sky-400"
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recovery Codes */}
        {showRecoveryCodes && filteredRecoveryCode.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Lifebuoy size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Recovery Codes</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredRecoveryCode.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredRecoveryCode.map(item => (
                <SecretItemCard
                  key={item.id}
                  item={item}
                  icon={Lifebuoy}
                  title={item.recoveryName ?? "Recovery Codes"}
                  subtitle={[item.recoveryService, item.recoveryAccount].filter(Boolean).join(" - ") || "One-time backup codes"}
                  badge="REC"
                  secretLabel="Codes"
                  secretValue={item.recoveryCodes}
                  accent="bg-border group-hover:bg-emerald-400"
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          </div>
        )}

        {/* Software Licenses */}
        {showSoftwareLicenses && filteredSoftwareLicense.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Certificate size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Software Licenses</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredSoftwareLicense.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredSoftwareLicense.map(item => (
                <SecretItemCard
                  key={item.id}
                  item={item}
                  icon={Certificate}
                  title={item.softwareName ?? "Software License"}
                  subtitle={[item.softwareVendor, item.licenseEmail].filter(Boolean).join(" - ") || item.licenseExpiry || "License key"}
                  badge="LIC"
                  secretLabel="License Key"
                  secretValue={item.licenseKey}
                  accent="bg-border group-hover:bg-lime-400"
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          </div>
        )}

        {/* Database Credentials */}
        {showDatabaseCredentials && filteredDatabaseCredential.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Database size={13} weight="duotone" className="text-muted-foreground" />
              <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Database Credentials</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] font-mono text-muted-foreground">{filteredDatabaseCredential.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredDatabaseCredential.map(item => (
                <SecretItemCard
                  key={item.id}
                  item={item}
                  icon={Database}
                  title={item.dbName ?? "Database Credential"}
                  subtitle={[item.dbEngine, item.dbHost, item.dbDatabase, item.dbUsername].filter(Boolean).join(" - ") || "Database access"}
                  badge="DB"
                  secretLabel={item.dbConnectionUrl ? "Connection URL" : "Password"}
                  secretValue={item.dbConnectionUrl || item.dbPassword}
                  accent="bg-border group-hover:bg-indigo-400"
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty vault */}
        {totalItems === 0 && !search && (
          <div className="py-20 text-center">
            <ShieldCheck size={40} weight="duotone" className="text-muted-foreground mx-auto mb-4" />
            <p className="text-base font-heading font-semibold text-foreground mb-2">Your vault is empty</p>
            <p className="text-sm text-muted-foreground mb-6">Add your first item to get started.</p>
            <button onClick={() => onAddItem()} className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-neutral-950 font-mono font-bold text-sm rounded-sm hover:bg-amber-400 transition-all duration-150">
              <Plus size={16} weight="duotone" /> Add First Item
            </button>
          </div>
        )}

        {/* No search results */}
        {search && noResults && (
          <div className="py-16 text-center">
            <MagnifyingGlass size={32} weight="duotone" className="text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">No results for &#34;{search}&#34;</p>
            <p className="text-xs text-muted-foreground">Try a different search term or clear your filter.</p>
          </div>
        )}

        {/* Footer strip */}
        <div className="mt-8 border-t border-border pt-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck weight="duotone" size={13} className="text-emerald-500" />
            <span className="text-[10px] font-mono text-muted-foreground">Encrypted local vault - Auto-lock {fmt(autoLockSeconds)}</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">Local browser only</span>
        </div>
      </div>
    </section>
  );
}

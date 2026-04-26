import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { EXPORT_VERSION } from "../lib/app-config";
import { generateSecurePassword } from "../lib/secure-random";
import {
  Password,
  Key,
  Note,
  CreditCard,
  Copy,
  Eye,
  EyeSlash,
  ArrowsClockwise,
  DownloadSimple,
  CheckCircle,
  Lock,
  Globe,
  Timer,
  ShieldCheck,
  Sliders,
  Lightning,
  FileText,
  Export,
  Warning,
  PencilSimple,
  Trash,
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

const typeIcons: Record<string, React.ReactNode> = {
  password: <Password weight="duotone" size={14} />,
  totp: <Timer weight="duotone" size={14} />,
  note: <Note weight="duotone" size={14} />,
  card: <CreditCard weight="duotone" size={14} />,
  ssh: <TerminalWindow weight="duotone" size={14} />,
  identity: <IdentificationCard weight="duotone" size={14} />,
  apiKey: <Code weight="duotone" size={14} />,
  wifi: <WifiHigh weight="duotone" size={14} />,
  recoveryCode: <Lifebuoy weight="duotone" size={14} />,
  softwareLicense: <Certificate weight="duotone" size={14} />,
  databaseCredential: <Database weight="duotone" size={14} />,
};

const typeBadgeClass: Record<string, string> = {
  password: "border-amber-600/50 text-amber-400",
  totp: "border-emerald-600/50 text-emerald-400",
  note: "border-border text-muted-foreground",
  card: "border-blue-600/50 text-blue-400",
  ssh: "border-cyan-600/50 text-cyan-400",
  identity: "border-violet-600/50 text-violet-400",
  apiKey: "border-orange-600/50 text-orange-400",
  wifi: "border-sky-600/50 text-sky-400",
  recoveryCode: "border-emerald-600/50 text-emerald-400",
  softwareLicense: "border-lime-600/50 text-lime-400",
  databaseCredential: "border-indigo-600/50 text-indigo-400",
};

const typeLabels: Record<string, string> = {
  password: "Password",
  totp: "TOTP",
  note: "Secure Note",
  card: "Credit Card",
  ssh: "SSH Key",
  identity: "Identity",
  apiKey: "API Key",
  wifi: "Wi-Fi",
  recoveryCode: "Recovery Codes",
  softwareLicense: "Software License",
  databaseCredential: "Database Credential",
};

function generatePassword(opts: {
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
}) {
  return generateSecurePassword(opts);
}

function getPasswordStrength(pwd: string): {
  label: string;
  level: number;
  color: string;
} {
  if (!pwd) return { label: "None", level: 0, color: "bg-muted" };
  let score = 0;
  if (pwd.length >= 12) score++;
  if (pwd.length >= 20) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 2) return { label: "Weak", level: 1, color: "bg-red-600" };
  if (score <= 4) return { label: "Fair", level: 2, color: "bg-amber-500" };
  if (score <= 5) return { label: "Strong", level: 3, color: "bg-emerald-500" };
  return { label: "Very Strong", level: 4, color: "bg-emerald-400" };
}

interface GeneratorToolsProps {
  passwords?: VaultItem[];
  totps?: VaultItem[];
  notes?: VaultItem[];
  cards?: VaultItem[];
  sshKeys?: VaultItem[];
  identities?: VaultItem[];
  apiKeys?: VaultItem[];
  wifiNetworks?: VaultItem[];
  recoveryCodes?: VaultItem[];
  softwareLicenses?: VaultItem[];
  databaseCredentials?: VaultItem[];
  totpStates?: Record<number, TotpState>;
  onEditItem?: (item: VaultItem) => void;
  onDeleteItem?: (id: number, type: string, name: string) => void;
  onExportVault?: () => void;
}

export default function GeneratorTools({
  passwords = [],
  totps = [],
  notes = [],
  cards = [],
  sshKeys = [],
  identities = [],
  apiKeys = [],
  wifiNetworks = [],
  recoveryCodes = [],
  softwareLicenses = [],
  databaseCredentials = [],
  totpStates = {},
  onEditItem,
  onDeleteItem,
  onExportVault,
}: GeneratorToolsProps) {
  // Combine all items for the list rail
  const allItems: VaultItem[] = [
    ...passwords,
    ...totps,
    ...notes,
    ...cards,
    ...sshKeys,
    ...identities,
    ...apiKeys,
    ...wifiNetworks,
    ...recoveryCodes,
    ...softwareLicenses,
    ...databaseCredentials,
  ];

  const [selectedId, setSelectedId] = useState<number | null>(allItems[0]?.id ?? null);
  const [showPassword, setShowPassword] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Update selection if the list changes and current selection is gone
  useEffect(() => {
    if (selectedId === null && allItems.length > 0) setSelectedId(allItems[0].id);
    if (selectedId !== null && !allItems.find(i => i.id === selectedId) && allItems.length > 0) {
      setSelectedId(allItems[0].id);
    }
  }, [allItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generator state
  const [genLength, setGenLength] = useState(20);
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genNumbers, setGenNumbers] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);
  const [generatedPwd, setGeneratedPwd] = useState("");
  const [exportReady, setExportReady] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const handleGenerate = useCallback(() => {
    const pwd = generatePassword({
      length: genLength,
      upper: genUpper,
      lower: genLower,
      numbers: genNumbers,
      symbols: genSymbols,
    });
    setGeneratedPwd(pwd);
  }, [genLength, genUpper, genLower, genNumbers, genSymbols]);

  useEffect(() => { handleGenerate(); }, []);

  const strength = getPasswordStrength(generatedPwd);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleExport = () => {
    setExportLoading(true);
    setTimeout(() => {
      setExportLoading(false);
      setExportReady(true);
      onExportVault?.();
      setTimeout(() => setExportReady(false), 3000);
    }, 1200);
  };

  const selectedItem = allItems.find(i => i.id === selectedId) ?? null;
  const totpState = selectedItem ? totpStates[selectedItem.id] : undefined;
  const totpSeconds = totpState?.secondsLeft ?? 30;
  const totpCode = totpState?.code ?? "--- ---";
  const totpError = totpState?.error;
  const hasTotpError = !!totpError;
  const totpProgress = hasTotpError ? 100 : (totpSeconds / 30) * 100;
  const totpUrgent = !hasTotpError && totpSeconds <= 8;
  const displayedTotpCode = hasTotpError ? "INVALID" : totpCode;

  const totalItems = passwords.length + totps.length + notes.length + cards.length + sshKeys.length + identities.length + apiKeys.length + wifiNetworks.length + recoveryCodes.length + softwareLicenses.length + databaseCredentials.length;

  const getItemName = (item: VaultItem): string => {
    return item.site
      ?? item.issuer
      ?? item.title
      ?? item.sshName
      ?? item.identityLabel
      ?? item.fullName
      ?? item.apiName
      ?? item.wifiName
      ?? item.ssid
      ?? item.recoveryName
      ?? item.softwareName
      ?? item.dbName
      ?? `${item.brand} ${item.number?.slice(-4) ?? ""}`
      ?? "Item";
  };

  const getItemSub = (item: VaultItem): string => {
    return item.username
      ?? item.account
      ?? item.cardholder
      ?? item.sshHost
      ?? item.email
      ?? item.apiProvider
      ?? item.ssid
      ?? item.recoveryService
      ?? item.licenseEmail
      ?? item.dbHost
      ?? "";
  };

  const getFavicon = (item: VaultItem): string => {
    return item.favicon ?? (item.issuer ?? item.title ?? item.brand ?? item.sshName ?? item.identityLabel ?? item.apiName ?? item.ssid ?? item.recoveryName ?? item.softwareName ?? item.dbName ?? "?").slice(0, 2).toUpperCase();
  };

  return (
    <section id="generator-tools" className="bg-background min-h-screen w-full pb-20 lg:pb-0">
      {/* Section header strip */}
      <div className="border-b border-border px-4 py-4 sm:px-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <Lightning weight="duotone" size={18} className="text-amber-500" />
          <span className="font-heading text-sm font-semibold text-foreground tracking-widest uppercase">
            Generator &amp; Tools
          </span>
          <Separator orientation="vertical" className="hidden h-4 bg-border sm:block" />
          <span className="text-xs text-muted-foreground sm:max-w-sm">
            Generate strong credentials - inspect vault items safely
          </span>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <ShieldCheck weight="duotone" size={14} className="text-amber-500" />
          <span className="text-xs text-amber-500 font-mono">VAULT UNLOCKED</span>
        </div>
      </div>

      <div className="flex flex-col overflow-visible lg:h-[calc(100vh-57px)] lg:flex-row lg:overflow-hidden">
        {/* LEFT: Item list rail */}
        <div className="order-2 flex min-w-0 flex-col border-b border-border lg:order-1 lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-mono">Vault Items</span>
            <span className="text-[10px] font-mono text-muted-foreground">{totalItems}</span>
          </div>
          <div className="max-h-72 overflow-y-auto lg:max-h-none lg:flex-1">
            {allItems.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <ShieldCheck size={24} weight="duotone" className="text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No items in vault</p>
              </div>
            ) : allItems.map((item) => {
              const isActive = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border transition-all duration-150 group relative ${
                    isActive ? "bg-card border-l-2 border-l-amber-500" : "hover:bg-card"
                  }`}
                >
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-500" />}
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-6 h-6 rounded-sm flex items-center justify-center text-[10px] font-bold font-mono text-foreground bg-muted shrink-0">
                      {getFavicon(item)}
                    </div>
                    <span className={`text-xs font-medium truncate transition-colors duration-150 ${isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                      {getItemName(item)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 pl-8">
                    <span className="text-muted-foreground">{typeIcons[item.type]}</span>
                    <span className="text-[10px] text-muted-foreground">{typeLabels[item.type]}</span>
                  </div>
                </button>
              );
            })}
          </div>
          {/* Clipboard reminder */}
          <div className="border-t border-amber-600/30 bg-amber-500/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <Warning weight="duotone" size={12} className="text-amber-500 shrink-0" />
              <span className="text-xs text-amber-500/80 font-mono leading-tight">Copied values stay in your browser clipboard until replaced.</span>
            </div>
          </div>
        </div>

        {/* CENTER: Tool blocks */}
        <div className="order-1 min-w-0 border-b border-border lg:order-2 lg:flex-1 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="p-4 space-y-4 sm:p-6 sm:space-y-6">
            {/* Password Generator */}
            <div className="border border-border rounded-sm bg-card">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
                <Key weight="duotone" size={16} className="text-amber-500" />
                <span className="font-heading text-sm font-semibold text-foreground">Password Generator</span>
                <Badge variant="outline" className="ml-auto text-xs border-amber-600/50 text-amber-500 font-mono">LIVE</Badge>
              </div>

              <div className="p-5 space-y-5">
                {/* Generated output */}
                <div className="relative">
                  <div className="border border-border rounded-sm bg-background px-4 py-3 pr-24 font-mono text-sm text-foreground tracking-wider min-h-[44px] flex items-center break-all">
                    {generatedPwd || <span className="text-muted-foreground">Click generate...</span>}
                  </div>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    <button
                      onClick={() => handleCopy(generatedPwd, "gen")}
                      className="p-1.5 rounded-sm hover:bg-muted transition-colors duration-150"
                      title="Copy"
                    >
                      {copied === "gen" ? <CheckCircle weight="duotone" size={15} className="text-emerald-500" /> : <Copy weight="duotone" size={15} className="text-muted-foreground" />}
                    </button>
                    <button onClick={handleGenerate} className="p-1.5 rounded-sm hover:bg-muted transition-colors duration-150" title="Regenerate">
                      <ArrowsClockwise weight="duotone" size={15} className="text-muted-foreground" />
                    </button>
                  </div>
                </div>

                {/* Strength bar */}
                {generatedPwd && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Strength</span>
                      <span className="text-xs font-mono text-foreground">{strength.label}</span>
                    </div>
                    <div className="h-1 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${strength.color}`} style={{ width: `${(strength.level / 4) * 100}%` }} />
                    </div>
                  </div>
                )}

                {/* Length slider */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Length</Label>
                    <span className="text-xs font-mono text-amber-500">{genLength}</span>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={32}
                    value={genLength}
                    onChange={(e) => setGenLength(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground font-mono"><span>8</span><span>32</span></div>
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Uppercase A-Z", val: genUpper, set: setGenUpper },
                    { label: "Lowercase a-z", val: genLower, set: setGenLower },
                    { label: "Numbers 0-9", val: genNumbers, set: setGenNumbers },
                    { label: "Symbols !@#...", val: genSymbols, set: setGenSymbols },
                  ].map(({ label, val, set }) => (
                    <button
                      key={label}
                      onClick={() => set(!val)}
                      className={`flex items-center gap-2 px-3 py-2 border rounded-sm text-xs font-mono transition-all duration-150 ${
                        val ? "border-amber-600/60 bg-amber-500/10 text-amber-400" : "border-border bg-background text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${val ? "bg-amber-500" : "bg-muted"}`} />
                      {label}
                    </button>
                  ))}
                </div>

                <Button
                  onClick={handleGenerate}
                  className="w-full bg-primary text-primary-foreground rounded-sm font-mono text-xs tracking-widest uppercase hover:opacity-90 transition-opacity duration-150"
                >
                  <Sliders weight="duotone" size={14} className="mr-2" />
                  Generate Password
                </Button>
              </div>
            </div>

            {/* Local Export */}
            <div className="border border-border rounded-sm bg-card">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
                <Export weight="duotone" size={16} className="text-amber-500" />
                <span className="font-heading text-sm font-semibold text-foreground">Encrypted Export</span>
                <Badge variant="outline" className="ml-auto text-xs border-border text-muted-foreground font-mono">ENCRYPTED</Badge>
              </div>

              <div className="p-5 space-y-4">
                <div className="border border-border rounded-sm bg-background p-4 space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-muted-foreground">Items in vault</span>
                    <span className="text-foreground">{totalItems} entries</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-muted-foreground">Storage model</span>
                    <span className="text-amber-500">Encrypted local vault</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-muted-foreground">Deploy target</span>
                    <span className="text-foreground">Cloudflare Pages</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-muted-foreground">Format</span>
                    <span className="text-foreground">{EXPORT_VERSION}.json</span>
                  </div>
                </div>

                <div className="border border-amber-600/30 bg-amber-500/5 rounded-sm px-4 py-3 flex gap-2">
                  <Warning weight="duotone" size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-500/90 font-mono leading-relaxed">
                    Export writes an encrypted backup package. Keep the file private and unlock it later with the backup master password.
                  </p>
                </div>

                <Button
                  onClick={handleExport}
                  disabled={exportLoading}
                  variant="outline"
                  className="w-full border-border text-foreground rounded-sm font-mono text-xs tracking-widest uppercase hover:bg-card transition-all duration-150"
                >
                  {exportLoading ? (
                    <><ArrowsClockwise weight="duotone" size={14} className="mr-2 animate-spin" />Preparing...</>
                  ) : exportReady ? (
                    <><CheckCircle weight="duotone" size={14} className="mr-2 text-emerald-500" /><span className="text-emerald-500">Exported!</span></>
                  ) : (
                    <><DownloadSimple weight="duotone" size={14} className="mr-2" />Export Vault</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Selected item detail pane */}
        <div className="order-3 min-w-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
          <div className="h-0.5 bg-amber-500 w-full" />

          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-mono">Item Detail</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span className="text-xs text-amber-500 font-mono">{selectedItem ? "Selected" : "None"}</span>
            </div>
          </div>

          {!selectedItem ? (
            <div className="p-8 text-center">
              <Lock weight="duotone" size={28} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-xs text-muted-foreground font-mono">Select an item from the list</p>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Favicon + title + badge */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-sm bg-muted flex items-center justify-center text-base font-bold font-mono text-foreground shrink-0 border border-border">
                  {getFavicon(selectedItem)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading text-base font-semibold text-foreground leading-tight truncate">{getItemName(selectedItem)}</h3>
                  <div className="mt-1">
                    <Badge variant="outline" className={`text-xs font-mono rounded-sm ${typeBadgeClass[selectedItem.type]}`}>
                      <span className="mr-1">{typeIcons[selectedItem.type]}</span>
                      {typeLabels[selectedItem.type]}
                    </Badge>
                  </div>
                </div>
                <div className="shrink-0">
                  <Lock weight="duotone" size={14} className="text-muted-foreground" />
                </div>
              </div>

              <Separator className="bg-border" />

              <div className="space-y-4">
                {/* PASSWORD fields */}
                {selectedItem.type === "password" && (
                  <>
                    {selectedItem.username && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Username</Label>
                        <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <span className="flex-1 text-sm font-mono text-foreground truncate">{selectedItem.username}</span>
                          <button onClick={() => handleCopy(selectedItem.username ?? "", `user-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            {copied === `user-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedItem.password && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Password</Label>
                        <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <span className="flex-1 text-sm font-mono text-foreground truncate">
                            {showPassword ? selectedItem.password : "*".repeat(Math.min(selectedItem.password.length, 16))}
                          </span>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                            <button onClick={() => setShowPassword(!showPassword)}>
                              {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                            </button>
                            <button onClick={() => handleCopy(selectedItem.password ?? "", `pwd-${selectedItem.id}`)}>
                              {copied === `pwd-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedItem.url && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">URL</Label>
                        <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <Globe weight="duotone" size={13} className="text-muted-foreground shrink-0" />
                          <span className="flex-1 text-xs font-mono text-muted-foreground truncate">{selectedItem.url}</span>
                        </div>
                      </div>
                    )}
                    {selectedItem.notes && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Notes</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <p className="text-xs font-mono text-muted-foreground leading-relaxed">{selectedItem.notes}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* TOTP fields */}
                {selectedItem.type === "totp" && (
                  <>
                    {selectedItem.account && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Account</Label>
                        <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <span className="flex-1 text-sm font-mono text-foreground truncate">{selectedItem.account}</span>
                          <button onClick={() => handleCopy(selectedItem.account ?? "", `acc-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {copied === `acc-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">{hasTotpError ? "TOTP Secret Error" : "Live TOTP Code"}</Label>
                      <div className={`border rounded-sm bg-background px-3 py-3 transition-colors duration-150 ${hasTotpError ? "border-red-500/60" : totpUrgent ? "border-amber-600/60" : "border-border"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xl font-mono font-bold ${hasTotpError ? "text-red-400 tracking-wider" : `tracking-[0.2em] ${totpUrgent ? "text-amber-500" : "text-foreground"}`}`}>{displayedTotpCode}</span>
                          {!hasTotpError && (
                            <button onClick={() => handleCopy(totpCode.replace(" ", ""), "totp-detail")} className="p-1 hover:bg-muted rounded-sm transition-colors duration-150">
                              {copied === "totp-detail" ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                            </button>
                          )}
                        </div>
                        {hasTotpError && <p className="text-[10px] text-red-400/80 font-mono mb-2">{totpError}</p>}
                        <div className="h-0.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-1000 ${hasTotpError ? "bg-red-500" : totpUrgent ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${totpProgress}%` }} />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-xs text-muted-foreground font-mono">Refreshes in</span>
                          <span className={`text-xs font-mono ${hasTotpError ? "text-red-400" : totpUrgent ? "text-amber-500" : "text-muted-foreground"}`}>{hasTotpError ? "ERR" : `${totpSeconds}s`}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* NOTE fields */}
                {selectedItem.type === "note" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Content</Label>
                      <div className="border border-border rounded-sm bg-background px-3 py-2">
                        <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-line break-words">{selectedItem.preview}</p>
                      </div>
                    </div>
                    {selectedItem.updatedAt && (
                      <p className="text-[10px] text-muted-foreground font-mono">Updated {selectedItem.updatedAt}</p>
                    )}
                  </>
                )}

                {/* CARD fields */}
                {selectedItem.type === "card" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Cardholder</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground">{selectedItem.cardholder}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Card Number</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground tracking-widest">{selectedItem.number}</span>
                        <button onClick={() => handleCopy(selectedItem.number ?? "", `card-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                          {copied === `card-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Expiry</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground">{selectedItem.expiry}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">CVV</Label>
                        <div className="flex items-center gap-1 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors">
                          <span className="flex-1 text-sm font-mono text-foreground">{showCvv ? selectedItem.cvv : "***"}</span>
                          <button onClick={() => setShowCvv(v => !v)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {showCvv ? <EyeSlash weight="duotone" size={12} className="text-muted-foreground" /> : <Eye weight="duotone" size={12} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* SSH fields */}
                {selectedItem.type === "ssh" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Host</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground">{selectedItem.sshHost || "-"}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">User / Port</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground">{selectedItem.sshUsername || "-"}:{selectedItem.sshPort || "22"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Private Key</Label>
                      <div className="flex items-start gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-xs font-mono text-foreground break-all line-clamp-4">
                          {showPassword ? selectedItem.sshPrivateKey : selectedItem.sshPrivateKey ? "*".repeat(24) : "-"}
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                          <button onClick={() => handleCopy(selectedItem.sshPrivateKey ?? "", `ssh-${selectedItem.id}`)}>
                            {copied === `ssh-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {selectedItem.sshFingerprint && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Fingerprint</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-xs font-mono text-muted-foreground break-all">{selectedItem.sshFingerprint}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Identity fields */}
                {selectedItem.type === "identity" && (
                  <>
                    {[
                      ["Full Name", selectedItem.fullName],
                      ["Email", selectedItem.email],
                      ["Phone", selectedItem.phone],
                      ["Company", selectedItem.company],
                      ["Job Title", selectedItem.jobTitle],
                      ["Document ID", selectedItem.documentId],
                    ].filter(([, value]) => value).map(([label, value]) => (
                      <div key={label} className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">{label}</Label>
                        <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <span className="flex-1 text-sm font-mono text-foreground truncate">{value}</span>
                          <button onClick={() => handleCopy(value ?? "", `identity-${label}-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {copied === `identity-${label}-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    ))}
                    {(selectedItem.address || selectedItem.city || selectedItem.country) && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Address</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-line">
                            {[selectedItem.address, selectedItem.city, selectedItem.region, selectedItem.postalCode, selectedItem.country].filter(Boolean).join("\n")}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* API key fields */}
                {selectedItem.type === "apiKey" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Provider</Label>
                      <div className="border border-border rounded-sm bg-background px-3 py-2">
                        <span className="text-sm font-mono text-foreground">{selectedItem.apiProvider || "-"}</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">API Key / Token</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground truncate">{showPassword ? selectedItem.apiKey : selectedItem.apiKey ? "*".repeat(Math.min(selectedItem.apiKey.length, 20)) : "-"}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                          <button onClick={() => handleCopy(selectedItem.apiKey ?? "", `api-${selectedItem.id}`)}>
                            {copied === `api-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {(selectedItem.apiScopes || selectedItem.apiExpiry) && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Scopes</Label>
                          <div className="border border-border rounded-sm bg-background px-3 py-2">
                            <span className="text-xs font-mono text-muted-foreground truncate">{selectedItem.apiScopes || "-"}</span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Expires</Label>
                          <div className="border border-border rounded-sm bg-background px-3 py-2">
                            <span className="text-xs font-mono text-muted-foreground">{selectedItem.apiExpiry || "Never"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Wi-Fi fields */}
                {selectedItem.type === "wifi" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">SSID</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground truncate">{selectedItem.ssid}</span>
                        <button onClick={() => handleCopy(selectedItem.ssid ?? "", `ssid-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                          {copied === `ssid-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Password</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground truncate">{showPassword ? selectedItem.wifiPassword : selectedItem.wifiPassword ? "*".repeat(Math.min(selectedItem.wifiPassword.length, 20)) : "-"}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                          <button onClick={() => handleCopy(selectedItem.wifiPassword ?? "", `wifi-${selectedItem.id}`)}>
                            {copied === `wifi-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Security</Label>
                      <div className="border border-border rounded-sm bg-background px-3 py-2">
                        <span className="text-sm font-mono text-foreground">{selectedItem.wifiSecurity || "-"}</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Recovery code fields */}
                {selectedItem.type === "recoveryCode" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Service</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground">{selectedItem.recoveryService || "-"}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Account</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground truncate">{selectedItem.recoveryAccount || "-"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Recovery Codes</Label>
                      <div className="flex items-start gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-xs font-mono text-foreground break-all whitespace-pre-line line-clamp-6">
                          {showPassword ? selectedItem.recoveryCodes : selectedItem.recoveryCodes ? "*".repeat(24) : "-"}
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                          <button onClick={() => handleCopy(selectedItem.recoveryCodes ?? "", `recovery-${selectedItem.id}`)}>
                            {copied === `recovery-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {selectedItem.recoveryNotes && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Notes</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-line">{selectedItem.recoveryNotes}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Software license fields */}
                {selectedItem.type === "softwareLicense" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Vendor</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground">{selectedItem.softwareVendor || "-"}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">License Email</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground truncate">{selectedItem.licenseEmail || "-"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">License Key</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground truncate">{showPassword ? selectedItem.licenseKey : selectedItem.licenseKey ? "*".repeat(Math.min(selectedItem.licenseKey.length, 24)) : "-"}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                          <button onClick={() => handleCopy(selectedItem.licenseKey ?? "", `license-${selectedItem.id}`)}>
                            {copied === `license-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {(selectedItem.licenseSeats || selectedItem.licenseExpiry) && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Seats</Label>
                          <div className="border border-border rounded-sm bg-background px-3 py-2">
                            <span className="text-xs font-mono text-muted-foreground">{selectedItem.licenseSeats || "-"}</span>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Expires</Label>
                          <div className="border border-border rounded-sm bg-background px-3 py-2">
                            <span className="text-xs font-mono text-muted-foreground">{selectedItem.licenseExpiry || "Lifetime"}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedItem.licenseNotes && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Notes</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-line">{selectedItem.licenseNotes}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Database credential fields */}
                {selectedItem.type === "databaseCredential" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Engine</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground">{selectedItem.dbEngine || "-"}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Database</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground truncate">{selectedItem.dbDatabase || "-"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Host / Port</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <span className="text-sm font-mono text-foreground truncate">{[selectedItem.dbHost, selectedItem.dbPort].filter(Boolean).join(":") || "-"}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Username</Label>
                        <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <span className="flex-1 text-sm font-mono text-foreground truncate">{selectedItem.dbUsername || "-"}</span>
                          <button onClick={() => handleCopy(selectedItem.dbUsername ?? "", `db-user-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {copied === `db-user-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Password</Label>
                      <div className="flex items-center gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                        <span className="flex-1 text-sm font-mono text-foreground truncate">{showPassword ? selectedItem.dbPassword : selectedItem.dbPassword ? "*".repeat(Math.min(selectedItem.dbPassword.length, 24)) : "-"}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeSlash weight="duotone" size={14} className="text-muted-foreground" /> : <Eye weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                          <button onClick={() => handleCopy(selectedItem.dbPassword ?? "", `db-pass-${selectedItem.id}`)}>
                            {copied === `db-pass-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {selectedItem.dbConnectionUrl && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Connection URL</Label>
                        <div className="flex items-start gap-2 border border-border rounded-sm bg-background px-3 py-2 group hover:border-primary transition-colors duration-150">
                          <span className="flex-1 text-xs font-mono text-foreground break-all line-clamp-4">
                            {showPassword ? selectedItem.dbConnectionUrl : "*".repeat(Math.min(selectedItem.dbConnectionUrl.length, 32))}
                          </span>
                          <button onClick={() => handleCopy(selectedItem.dbConnectionUrl ?? "", `db-url-${selectedItem.id}`)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {copied === `db-url-${selectedItem.id}` ? <CheckCircle weight="duotone" size={14} className="text-emerald-500" /> : <Copy weight="duotone" size={14} className="text-muted-foreground" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {selectedItem.dbNotes && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Notes</Label>
                        <div className="border border-border rounded-sm bg-background px-3 py-2">
                          <p className="text-xs font-mono text-muted-foreground leading-relaxed whitespace-pre-line">{selectedItem.dbNotes}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <Separator className="bg-border" />

              {/* Local state badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck weight="duotone" size={14} className="text-emerald-500" />
                  <span className="text-xs font-mono text-emerald-500">Encrypted at rest</span>
                </div>
                <Badge variant="outline" className="text-xs border-border text-muted-foreground font-mono rounded-sm">Browser</Badge>
              </div>

              {/* Action row wired to parent */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedItem && onEditItem?.(selectedItem)}
                  className="border-border text-foreground rounded-sm font-mono text-xs uppercase tracking-wider hover:bg-muted hover:border-primary transition-all duration-150 flex items-center gap-1.5"
                >
                  <PencilSimple weight="duotone" size={13} />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectedItem && onDeleteItem?.(selectedItem.id, selectedItem.type, getItemName(selectedItem))}
                  className="border-red-900/50 text-red-400 rounded-sm font-mono text-xs uppercase tracking-wider hover:bg-red-950/30 hover:border-red-700 transition-all duration-150 flex items-center gap-1.5"
                >
                  <Trash weight="duotone" size={13} />
                  Delete
                </Button>
              </div>

              {/* Export summary */}
              <div className="border border-border rounded-sm bg-background p-3 space-y-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText weight="duotone" size={12} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground font-mono uppercase tracking-widest">Export Summary</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Type</span>
                  <span className="text-foreground">{typeLabels[selectedItem.type]}</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Storage</span>
                  <span className="text-emerald-500">Encrypted</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">Included in export</span>
                  <span className="text-foreground">Yes</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

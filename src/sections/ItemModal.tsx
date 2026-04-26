import { useState, useEffect, useRef } from "react";
import {
  X,
  Key,
  Timer,
  Note,
  CreditCard,
  Eye,
  EyeSlash,
  ArrowsClockwise,
  ShieldCheck,
  Warning,
  TerminalWindow,
  IdentificationCard,
  Code,
  WifiHigh,
  Lifebuoy,
  Certificate,
  Database,
} from "@phosphor-icons/react";
import { generateSecurePassword } from "../lib/secure-random";
import { normalizeTotpSecretInput, validateTotpSecret } from "../lib/totp";

export type ItemType = "password" | "totp" | "note" | "card" | "ssh" | "identity" | "apiKey" | "wifi" | "recoveryCode" | "softwareLicense" | "databaseCredential";

export interface VaultItem {
  id: number;
  type: ItemType;
  // Password fields
  site?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
  favicon?: string;
  strength?: "strong" | "fair" | "weak";
  // TOTP fields
  account?: string;
  issuer?: string;
  secret?: string;
  // Note fields
  title?: string;
  preview?: string;
  updatedAt?: string;
  modifiedAt?: string;
  // Card fields
  cardholder?: string;
  number?: string;
  expiry?: string;
  cvv?: string;
  brand?: string;
  // SSH key fields
  sshName?: string;
  sshUsername?: string;
  sshHost?: string;
  sshPort?: string;
  sshPrivateKey?: string;
  sshPublicKey?: string;
  sshPassphrase?: string;
  sshFingerprint?: string;
  // Identity fields
  identityLabel?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  documentId?: string;
  // API key / token fields
  apiName?: string;
  apiProvider?: string;
  apiKey?: string;
  apiSecret?: string;
  apiScopes?: string;
  apiExpiry?: string;
  // Wi-Fi fields
  wifiName?: string;
  ssid?: string;
  wifiPassword?: string;
  wifiSecurity?: string;
  wifiNotes?: string;
  // Recovery code fields
  recoveryName?: string;
  recoveryService?: string;
  recoveryAccount?: string;
  recoveryCodes?: string;
  recoveryNotes?: string;
  // Software license fields
  softwareName?: string;
  softwareVendor?: string;
  licenseKey?: string;
  licenseEmail?: string;
  licenseSeats?: string;
  licenseExpiry?: string;
  licenseNotes?: string;
  // Database credential fields
  dbName?: string;
  dbEngine?: string;
  dbHost?: string;
  dbPort?: string;
  dbDatabase?: string;
  dbUsername?: string;
  dbPassword?: string;
  dbConnectionUrl?: string;
  dbNotes?: string;
}

function generatePassword(length = 20): string {
  return generateSecurePassword({ length });
}

function getStrength(pwd: string): "weak" | "fair" | "strong" {
  let score = 0;
  if (pwd.length >= 12) score++;
  if (pwd.length >= 20) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 2) return "weak";
  if (score <= 4) return "fair";
  return "strong";
}

const typeConfig = {
  password: { label: "Password Entry", icon: Key, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/25" },
  totp: { label: "TOTP Authenticator", icon: Timer, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  note: { label: "Secure Note", icon: Note, color: "text-muted-foreground", bg: "bg-muted border-border" },
  card: { label: "Credit Card", icon: CreditCard, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/25" },
  ssh: { label: "SSH Key", icon: TerminalWindow, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/25" },
  identity: { label: "Identity", icon: IdentificationCard, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/25" },
  apiKey: { label: "API Key", icon: Code, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/25" },
  wifi: { label: "Wi-Fi", icon: WifiHigh, color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/25" },
  recoveryCode: { label: "Recovery Codes", icon: Lifebuoy, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
  softwareLicense: { label: "Software License", icon: Certificate, color: "text-lime-400", bg: "bg-lime-500/10 border-lime-500/25" },
  databaseCredential: { label: "Database Credential", icon: Database, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/25" },
};

const strengthConfig = {
  weak: { label: "Weak", color: "text-red-400", bar: "bg-red-500 w-1/3" },
  fair: { label: "Fair", color: "text-amber-400", bar: "bg-amber-500 w-2/3" },
  strong: { label: "Strong", color: "text-emerald-400", bar: "bg-emerald-500 w-full" },
};

interface ItemModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (item: VaultItem) => void;
  editItem?: VaultItem | null;
  initialType?: ItemType;
}

export default function ItemModal({ open, onClose, onSave, editItem, initialType = "password" }: ItemModalProps) {
  const [activeType, setActiveType] = useState<ItemType>(editItem?.type ?? initialType);
  const [showPwd, setShowPwd] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const typeSelectorRef = useRef<HTMLDivElement | null>(null);

  // Password form
  const [site, setSite] = useState(editItem?.site ?? "");
  const [username, setUsername] = useState(editItem?.username ?? "");
  const [password, setPassword] = useState(editItem?.password ?? "");
  const [url, setUrl] = useState(editItem?.url ?? "");
  const [notes, setNotes] = useState(editItem?.notes ?? "");

  // TOTP form
  const [totpAccount, setTotpAccount] = useState(editItem?.account ?? "");
  const [totpIssuer, setTotpIssuer] = useState(editItem?.issuer ?? "");
  const [totpSecret, setTotpSecret] = useState(editItem?.secret ?? "");

  // Note form
  const [noteTitle, setNoteTitle] = useState(editItem?.title ?? "");
  const [noteContent, setNoteContent] = useState(editItem?.preview ?? "");

  // Card form
  const [cardholder, setCardholder] = useState(editItem?.cardholder ?? "");
  const [cardNumber, setCardNumber] = useState(editItem?.number?.replace(/\*/g, "") ?? "");
  const [expiry, setExpiry] = useState(editItem?.expiry ?? "");
  const [cvv, setCvv] = useState(editItem?.cvv ?? "");
  const [brand, setBrand] = useState(editItem?.brand ?? "Visa");

  // SSH key form
  const [sshName, setSshName] = useState(editItem?.sshName ?? "");
  const [sshUsername, setSshUsername] = useState(editItem?.sshUsername ?? "");
  const [sshHost, setSshHost] = useState(editItem?.sshHost ?? "");
  const [sshPort, setSshPort] = useState(editItem?.sshPort ?? "22");
  const [sshPrivateKey, setSshPrivateKey] = useState(editItem?.sshPrivateKey ?? "");
  const [sshPublicKey, setSshPublicKey] = useState(editItem?.sshPublicKey ?? "");
  const [sshPassphrase, setSshPassphrase] = useState(editItem?.sshPassphrase ?? "");
  const [sshFingerprint, setSshFingerprint] = useState(editItem?.sshFingerprint ?? "");

  // Identity form
  const [identityLabel, setIdentityLabel] = useState(editItem?.identityLabel ?? "");
  const [fullName, setFullName] = useState(editItem?.fullName ?? "");
  const [email, setEmail] = useState(editItem?.email ?? "");
  const [phone, setPhone] = useState(editItem?.phone ?? "");
  const [company, setCompany] = useState(editItem?.company ?? "");
  const [jobTitle, setJobTitle] = useState(editItem?.jobTitle ?? "");
  const [address, setAddress] = useState(editItem?.address ?? "");
  const [city, setCity] = useState(editItem?.city ?? "");
  const [region, setRegion] = useState(editItem?.region ?? "");
  const [postalCode, setPostalCode] = useState(editItem?.postalCode ?? "");
  const [country, setCountry] = useState(editItem?.country ?? "");
  const [documentId, setDocumentId] = useState(editItem?.documentId ?? "");

  // API key / token form
  const [apiName, setApiName] = useState(editItem?.apiName ?? "");
  const [apiProvider, setApiProvider] = useState(editItem?.apiProvider ?? "");
  const [apiKey, setApiKey] = useState(editItem?.apiKey ?? "");
  const [apiSecret, setApiSecret] = useState(editItem?.apiSecret ?? "");
  const [apiScopes, setApiScopes] = useState(editItem?.apiScopes ?? "");
  const [apiExpiry, setApiExpiry] = useState(editItem?.apiExpiry ?? "");

  // Wi-Fi form
  const [wifiName, setWifiName] = useState(editItem?.wifiName ?? "");
  const [ssid, setSsid] = useState(editItem?.ssid ?? "");
  const [wifiPassword, setWifiPassword] = useState(editItem?.wifiPassword ?? "");
  const [wifiSecurity, setWifiSecurity] = useState(editItem?.wifiSecurity ?? "WPA2/WPA3");
  const [wifiNotes, setWifiNotes] = useState(editItem?.wifiNotes ?? "");

  // Recovery codes form
  const [recoveryName, setRecoveryName] = useState(editItem?.recoveryName ?? "");
  const [recoveryService, setRecoveryService] = useState(editItem?.recoveryService ?? "");
  const [recoveryAccount, setRecoveryAccount] = useState(editItem?.recoveryAccount ?? "");
  const [recoveryCodes, setRecoveryCodes] = useState(editItem?.recoveryCodes ?? "");
  const [recoveryNotes, setRecoveryNotes] = useState(editItem?.recoveryNotes ?? "");

  // Software license form
  const [softwareName, setSoftwareName] = useState(editItem?.softwareName ?? "");
  const [softwareVendor, setSoftwareVendor] = useState(editItem?.softwareVendor ?? "");
  const [licenseKey, setLicenseKey] = useState(editItem?.licenseKey ?? "");
  const [licenseEmail, setLicenseEmail] = useState(editItem?.licenseEmail ?? "");
  const [licenseSeats, setLicenseSeats] = useState(editItem?.licenseSeats ?? "");
  const [licenseExpiry, setLicenseExpiry] = useState(editItem?.licenseExpiry ?? "");
  const [licenseNotes, setLicenseNotes] = useState(editItem?.licenseNotes ?? "");

  // Database credential form
  const [dbName, setDbName] = useState(editItem?.dbName ?? "");
  const [dbEngine, setDbEngine] = useState(editItem?.dbEngine ?? "PostgreSQL");
  const [dbHost, setDbHost] = useState(editItem?.dbHost ?? "");
  const [dbPort, setDbPort] = useState(editItem?.dbPort ?? "");
  const [dbDatabase, setDbDatabase] = useState(editItem?.dbDatabase ?? "");
  const [dbUsername, setDbUsername] = useState(editItem?.dbUsername ?? "");
  const [dbPassword, setDbPassword] = useState(editItem?.dbPassword ?? "");
  const [dbConnectionUrl, setDbConnectionUrl] = useState(editItem?.dbConnectionUrl ?? "");
  const [dbNotes, setDbNotes] = useState(editItem?.dbNotes ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const activeButton = typeSelectorRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    activeButton?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeType, open]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setShowPwd(false);
    setShowCvv(false);

    if (editItem) {
      setActiveType(editItem.type);
      setSite(editItem.site ?? "");
      setUsername(editItem.username ?? "");
      setPassword(editItem.password ?? "");
      setUrl(editItem.url ?? "");
      setNotes(editItem.notes ?? "");
      setTotpAccount(editItem.account ?? "");
      setTotpIssuer(editItem.issuer ?? "");
      setTotpSecret(editItem.secret ?? "");
      setNoteTitle(editItem.title ?? "");
      setNoteContent(editItem.preview ?? "");
      setCardholder(editItem.cardholder ?? "");
      setCardNumber(editItem.number?.replace(/[\* ]/g, "") ?? "");
      setExpiry(editItem.expiry ?? "");
      setCvv(editItem.cvv ?? "");
      setBrand(editItem.brand ?? "Visa");
      setSshName(editItem.sshName ?? "");
      setSshUsername(editItem.sshUsername ?? "");
      setSshHost(editItem.sshHost ?? "");
      setSshPort(editItem.sshPort ?? "22");
      setSshPrivateKey(editItem.sshPrivateKey ?? "");
      setSshPublicKey(editItem.sshPublicKey ?? "");
      setSshPassphrase(editItem.sshPassphrase ?? "");
      setSshFingerprint(editItem.sshFingerprint ?? "");
      setIdentityLabel(editItem.identityLabel ?? "");
      setFullName(editItem.fullName ?? "");
      setEmail(editItem.email ?? "");
      setPhone(editItem.phone ?? "");
      setCompany(editItem.company ?? "");
      setJobTitle(editItem.jobTitle ?? "");
      setAddress(editItem.address ?? "");
      setCity(editItem.city ?? "");
      setRegion(editItem.region ?? "");
      setPostalCode(editItem.postalCode ?? "");
      setCountry(editItem.country ?? "");
      setDocumentId(editItem.documentId ?? "");
      setApiName(editItem.apiName ?? "");
      setApiProvider(editItem.apiProvider ?? "");
      setApiKey(editItem.apiKey ?? "");
      setApiSecret(editItem.apiSecret ?? "");
      setApiScopes(editItem.apiScopes ?? "");
      setApiExpiry(editItem.apiExpiry ?? "");
      setWifiName(editItem.wifiName ?? "");
      setSsid(editItem.ssid ?? "");
      setWifiPassword(editItem.wifiPassword ?? "");
      setWifiSecurity(editItem.wifiSecurity ?? "WPA2/WPA3");
      setWifiNotes(editItem.wifiNotes ?? "");
      setRecoveryName(editItem.recoveryName ?? "");
      setRecoveryService(editItem.recoveryService ?? "");
      setRecoveryAccount(editItem.recoveryAccount ?? "");
      setRecoveryCodes(editItem.recoveryCodes ?? "");
      setRecoveryNotes(editItem.recoveryNotes ?? "");
      setSoftwareName(editItem.softwareName ?? "");
      setSoftwareVendor(editItem.softwareVendor ?? "");
      setLicenseKey(editItem.licenseKey ?? "");
      setLicenseEmail(editItem.licenseEmail ?? "");
      setLicenseSeats(editItem.licenseSeats ?? "");
      setLicenseExpiry(editItem.licenseExpiry ?? "");
      setLicenseNotes(editItem.licenseNotes ?? "");
      setDbName(editItem.dbName ?? "");
      setDbEngine(editItem.dbEngine ?? "PostgreSQL");
      setDbHost(editItem.dbHost ?? "");
      setDbPort(editItem.dbPort ?? "");
      setDbDatabase(editItem.dbDatabase ?? "");
      setDbUsername(editItem.dbUsername ?? "");
      setDbPassword(editItem.dbPassword ?? "");
      setDbConnectionUrl(editItem.dbConnectionUrl ?? "");
      setDbNotes(editItem.dbNotes ?? "");
      return;
    }

    setActiveType(initialType);
    setSite("");
    setUsername("");
    setPassword("");
    setUrl("");
    setNotes("");
    setTotpAccount("");
    setTotpIssuer("");
    setTotpSecret("");
    setNoteTitle("");
    setNoteContent("");
    setCardholder("");
    setCardNumber("");
    setExpiry("");
    setCvv("");
    setBrand("Visa");
    setSshName("");
    setSshUsername("");
    setSshHost("");
    setSshPort("22");
    setSshPrivateKey("");
    setSshPublicKey("");
    setSshPassphrase("");
    setSshFingerprint("");
    setIdentityLabel("");
    setFullName("");
    setEmail("");
    setPhone("");
    setCompany("");
    setJobTitle("");
    setAddress("");
    setCity("");
    setRegion("");
    setPostalCode("");
    setCountry("");
    setDocumentId("");
    setApiName("");
    setApiProvider("");
    setApiKey("");
    setApiSecret("");
    setApiScopes("");
    setApiExpiry("");
    setWifiName("");
    setSsid("");
    setWifiPassword("");
    setWifiSecurity("WPA2/WPA3");
    setWifiNotes("");
    setRecoveryName("");
    setRecoveryService("");
    setRecoveryAccount("");
    setRecoveryCodes("");
    setRecoveryNotes("");
    setSoftwareName("");
    setSoftwareVendor("");
    setLicenseKey("");
    setLicenseEmail("");
    setLicenseSeats("");
    setLicenseExpiry("");
    setLicenseNotes("");
    setDbName("");
    setDbEngine("PostgreSQL");
    setDbHost("");
    setDbPort("");
    setDbDatabase("");
    setDbUsername("");
    setDbPassword("");
    setDbConnectionUrl("");
    setDbNotes("");
  }, [editItem, initialType, open]);

  const pwdStrength = password ? getStrength(password) : null;
  const strCfg = pwdStrength ? strengthConfig[pwdStrength] : null;

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (activeType === "password") {
      if (!site.trim()) e.site = "Site name is required";
      if (!password.trim()) e.password = "Password is required";
    } else if (activeType === "totp") {
      const secretValidation = validateTotpSecret(totpSecret);
      if (!totpIssuer.trim()) e.totpIssuer = "Issuer is required";
      if (!secretValidation.ok) e.totpSecret = secretValidation.message ?? "Secret key must be valid Base32";
    } else if (activeType === "note") {
      if (!noteTitle.trim()) e.noteTitle = "Title is required";
      if (!noteContent.trim()) e.noteContent = "Content is required";
    } else if (activeType === "card") {
      if (!cardholder.trim()) e.cardholder = "Cardholder name is required";
      if (!cardNumber.trim()) e.cardNumber = "Card number is required";
      if (!expiry.trim()) e.expiry = "Expiry is required";
    } else if (activeType === "ssh") {
      if (!sshName.trim()) e.sshName = "Key label is required";
      if (!sshPrivateKey.trim()) e.sshPrivateKey = "Private key is required";
    } else if (activeType === "identity") {
      if (!identityLabel.trim()) e.identityLabel = "Identity label is required";
      if (!fullName.trim()) e.fullName = "Full name is required";
    } else if (activeType === "apiKey") {
      if (!apiName.trim()) e.apiName = "API key name is required";
      if (!apiKey.trim()) e.apiKey = "API key or token is required";
    } else if (activeType === "wifi") {
      if (!ssid.trim()) e.ssid = "Network SSID is required";
      if (!wifiPassword.trim()) e.wifiPassword = "Wi-Fi password is required";
    } else if (activeType === "recoveryCode") {
      if (!recoveryName.trim()) e.recoveryName = "Recovery label is required";
      if (!recoveryCodes.trim()) e.recoveryCodes = "At least one recovery code is required";
    } else if (activeType === "softwareLicense") {
      if (!softwareName.trim()) e.softwareName = "Software name is required";
      if (!licenseKey.trim()) e.licenseKey = "License key is required";
    } else if (activeType === "databaseCredential") {
      if (!dbName.trim()) e.dbName = "Credential label is required";
      if (!dbHost.trim() && !dbConnectionUrl.trim()) e.dbHost = "Host or connection URL is required";
      if (!dbUsername.trim() && !dbConnectionUrl.trim()) e.dbUsername = "Database username or connection URL is required";
      if (!dbPassword.trim() && !dbConnectionUrl.trim()) e.dbPassword = "Password or connection URL is required";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const base: VaultItem = { id: editItem?.id ?? Date.now(), type: activeType };
    if (activeType === "password") {
      const last4 = site.slice(0, 2).toUpperCase();
      Object.assign(base, {
        site, username, password, url, notes,
        favicon: last4 || "IT",
        strength: getStrength(password),
      });
    } else if (activeType === "totp") {
      Object.assign(base, {
        account: totpAccount,
        issuer: totpIssuer,
        secret: normalizeTotpSecretInput(totpSecret),
      });
    } else if (activeType === "note") {
      Object.assign(base, {
        title: noteTitle,
        preview: noteContent,
        updatedAt: "just now",
      });
    } else if (activeType === "card") {
      const masked = "**** **** **** " + cardNumber.slice(-4).padStart(4, "*");
      Object.assign(base, {
        cardholder: cardholder.toUpperCase(),
        number: masked,
        expiry,
        cvv,
        brand,
      });
    } else if (activeType === "ssh") {
      Object.assign(base, {
        sshName,
        sshUsername,
        sshHost,
        sshPort,
        sshPrivateKey,
        sshPublicKey,
        sshPassphrase,
        sshFingerprint,
        title: sshName,
        preview: sshHost || sshUsername || sshFingerprint,
        updatedAt: "just now",
      });
    } else if (activeType === "identity") {
      Object.assign(base, {
        identityLabel,
        fullName,
        email,
        phone,
        company,
        jobTitle,
        address,
        city,
        region,
        postalCode,
        country,
        documentId,
        title: identityLabel,
        preview: [fullName, email, phone].filter(Boolean).join(" - "),
        updatedAt: "just now",
      });
    } else if (activeType === "apiKey") {
      Object.assign(base, {
        apiName,
        apiProvider,
        apiKey,
        apiSecret,
        apiScopes,
        apiExpiry,
        title: apiName,
        preview: apiProvider || apiScopes,
        updatedAt: "just now",
      });
    } else if (activeType === "wifi") {
      Object.assign(base, {
        wifiName,
        ssid,
        wifiPassword,
        wifiSecurity,
        wifiNotes,
        title: wifiName || ssid,
        preview: `${ssid}${wifiSecurity ? ` - ${wifiSecurity}` : ""}`,
        updatedAt: "just now",
      });
    } else if (activeType === "recoveryCode") {
      Object.assign(base, {
        recoveryName,
        recoveryService,
        recoveryAccount,
        recoveryCodes,
        recoveryNotes,
        title: recoveryName,
        preview: [recoveryService, recoveryAccount].filter(Boolean).join(" - ") || "Recovery codes",
        updatedAt: "just now",
      });
    } else if (activeType === "softwareLicense") {
      Object.assign(base, {
        softwareName,
        softwareVendor,
        licenseKey,
        licenseEmail,
        licenseSeats,
        licenseExpiry,
        licenseNotes,
        title: softwareName,
        preview: [softwareVendor, licenseEmail].filter(Boolean).join(" - ") || "Software license",
        updatedAt: "just now",
      });
    } else if (activeType === "databaseCredential") {
      Object.assign(base, {
        dbName,
        dbEngine,
        dbHost,
        dbPort,
        dbDatabase,
        dbUsername,
        dbPassword,
        dbConnectionUrl,
        dbNotes,
        title: dbName,
        preview: [dbEngine, dbHost || dbConnectionUrl, dbDatabase].filter(Boolean).join(" - "),
        updatedAt: "just now",
      });
    }
    onSave(base);
    onClose();
  };

  const handleFormatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) setExpiry(digits.slice(0, 2) + "/" + digits.slice(2));
    else setExpiry(digits);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-sm shadow-2xl overflow-hidden max-h-[94dvh] sm:max-h-[90vh] flex flex-col">
        {/* Amber strip */}
        <div className="h-0.5 bg-amber-500 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 sm:px-6 sm:py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-heading text-base font-bold text-foreground">
              {editItem ? "Edit Item" : "Add New Item"}
            </h2>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Saved to the encrypted local vault on this device
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150"
          >
            <X size={16} weight="duotone" />
          </button>
        </div>

        {/* Type selector */}
        <div className="px-5 pt-3 pb-0 sm:px-6 sm:pt-4 shrink-0">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5 sm:mb-2">Item Type</p>
          <div ref={typeSelectorRef} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
            {(Object.keys(typeConfig) as ItemType[]).map((t) => {
              const cfg = typeConfig[t];
              const Icon = cfg.icon;
              const isActive = activeType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setActiveType(t);
                    setErrors({});
                    setShowPwd(false);
                    setShowCvv(false);
                  }}
                  disabled={!!editItem}
                  aria-pressed={isActive}
                  title={cfg.label}
                  className={`flex h-10 min-w-[4.75rem] shrink-0 items-center justify-center gap-1.5 rounded-sm border px-2 text-center transition-all duration-150 sm:h-auto sm:min-w-0 sm:flex-col sm:gap-1 sm:py-2.5 ${
                    isActive
                      ? `${cfg.bg} border ${cfg.color}`
                      : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                >
                  <Icon size={16} weight="duotone" className={isActive ? cfg.color : ""} />
                  <span className="whitespace-nowrap text-[10px] font-mono leading-tight">{cfg.label.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-3 sm:px-6 sm:py-4 space-y-3">

          {/* Password form */}
          {activeType === "password" && (
            <>
              <Field label="Site Name *" error={errors.site}>
                <input value={site} onChange={e => setSite(e.target.value)} placeholder="e.g. GitHub" className={inputCls(!!errors.site)} />
              </Field>
              <Field label="Username / Email">
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="user@example.com" className={inputCls()} />
              </Field>
              <Field label="Password *" error={errors.password}>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter or generate password"
                    className={inputCls(!!errors.password) + " pr-20"}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    <button type="button" onClick={() => setPassword(generatePassword())} title="Generate" className="p-1 text-muted-foreground hover:text-amber-400 transition-colors">
                      <ArrowsClockwise size={14} weight="duotone" />
                    </button>
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                      {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                    </button>
                  </div>
                </div>
                {pwdStrength && strCfg && (
                  <div className="mt-1.5">
                    <div className="h-1 bg-neutral-800 rounded-full overflow-hidden mb-1">
                      <div className={`h-full rounded-full transition-all duration-300 ${strCfg.bar}`} />
                    </div>
                    <p className={`text-[10px] font-mono ${strCfg.color}`}>Password strength: {strCfg.label}</p>
                  </div>
                )}
              </Field>
              <Field label="URL">
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" className={inputCls()} />
              </Field>
              <Field label="Notes">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." rows={2} className={inputCls() + " resize-none"} />
              </Field>
            </>
          )}

          {/* TOTP form */}
          {activeType === "totp" && (
            <>
              <Field label="Issuer / Service *" error={errors.totpIssuer}>
                <input value={totpIssuer} onChange={e => setTotpIssuer(e.target.value)} placeholder="e.g. Google, GitHub" className={inputCls(!!errors.totpIssuer)} />
              </Field>
              <Field label="Account / Email">
                <input value={totpAccount} onChange={e => setTotpAccount(e.target.value)} placeholder="user@example.com" className={inputCls()} />
              </Field>
              <Field label="Secret Key (Base32) *" error={errors.totpSecret}>
                <input
                  value={totpSecret}
                  onChange={e => setTotpSecret(e.target.value)}
                  onBlur={() => {
                    const normalizedSecret = normalizeTotpSecretInput(totpSecret);
                    if (normalizedSecret) setTotpSecret(normalizedSecret);
                  }}
                  placeholder="JBSWY3DPEHPK3PXP or otpauth://..."
                  className={inputCls(!!errors.totpSecret) + " font-mono tracking-widest"}
                />
              </Field>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-sm px-3 py-2.5 flex gap-2">
                <Warning size={13} weight="duotone" className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-400/80 font-mono leading-relaxed">
                  The secret key is shown in your authenticator app QR code setup. Keep it private - it generates all future TOTP codes.
                </p>
              </div>
            </>
          )}

          {/* Note form */}
          {activeType === "note" && (
            <>
              <Field label="Title *" error={errors.noteTitle}>
                <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="e.g. Server Recovery Codes" className={inputCls(!!errors.noteTitle)} />
              </Field>
              <Field label="Content *" error={errors.noteContent}>
                <textarea value={noteContent} onChange={e => setNoteContent(e.target.value)} placeholder="Enter your secure note content..." rows={6} className={inputCls(!!errors.noteContent) + " resize-none font-mono text-xs leading-relaxed"} />
              </Field>
              <div className="bg-muted/40 border border-border rounded-sm px-3 py-2 flex gap-2">
                <ShieldCheck size={13} weight="duotone" className="text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground font-mono">Note content stays on this device unless you export it manually.</p>
              </div>
            </>
          )}

          {/* SSH key form */}
          {activeType === "ssh" && (
            <>
              <Field label="Key Label *" error={errors.sshName}>
                <input value={sshName} onChange={e => setSshName(e.target.value)} placeholder="e.g. Production Deploy Key" className={inputCls(!!errors.sshName)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Username">
                  <input value={sshUsername} onChange={e => setSshUsername(e.target.value)} placeholder="git, root, deploy" className={inputCls()} />
                </Field>
                <Field label="Port">
                  <input value={sshPort} onChange={e => setSshPort(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="22" className={inputCls() + " font-mono"} />
                </Field>
              </div>
              <Field label="Host">
                <input value={sshHost} onChange={e => setSshHost(e.target.value)} placeholder="server.example.com" className={inputCls()} />
              </Field>
              <Field label="Private Key *" error={errors.sshPrivateKey}>
                <div className="relative">
                  <textarea
                    value={sshPrivateKey}
                    onChange={e => setSshPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={5}
                    className={inputCls(!!errors.sshPrivateKey) + ` resize-none pr-10 font-mono text-xs leading-relaxed ${showPwd ? "" : "text-transparent caret-foreground"}`}
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                  </button>
                  {!showPwd && sshPrivateKey && <div className="absolute inset-x-3 bottom-3 text-xs font-mono text-muted-foreground pointer-events-none">Private key hidden - click eye to review</div>}
                </div>
              </Field>
              <Field label="Public Key">
                <textarea value={sshPublicKey} onChange={e => setSshPublicKey(e.target.value)} placeholder="ssh-ed25519 AAAA..." rows={2} className={inputCls() + " resize-none font-mono text-xs"} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Passphrase">
                  <input type={showPwd ? "text" : "password"} value={sshPassphrase} onChange={e => setSshPassphrase(e.target.value)} placeholder="Optional" className={inputCls() + " font-mono"} />
                </Field>
                <Field label="Fingerprint">
                  <input value={sshFingerprint} onChange={e => setSshFingerprint(e.target.value)} placeholder="SHA256:..." className={inputCls() + " font-mono"} />
                </Field>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-sm px-3 py-2.5 flex gap-2">
                <Warning size={13} weight="duotone" className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-400/80 font-mono leading-relaxed">
                  Store SSH private keys only if you need recovery or device handoff. Prefer passphrase-protected keys.
                </p>
              </div>
            </>
          )}

          {/* Identity form */}
          {activeType === "identity" && (
            <>
              <Field label="Identity Label *" error={errors.identityLabel}>
                <input value={identityLabel} onChange={e => setIdentityLabel(e.target.value)} placeholder="e.g. Personal ID, Work Profile" className={inputCls(!!errors.identityLabel)} />
              </Field>
              <Field label="Full Name *" error={errors.fullName}>
                <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full legal name" className={inputCls(!!errors.fullName)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Email">
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls()} />
                </Field>
                <Field label="Phone">
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+62..." className={inputCls()} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Company">
                  <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company" className={inputCls()} />
                </Field>
                <Field label="Job Title">
                  <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Role" className={inputCls()} />
                </Field>
              </div>
              <Field label="Address">
                <textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Street address" rows={2} className={inputCls() + " resize-none"} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="City">
                  <input value={city} onChange={e => setCity(e.target.value)} placeholder="City" className={inputCls()} />
                </Field>
                <Field label="Region">
                  <input value={region} onChange={e => setRegion(e.target.value)} placeholder="State / Province" className={inputCls()} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Postal Code">
                  <input value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="Postal" className={inputCls()} />
                </Field>
                <Field label="Country">
                  <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Country" className={inputCls()} />
                </Field>
              </div>
              <Field label="Document / ID Number">
                <input value={documentId} onChange={e => setDocumentId(e.target.value)} placeholder="Optional ID reference" className={inputCls() + " font-mono"} />
              </Field>
            </>
          )}

          {/* API key form */}
          {activeType === "apiKey" && (
            <>
              <Field label="API Key Name *" error={errors.apiName}>
                <input value={apiName} onChange={e => setApiName(e.target.value)} placeholder="e.g. Cloudflare deploy token" className={inputCls(!!errors.apiName)} />
              </Field>
              <Field label="Provider">
                <input value={apiProvider} onChange={e => setApiProvider(e.target.value)} placeholder="Cloudflare, GitHub, OpenAI..." className={inputCls()} />
              </Field>
              <Field label="API Key / Token *" error={errors.apiKey}>
                <div className="relative">
                  <textarea
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="Paste token or access key"
                    rows={3}
                    className={inputCls(!!errors.apiKey) + ` resize-none pr-10 font-mono text-xs ${showPwd ? "" : "text-transparent caret-foreground"}`}
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                  </button>
                  {!showPwd && apiKey && <div className="absolute inset-x-3 bottom-3 text-xs font-mono text-muted-foreground pointer-events-none">Token hidden - click eye to review</div>}
                </div>
              </Field>
              <Field label="Secret / Client Secret">
                <input type={showPwd ? "text" : "password"} value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="Optional paired secret" className={inputCls() + " font-mono"} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Scopes / Permissions">
                  <input value={apiScopes} onChange={e => setApiScopes(e.target.value)} placeholder="read:org, d1:edit" className={inputCls()} />
                </Field>
                <Field label="Expires">
                  <input value={apiExpiry} onChange={e => setApiExpiry(e.target.value)} placeholder="YYYY-MM-DD / never" className={inputCls() + " font-mono"} />
                </Field>
              </div>
            </>
          )}

          {/* Wi-Fi form */}
          {activeType === "wifi" && (
            <>
              <Field label="Network Label">
                <input value={wifiName} onChange={e => setWifiName(e.target.value)} placeholder="Home, Office, Lab" className={inputCls()} />
              </Field>
              <Field label="SSID *" error={errors.ssid}>
                <input value={ssid} onChange={e => setSsid(e.target.value)} placeholder="Network name" className={inputCls(!!errors.ssid)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Security">
                  <select value={wifiSecurity} onChange={e => setWifiSecurity(e.target.value)} className={inputCls() + " cursor-pointer"}>
                    <option value="WPA2/WPA3">WPA2/WPA3</option>
                    <option value="WPA3">WPA3</option>
                    <option value="WPA2">WPA2</option>
                    <option value="WEP">WEP</option>
                    <option value="Open">Open</option>
                  </select>
                </Field>
                <Field label="Password *" error={errors.wifiPassword}>
                  <div className="relative">
                    <input type={showPwd ? "text" : "password"} value={wifiPassword} onChange={e => setWifiPassword(e.target.value)} placeholder="Wi-Fi password" className={inputCls(!!errors.wifiPassword) + " pr-10 font-mono"} />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                    </button>
                  </div>
                </Field>
              </div>
              <Field label="Notes">
                <textarea value={wifiNotes} onChange={e => setWifiNotes(e.target.value)} placeholder="Router location, guest notes, VLAN..." rows={2} className={inputCls() + " resize-none"} />
              </Field>
            </>
          )}

          {/* Recovery codes form */}
          {activeType === "recoveryCode" && (
            <>
              <Field label="Recovery Label *" error={errors.recoveryName}>
                <input value={recoveryName} onChange={e => setRecoveryName(e.target.value)} placeholder="e.g. GitHub recovery codes" className={inputCls(!!errors.recoveryName)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Service">
                  <input value={recoveryService} onChange={e => setRecoveryService(e.target.value)} placeholder="GitHub, Google, Ciphora..." className={inputCls()} />
                </Field>
                <Field label="Account">
                  <input value={recoveryAccount} onChange={e => setRecoveryAccount(e.target.value)} placeholder="user@example.com" className={inputCls()} />
                </Field>
              </div>
              <Field label="Recovery Codes *" error={errors.recoveryCodes}>
                <div className="relative">
                  <textarea
                    value={recoveryCodes}
                    onChange={e => setRecoveryCodes(e.target.value)}
                    placeholder="One code per line"
                    rows={6}
                    className={inputCls(!!errors.recoveryCodes) + ` resize-none pr-10 font-mono text-xs leading-relaxed ${showPwd ? "" : "text-transparent caret-foreground"}`}
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                  </button>
                  {!showPwd && recoveryCodes && <div className="absolute inset-x-3 bottom-3 text-xs font-mono text-muted-foreground pointer-events-none">Recovery codes hidden - click eye to review</div>}
                </div>
              </Field>
              <Field label="Notes">
                <textarea value={recoveryNotes} onChange={e => setRecoveryNotes(e.target.value)} placeholder="When these were generated, remaining count, usage rules..." rows={2} className={inputCls() + " resize-none"} />
              </Field>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-sm px-3 py-2.5 flex gap-2">
                <Warning size={13} weight="duotone" className="text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-400/80 font-mono leading-relaxed">
                  Recovery codes are one-time credentials. Mark used codes in notes or rotate them after use.
                </p>
              </div>
            </>
          )}

          {/* Software license form */}
          {activeType === "softwareLicense" && (
            <>
              <Field label="Software Name *" error={errors.softwareName}>
                <input value={softwareName} onChange={e => setSoftwareName(e.target.value)} placeholder="e.g. JetBrains IDE" className={inputCls(!!errors.softwareName)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Vendor">
                  <input value={softwareVendor} onChange={e => setSoftwareVendor(e.target.value)} placeholder="Vendor / publisher" className={inputCls()} />
                </Field>
                <Field label="License Email">
                  <input value={licenseEmail} onChange={e => setLicenseEmail(e.target.value)} placeholder="license@example.com" className={inputCls()} />
                </Field>
              </div>
              <Field label="License Key *" error={errors.licenseKey}>
                <div className="relative">
                  <textarea
                    value={licenseKey}
                    onChange={e => setLicenseKey(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    rows={3}
                    className={inputCls(!!errors.licenseKey) + ` resize-none pr-10 font-mono text-xs ${showPwd ? "" : "text-transparent caret-foreground"}`}
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                  </button>
                  {!showPwd && licenseKey && <div className="absolute inset-x-3 bottom-3 text-xs font-mono text-muted-foreground pointer-events-none">License key hidden - click eye to review</div>}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Seats">
                  <input value={licenseSeats} onChange={e => setLicenseSeats(e.target.value)} placeholder="1, 5, unlimited" className={inputCls()} />
                </Field>
                <Field label="Expires">
                  <input value={licenseExpiry} onChange={e => setLicenseExpiry(e.target.value)} placeholder="YYYY-MM-DD / lifetime" className={inputCls() + " font-mono"} />
                </Field>
              </div>
              <Field label="Notes">
                <textarea value={licenseNotes} onChange={e => setLicenseNotes(e.target.value)} placeholder="Purchase ID, renewal terms, device notes..." rows={2} className={inputCls() + " resize-none"} />
              </Field>
            </>
          )}

          {/* Database credential form */}
          {activeType === "databaseCredential" && (
            <>
              <Field label="Credential Label *" error={errors.dbName}>
                <input value={dbName} onChange={e => setDbName(e.target.value)} placeholder="e.g. Production Postgres" className={inputCls(!!errors.dbName)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Engine">
                  <select value={dbEngine} onChange={e => setDbEngine(e.target.value)} className={inputCls() + " cursor-pointer"}>
                    <option value="PostgreSQL">PostgreSQL</option>
                    <option value="MySQL">MySQL</option>
                    <option value="MariaDB">MariaDB</option>
                    <option value="MongoDB">MongoDB</option>
                    <option value="Redis">Redis</option>
                    <option value="SQLite/libSQL">SQLite/libSQL</option>
                    <option value="SQL Server">SQL Server</option>
                    <option value="Other">Other</option>
                  </select>
                </Field>
                <Field label="Database">
                  <input value={dbDatabase} onChange={e => setDbDatabase(e.target.value)} placeholder="database name" className={inputCls()} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Host" error={errors.dbHost}>
                  <input value={dbHost} onChange={e => setDbHost(e.target.value)} placeholder="db.example.com" className={inputCls(!!errors.dbHost)} />
                </Field>
                <Field label="Port">
                  <input value={dbPort} onChange={e => setDbPort(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="5432" className={inputCls() + " font-mono"} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Username *" error={errors.dbUsername}>
                  <input value={dbUsername} onChange={e => setDbUsername(e.target.value)} placeholder="db_user" className={inputCls(!!errors.dbUsername)} />
                </Field>
                <Field label="Password *" error={errors.dbPassword}>
                  <div className="relative">
                    <input type={showPwd ? "text" : "password"} value={dbPassword} onChange={e => setDbPassword(e.target.value)} placeholder="Database password" className={inputCls(!!errors.dbPassword) + " pr-10 font-mono"} />
                    <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                    </button>
                  </div>
                </Field>
              </div>
              <Field label="Connection URL">
                <div className="relative">
                  <textarea
                    value={dbConnectionUrl}
                    onChange={e => setDbConnectionUrl(e.target.value)}
                    placeholder="postgres://user:password@host:5432/db"
                    rows={2}
                    className={inputCls() + ` resize-none pr-10 font-mono text-xs ${showPwd ? "" : "text-transparent caret-foreground"}`}
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPwd ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                  </button>
                  {!showPwd && dbConnectionUrl && <div className="absolute inset-x-3 bottom-3 text-xs font-mono text-muted-foreground pointer-events-none">Connection URL hidden - click eye to review</div>}
                </div>
              </Field>
              <Field label="Notes">
                <textarea value={dbNotes} onChange={e => setDbNotes(e.target.value)} placeholder="Environment, SSL mode, rotation date, read/write scope..." rows={2} className={inputCls() + " resize-none"} />
              </Field>
            </>
          )}

          {/* Card form */}
          {activeType === "card" && (
            <>
              <Field label="Cardholder Name *" error={errors.cardholder}>
                <input value={cardholder} onChange={e => setCardholder(e.target.value)} placeholder="JOHN DOE" className={inputCls(!!errors.cardholder) + " uppercase font-mono"} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">Brand</p>
                  <select value={brand} onChange={e => setBrand(e.target.value)} className={inputCls() + " cursor-pointer"}>
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                    <option value="Amex">Amex</option>
                    <option value="JCB">JCB</option>
                  </select>
                </div>
                <Field label="Expiry (MM/YY) *" error={errors.expiry}>
                  <input value={expiry} onChange={e => handleFormatExpiry(e.target.value)} placeholder="MM/YY" maxLength={5} className={inputCls(!!errors.expiry) + " font-mono tracking-widest"} />
                </Field>
              </div>
              <Field label="Card Number *" error={errors.cardNumber}>
                <input value={cardNumber} onChange={e => setCardNumber(e.target.value.replace(/\D/g, "").slice(0, 16))} placeholder="1234 5678 9012 3456" className={inputCls(!!errors.cardNumber) + " font-mono tracking-widest"} />
              </Field>
              <Field label="CVV">
                <div className="relative">
                  <input type={showCvv ? "text" : "password"} value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="..." maxLength={4} className={inputCls() + " pr-10 font-mono tracking-widest"} />
                  <button type="button" onClick={() => setShowCvv(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showCvv ? <EyeSlash size={14} weight="duotone" /> : <Eye size={14} weight="duotone" />}
                  </button>
                </div>
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6 sm:py-4 border-t border-border bg-muted/40 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={12} weight="duotone" className="text-emerald-400" />
            <span className="text-[10px] font-mono text-muted-foreground">Encrypted local vault only</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-mono text-muted-foreground border border-border rounded-sm hover:text-foreground hover:border-foreground/20 transition-all duration-150">
              Cancel
            </button>
            <button onClick={handleSave} className="px-5 py-2 text-xs font-mono font-bold bg-amber-500 text-neutral-950 rounded-sm hover:bg-amber-400 transition-all duration-150">
              {editItem ? "Save Changes" : "Add Item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-1.5">{label}</p>
      {children}
      {error && (
        <p className="text-[10px] font-mono text-red-400 mt-1 flex items-center gap-1">
          <Warning size={10} weight="duotone" />
          {error}
        </p>
      )}
    </div>
  );
}

function inputCls(hasError = false) {
  return `w-full bg-background border ${hasError ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/20" : "border-border focus:border-amber-500 focus:ring-amber-500/20"} text-sm text-foreground placeholder:text-muted-foreground rounded-sm px-3 py-2 focus:outline-none focus:ring-1 transition-all duration-150`;
}



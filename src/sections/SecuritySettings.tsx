import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Timer,
  LockKey,
  Export,
  Star,
  Moon,
  Sun,
  CheckCircle,
  CaretDown,
  ShieldCheck,
  FloppyDisk,
  Fingerprint,
  Trash,
  CloudCheck,
  Copy,
  SignOut,
  UserCircle,
  Key,
  ArrowsDownUp,
  Database,
  GearSix,
} from "@phosphor-icons/react";
import { APP_NAME } from "../lib/app-config";
import { ROUTE_PATHS } from "../lib/routes";
import { LANGUAGE_OPTIONS, useI18n } from "../lib/i18n";
import {
  SYNC_PROVIDER_TYPES,
  getSyncProviderDisplayLabel,
  isBridgeSyncProvider,
  type AccountSession,
  type DeviceSessionState,
  type EmailVerificationStatus,
  type RecoveryStatus,
  type SyncProfile,
  type SyncProviderType,
} from "../lib/account-client";
import type { SyncConflictResolution } from "../lib/sync-conflict-resolution";
import type { AutoSyncRuntimeState, SyncStatusSummary } from "../lib/sync-status";

type PinState = "active" | "legacy" | "inactive";
type SettingsSurface = "settings" | "sync" | "account" | "security" | "data" | "preferences";
type SyncDisconnectMode = "disable_only" | "cleanup_known_remote";
type SyncPanelTone = "success" | "warning" | "neutral";
const EMAIL_VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{24,256}$/;

function getSyncEndpointLabel(providerType: SyncProviderType) {
  if (providerType === "external_turso") return "Turso DB URL";
  if (isBridgeSyncProvider(providerType)) return "Bridge URL";
  return "D1 REST URL";
}

function getSyncEndpointPlaceholder(providerType: SyncProviderType) {
  if (providerType === "external_turso") return "libsql://your-db-name.turso.io";
  if (isBridgeSyncProvider(providerType)) return "https://your-ciphora-bridge.example.com";
  return "https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database/<database_id>/query";
}

function getSyncTokenLabel(providerType: SyncProviderType) {
  if (providerType === "external_turso") return "Turso Token";
  if (isBridgeSyncProvider(providerType)) return "Bridge Token";
  return "Cloudflare D1 Token";
}

function getSyncTokenPlaceholder(providerType: SyncProviderType) {
  if (providerType === "external_turso") return "Paste Turso token";
  if (isBridgeSyncProvider(providerType)) return "Paste Ciphora bridge Bearer token";
  return "Paste scoped Cloudflare API token";
}

function getSyncConnectionHelp(providerType: SyncProviderType) {
  if (providerType === "external_turso") {
    return "Test koneksi Turso menjalankan SELECT 1 langsung dari browser ini. Gunakan URL database Turso dan auth token yang masih aktif.";
  }

  if (isBridgeSyncProvider(providerType)) {
    return `Test koneksi ${getSyncProviderDisplayLabel(providerType)} memanggil endpoint /health dengan Bearer token. Endpoint harus bridge milik user yang kompatibel dengan kontrak Ciphora, bukan connection string database mentah.`;
  }

  return "D1 Direct memanggil Cloudflare D1 REST API dari browser ini. Gunakan token Cloudflare yang scoped minimal ke D1 Read/Write untuk database tersebut. Jika browser/CORS menolak, gunakan D1 Bridge.";
}

function getSyncProviderSetupNote(providerType: SyncProviderType) {
  if (providerType === "external_turso") {
    return "Mode direct yang cocok untuk user Turso. Browser akan memakai URL dan token Turso hanya saat vault unlocked.";
  }

  if (providerType === "external_d1_bridge") {
    return "Mode D1 yang direkomendasikan. Token Cloudflare bisa ditahan di Worker bridge user, bukan langsung dipakai browser.";
  }

  if (isBridgeSyncProvider(providerType)) {
    return `${getSyncProviderDisplayLabel(providerType)} memakai Ciphora HTTP Bridge contract. Simpan DB password/service key di bridge milik user; browser hanya memegang URL bridge dan Bearer token terenkripsi.`;
  }

  return "Mode advanced. Browser harus memegang Cloudflare API token saat sync berjalan, jadi gunakan token scoped minimal dan fallback ke D1 Bridge jika request diblokir.";
}

function getSyncToneClasses(tone: SyncPanelTone) {
  if (tone === "success") return "border-emerald-500/30 bg-emerald-500/5";
  if (tone === "warning") return "border-amber-400/30 bg-amber-400/5";
  return "border-border bg-muted/30";
}

function getSyncToneIconClasses(tone: SyncPanelTone) {
  if (tone === "success") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  if (tone === "warning") return "bg-amber-400/10 text-amber-400 border-amber-400/30";
  return "bg-muted text-muted-foreground border-border";
}

function removeEmailVerificationTokenFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hadToken = url.searchParams.has("verify_email_token")
    || url.searchParams.has("emailVerificationToken");
  url.searchParams.delete("verify_email_token");
  url.searchParams.delete("emailVerificationToken");
  if (!hadToken) return;
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

interface SecuritySettingsProps {
  surface?: SettingsSurface;
  onExportVault?: () => void;
  onImportVault?: (file: File) => Promise<{ ok: boolean; message: string }>;
  onResetLocalStorage?: () => Promise<{ ok: boolean; message?: string }>;
  pinState?: PinState;
  onSetupPin?: () => void;
  onRemovePin?: () => void;
  onRemoveLegacyPin?: () => void;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  autoLockDurationSeconds?: number | null;
  onAutoLockDurationChange?: (durationSeconds: number | null) => void;
  accountSession?: AccountSession | null;
  accountSessionLoading?: boolean;
  deviceSessionState?: DeviceSessionState | null;
  deviceSessionLoading?: boolean;
  emailVerificationStatus?: EmailVerificationStatus | null;
  emailVerificationLoading?: boolean;
  recoveryStatus?: RecoveryStatus | null;
  recoveryStatusLoading?: boolean;
  syncProfile?: SyncProfile | null;
  syncStatusSummary?: SyncStatusSummary | null;
  syncProfileLoading?: boolean;
  autoSyncEnabled?: boolean;
  autoSyncRuntime?: AutoSyncRuntimeState | null;
  onCreateAccount?: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  onLoginAccount?: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  onLogoutAccount?: () => Promise<{ ok: boolean; message?: string }>;
  onRefreshDeviceSessions?: () => Promise<{ ok: boolean; message?: string }>;
  onRevokeAccountSession?: (sessionId: string) => Promise<{ ok: boolean; message?: string }>;
  onRevokeAllAccountSessions?: (includeCurrent?: boolean) => Promise<{ ok: boolean; message?: string }>;
  onSetDeviceTrusted?: (deviceId: string, trusted: boolean) => Promise<{ ok: boolean; message?: string }>;
  onChangeAccountPassword?: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>;
  onSendEmailVerification?: (email: string) => Promise<{ ok: boolean; message?: string }>;
  onConfirmEmailVerification?: (token: string) => Promise<{ ok: boolean; message?: string }>;
  onSetupRecoveryKey?: () => Promise<{ ok: boolean; message?: string; recoveryKey?: string }>;
  onSetAutoSyncEnabled?: (enabled: boolean) => void;
  onSaveSyncProfile?: (input: {
    providerType: SyncProviderType;
    labelHint?: string;
    endpoint: string;
    accessToken: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onLoadSyncProfileForEdit?: () => Promise<{
    ok: boolean;
    message?: string;
    config?: {
      providerType: SyncProviderType;
      endpoint: string;
      accessToken: string;
      labelHint: string | null;
      savedAt: string | null;
    };
  }>;
  onDeleteSyncProfile?: (mode?: SyncDisconnectMode) => Promise<{ ok: boolean; message?: string }>;
  onTestSyncProfileConnection?: (input: {
    providerType: SyncProviderType;
    endpoint: string;
    accessToken: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onMigrateSyncProfile?: (input: {
    providerType: SyncProviderType;
    labelHint?: string;
    endpoint: string;
    accessToken: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onPushTursoSync?: () => Promise<{ ok: boolean; message?: string }>;
  onPullTursoSync?: () => Promise<{ ok: boolean; message?: string }>;
  onPushD1BridgeSync?: () => Promise<{ ok: boolean; message?: string }>;
  onPullD1BridgeSync?: () => Promise<{ ok: boolean; message?: string }>;
  onPushD1DirectSync?: () => Promise<{ ok: boolean; message?: string }>;
  onPullD1DirectSync?: () => Promise<{ ok: boolean; message?: string }>;
  onResolveSyncConflict?: (input: {
    conflictId: string;
    resolution: SyncConflictResolution;
  }) => Promise<{ ok: boolean; message?: string }>;
}

export default function SecuritySettings({
  surface = "settings",
  onExportVault,
  onImportVault,
  onResetLocalStorage,
  pinState = "inactive",
  onSetupPin,
  onRemovePin,
  onRemoveLegacyPin,
  theme = "dark",
  onToggleTheme,
  autoLockDurationSeconds = 300,
  onAutoLockDurationChange,
  accountSession = null,
  accountSessionLoading = false,
  deviceSessionState = null,
  deviceSessionLoading = false,
  emailVerificationStatus = null,
  emailVerificationLoading = false,
  recoveryStatus = null,
  recoveryStatusLoading = false,
  syncProfile = null,
  syncStatusSummary = null,
  syncProfileLoading = false,
  autoSyncEnabled = false,
  autoSyncRuntime = null,
  onCreateAccount,
  onLoginAccount,
  onLogoutAccount,
  onRefreshDeviceSessions,
  onRevokeAccountSession,
  onRevokeAllAccountSessions,
  onSetDeviceTrusted,
  onChangeAccountPassword,
  onSendEmailVerification,
  onConfirmEmailVerification,
  onSetupRecoveryKey,
  onSetAutoSyncEnabled,
  onSaveSyncProfile,
  onLoadSyncProfileForEdit,
  onDeleteSyncProfile,
  onTestSyncProfileConnection,
  onMigrateSyncProfile,
  onPushTursoSync,
  onPullTursoSync,
  onPushD1BridgeSync,
  onPullD1BridgeSync,
  onPushD1DirectSync,
  onPullD1DirectSync,
  onResolveSyncConflict,
}: SecuritySettingsProps) {
  const { locale, setLocale, t } = useI18n();
  const isSyncSurface = surface === "sync";
  const isHubSurface = surface === "settings";
  const isAccountSurface = surface === "account";
  const isSecuritySurface = surface === "security";
  const isDataSurface = surface === "data";
  const isPreferencesSurface = surface === "preferences";
  const showAccountShell = isAccountSurface || isSecuritySurface || isSyncSurface;
  const localizedAutoLockOptions = [
    { label: locale === "id" ? "1 menit" : "1 minute", value: "1" },
    { label: locale === "id" ? "5 menit (default)" : "5 minutes (default)", value: "5" },
    { label: locale === "id" ? "15 menit" : "15 minutes", value: "15" },
    { label: locale === "id" ? "30 menit" : "30 minutes", value: "30" },
    { label: locale === "id" ? "1 jam" : "1 hour", value: "60" },
    { label: locale === "id" ? "Tidak pernah" : "Never", value: "never" },
  ];
  const [exportStatus, setExportStatus] = useState<
    "idle" | "success" | "loading"
  >("idle");
  const [importStatus, setImportStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [localResetStatus, setLocalResetStatus] = useState<"idle" | "confirm" | "loading" | "success" | "error">("idle");
  const [localResetMessage, setLocalResetMessage] = useState("");
  const localResetTimerRef = useRef<number | null>(null);
  const [accountMode, setAccountMode] = useState<"create" | "login">("create");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountConfirmPassword, setAccountConfirmPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [accountMessage, setAccountMessage] = useState("");
  const [deviceActionStatus, setDeviceActionStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [deviceActionMessage, setDeviceActionMessage] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [verificationActionStatus, setVerificationActionStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [verificationMessage, setVerificationMessage] = useState("");
  const pendingAutoVerificationTokenRef = useRef<string | null>(null);
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordChangeStatus, setPasswordChangeStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [passwordChangeMessage, setPasswordChangeMessage] = useState("");
  const [recoveryActionStatus, setRecoveryActionStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState("");
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [syncProviderType, setSyncProviderType] = useState<SyncProviderType>("external_turso");
  const [syncLabelHint, setSyncLabelHint] = useState("");
  const [syncEndpoint, setSyncEndpoint] = useState("");
  const [syncAccessToken, setSyncAccessToken] = useState("");
  const [syncProfileStatus, setSyncProfileStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [syncProfileMessage, setSyncProfileMessage] = useState("");
  const [syncConnectionStatus, setSyncConnectionStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [syncConnectionMessage, setSyncConnectionMessage] = useState("");
  const [syncRuntimeStatus, setSyncRuntimeStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [syncRuntimeMessage, setSyncRuntimeMessage] = useState("");
  const [migrationProviderType, setMigrationProviderType] = useState<SyncProviderType>("external_d1_bridge");
  const [migrationLabelHint, setMigrationLabelHint] = useState("");
  const [migrationEndpoint, setMigrationEndpoint] = useState("");
  const [migrationAccessToken, setMigrationAccessToken] = useState("");
  const [migrationStatus, setMigrationStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [migrationMessage, setMigrationMessage] = useState("");
  const [migrationConnectionStatus, setMigrationConnectionStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [migrationConnectionMessage, setMigrationConnectionMessage] = useState("");

  const handleExport = () => {
    setExportStatus("loading");
    setTimeout(() => {
      setExportStatus("success");
      onExportVault?.();
      setTimeout(() => setExportStatus("idle"), 3000);
    }, 1200);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportVault) return;
    setImportStatus("idle");
    try {
      const result = await onImportVault(file);
      if (result.ok) {
        setImportStatus("success");
        setTimeout(() => setImportStatus("idle"), 4000);
      } else {
        setImportStatus("error");
        setTimeout(() => setImportStatus("idle"), 4000);
      }
    } catch {
      setImportStatus("error");
      setTimeout(() => setImportStatus("idle"), 4000);
    }
    // Reset file input
    e.target.value = "";
  };

  const handleResetLocalStorage = async () => {
    if (!onResetLocalStorage) return;

    if (localResetStatus !== "confirm") {
      setLocalResetStatus("confirm");
      setLocalResetMessage("Klik Confirm Reset dalam 10 detik untuk menghapus vault lokal browser ini. Account Ciphora dan data BYODB Turso/D1 tidak dihapus.");
      if (localResetTimerRef.current) {
        window.clearTimeout(localResetTimerRef.current);
      }
      localResetTimerRef.current = window.setTimeout(() => {
        setLocalResetStatus("idle");
        setLocalResetMessage("");
        localResetTimerRef.current = null;
      }, 10000);
      return;
    }

    if (localResetTimerRef.current) {
      window.clearTimeout(localResetTimerRef.current);
      localResetTimerRef.current = null;
    }

    setLocalResetStatus("loading");
    setLocalResetMessage("Mereset storage lokal Ciphora dan membuka ulang flow unlock...");

    const result = await onResetLocalStorage();
    if (result.ok) {
      setLocalResetStatus("success");
      setLocalResetMessage(result.message ?? "Storage lokal Ciphora direset.");
      return;
    }

    setLocalResetStatus("error");
    setLocalResetMessage(result.message ?? "Gagal mereset storage lokal Ciphora.");
  };

  const autoLockValue =
    autoLockDurationSeconds === null
      ? "never"
      : String(Math.round((autoLockDurationSeconds ?? 300) / 60));
  const handleAutoLockChange = (value: string) => {
    onAutoLockDurationChange?.(value === "never" ? null : Number(value) * 60);
  };
  const isAutoLockActive = autoLockDurationSeconds !== null;
  const pinBadgeClass =
    pinState === "active"
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
      : pinState === "legacy"
        ? "bg-amber-400/10 text-amber-400 border border-amber-400/30"
        : "bg-muted text-muted-foreground border border-border";
  const pinBadgeLabel =
    pinState === "active"
      ? "WRAPPED"
      : pinState === "legacy"
        ? "LEGACY"
        : "OFF";
  const pinDescription =
    pinState === "active"
      ? "Quick unlock aktif di browser ini. PIN 6 digit akan membuka vault lewat wrapped local key, sementara master password tetap dipakai untuk setup dan recovery."
      : pinState === "legacy"
        ? "PIN lama dari build sebelumnya masih tersimpan. Ganti ke wrapped quick unlock yang baru atau hapus data legacy ini."
        : "Aktifkan PIN 6 digit untuk quick unlock di browser ini. Setup tetap membutuhkan sesi vault yang sudah dibuka dengan master password.";
  const pinPrimaryLabel =
    pinState === "active"
      ? "Change PIN"
      : pinState === "legacy"
        ? "Set New PIN"
        : "Set PIN";
  const isAccountConnected = !!accountSession;
  const accountBadgeClass = isAccountConnected
    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
    : "bg-amber-400/10 text-amber-400 border border-amber-400/30";
  const accountBadgeLabel = accountSessionLoading
    ? "CHECKING"
    : isAccountConnected
      ? "CONNECTED"
      : "LOCAL ONLY";
  const deviceSummary = deviceSessionState?.summary;
  const activeAccountSessionCount = deviceSummary?.activeSessionCount ?? 0;
  const trustedAccountDeviceCount = deviceSummary?.trustedDeviceCount ?? 0;
  const currentAccountDevice = deviceSessionState?.devices.find((device) => device.isCurrentDevice) ?? null;
  const activeAccountSessions = deviceSessionState?.sessions.filter((session) => session.status === "active") ?? [];
  const accountSessionsPreview = deviceSessionState?.sessions.slice(0, 8) ?? [];
  const accountAuditEventsPreview = deviceSessionState?.auditEvents.slice(0, 8) ?? [];
  const deviceManagementBadgeClass = deviceSessionLoading
    ? "bg-muted text-muted-foreground border border-border"
    : activeAccountSessionCount > 1
      ? "bg-amber-400/10 text-amber-400 border border-amber-400/30"
      : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  const deviceManagementBadgeLabel = deviceSessionLoading
    ? "LOADING"
    : `${activeAccountSessionCount} ACTIVE`;
  const emailVerified = !!emailVerificationStatus?.verified;
  const emailBadgeClass = emailVerificationLoading
    ? "bg-muted text-muted-foreground border border-border"
    : emailVerified
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
      : "bg-amber-400/10 text-amber-400 border border-amber-400/30";
  const emailBadgeLabel = emailVerificationLoading
    ? "CHECKING"
    : emailVerified
      ? "VERIFIED"
      : "UNVERIFIED";
  const isRecoveryEnabled = !!recoveryStatus?.enabled;
  const isRecoveryUpgradeRequired = !!recoveryStatus?.upgradeRequired || recoveryStatus?.status === "upgrade_required";
  const recoveryBadgeClass = recoveryStatusLoading
    ? "bg-muted text-muted-foreground border border-border"
    : isRecoveryEnabled
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
      : isRecoveryUpgradeRequired
        ? "bg-amber-400/10 text-amber-400 border border-amber-400/30"
      : "bg-amber-400/10 text-amber-400 border border-amber-400/30";
  const recoveryBadgeLabel = recoveryStatusLoading
    ? "CHECKING"
    : isRecoveryEnabled
      ? "READY"
      : isRecoveryUpgradeRequired
        ? "UPGRADE"
      : "NOT SET";
  const isSyncProfileActive = !!syncProfile;
  const syncProfileBadgeClass = syncProfileLoading
    ? "bg-muted text-muted-foreground border border-border"
    : isSyncProfileActive
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
      : "bg-amber-400/10 text-amber-400 border border-amber-400/30";
  const syncProfileBadgeLabel = syncProfileLoading
    ? "CHECKING"
    : isSyncProfileActive
      ? "ACTIVE"
      : "NOT SET";
  const syncProviderLabel = getSyncProviderDisplayLabel(syncProviderType);
  const syncEndpointLabel = getSyncEndpointLabel(syncProviderType);
  const syncEndpointPlaceholder = getSyncEndpointPlaceholder(syncProviderType);
  const syncTokenLabel = getSyncTokenLabel(syncProviderType);
  const activeSyncProviderLabel = syncProfile ? getSyncProviderDisplayLabel(syncProfile.providerType) : "Turso";
  const migrationProviderLabel = getSyncProviderDisplayLabel(migrationProviderType);
  const migrationEndpointLabel = getSyncEndpointLabel(migrationProviderType);
  const migrationEndpointPlaceholder = getSyncEndpointPlaceholder(migrationProviderType);
  const migrationTokenLabel = getSyncTokenLabel(migrationProviderType);
  const syncStatusBadgeClass = syncStatusSummary?.statusTone === "warning"
    ? "bg-amber-400/10 text-amber-400 border border-amber-400/30"
    : syncStatusSummary?.statusTone === "success"
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
      : "bg-muted text-muted-foreground border border-border";
  const autoSyncBadgeClass = autoSyncRuntime?.status === "error"
    ? "bg-red-500/10 text-red-400 border border-red-500/30"
    : autoSyncRuntime?.status === "ready"
      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
      : autoSyncRuntime?.status === "scheduled" || autoSyncRuntime?.status === "syncing" || autoSyncRuntime?.status === "paused"
        ? "bg-amber-400/10 text-amber-400 border border-amber-400/30"
        : "bg-muted text-muted-foreground border border-border";
  const autoSyncBadgeLabel = autoSyncRuntime?.status === "syncing"
    ? "SYNCING"
    : autoSyncRuntime?.status === "scheduled"
      ? "QUEUED"
      : autoSyncRuntime?.status === "ready"
        ? "READY"
        : autoSyncRuntime?.status === "paused"
          ? "PAUSED"
          : autoSyncRuntime?.status === "error"
            ? "ERROR"
            : "OFF";

  const formatSyncTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : "Belum ada");
  const getSessionStatusClass = (status: string, isCurrent?: boolean) => {
    if (isCurrent) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
    if (status === "active") return "bg-amber-400/10 text-amber-400 border border-amber-400/30";
    if (status === "revoked") return "bg-red-500/10 text-red-400 border border-red-500/30";
    return "bg-muted text-muted-foreground border border-border";
  };
  const getAuditSeverityClass = (severity: string) => {
    if (severity === "critical") return "bg-red-500/10 text-red-400 border border-red-500/30";
    if (severity === "warning") return "bg-amber-400/10 text-amber-400 border border-amber-400/30";
    return "bg-muted text-muted-foreground border border-border";
  };
  const formatAuditMetadata = (metadata: Record<string, string | number | boolean | null>) => {
    const entries = Object.entries(metadata).filter(([key]) => key !== "shardId").slice(0, 3);
    if (entries.length === 0) return "";
    return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" - ");
  };
  const formatConflictReason = (reason: string) => {
    if (reason === "remote_deleted_before_push") return "Remote deleted before push";
    if (reason === "remote_changed_before_delete") return "Remote changed before delete";
    return "Remote changed before push";
  };
  const hasDraftSyncCredentials = syncEndpoint.trim().length > 0 && syncAccessToken.trim().length > 0;
  const hasKnownProviderSnapshot = !!syncStatusSummary && (
    syncStatusSummary.remoteActiveCount > 0
    || syncStatusSummary.remoteTombstoneCount > 0
    || !!syncStatusSummary.lastPushedAt
    || !!syncStatusSummary.lastPulledAt
  );
  const pendingLocalSyncCount = syncStatusSummary
    ? syncStatusSummary.pendingLocalItemCount + syncStatusSummary.pendingLocalDeleteCount
    : 0;
  const syncHealthItems: Array<{ title: string; detail: string; tone: SyncPanelTone }> = syncStatusSummary
    ? [
      {
        title: "Account gate",
        detail: isAccountConnected
          ? "Account session aktif. Browser ini boleh menyimpan encrypted sync profile."
          : "Login Ciphora account dulu sebelum sync profile bisa disimpan atau dipulihkan di device baru.",
        tone: isAccountConnected ? "success" : "warning",
      },
      {
        title: "Provider profile",
        detail: isSyncProfileActive
          ? `${syncStatusSummary.providerLabel} aktif sebagai satu-satunya sync profile account ini.`
          : "Belum ada provider aktif. Vault tetap local-only sampai encrypted sync profile disimpan.",
        tone: isSyncProfileActive ? "success" : "warning",
      },
      {
        title: "Provider snapshot",
        detail: hasKnownProviderSnapshot
          ? `${syncStatusSummary.remoteActiveCount} active record dan ${syncStatusSummary.remoteTombstoneCount} tombstone terakhir diketahui browser ini.`
          : "Belum ada snapshot provider yang diketahui. Lakukan pull/push pertama setelah profil aktif.",
        tone: hasKnownProviderSnapshot ? "success" : isSyncProfileActive ? "warning" : "neutral",
      },
      {
        title: "Local drift",
        detail: pendingLocalSyncCount > 0
          ? `${pendingLocalSyncCount} perubahan lokal menunggu push atau auto-sync.`
          : "Tidak ada perubahan lokal yang menunggu push berdasarkan snapshot terakhir yang diketahui.",
        tone: pendingLocalSyncCount > 0 ? "warning" : "success",
      },
      {
        title: "Conflict journal",
        detail: syncStatusSummary.unresolvedConflictCount > 0
          ? `${syncStatusSummary.unresolvedConflictCount} konflik belum resolve. Push berisiko tetap diblokir.`
          : "Tidak ada konflik terbuka untuk provider aktif.",
        tone: syncStatusSummary.unresolvedConflictCount > 0 ? "warning" : "success",
      },
      {
        title: "Recovery safety",
        detail: isRecoveryEnabled
          ? "Recovery Key siap. User masih harus menyimpan kunci itu sendiri di luar Ciphora."
          : "Recovery Key belum siap. Jika account password lupa total, vault/sync profile lama tidak bisa dipulihkan.",
        tone: isRecoveryEnabled ? "success" : "warning",
      },
      {
        title: "Auto-sync runtime",
        detail: autoSyncEnabled
          ? autoSyncRuntime?.message ?? "Smart auto-sync aktif untuk tab unlocked ini."
          : "Auto-sync mati. Gunakan manual push/pull atau aktifkan auto-sync setelah profil stabil.",
        tone: autoSyncEnabled && autoSyncRuntime?.status !== "error" ? "success" : autoSyncEnabled ? "warning" : "neutral",
      },
    ]
    : [];
  const providerSetupSteps: Array<{ step: string; title: string; detail: string; tone: SyncPanelTone }> = [
    {
      step: "01",
      title: "Pilih provider",
      detail: `${syncProviderLabel} dipilih. ${getSyncProviderSetupNote(syncProviderType)}`,
      tone: "success",
    },
    {
      step: "02",
      title: "Isi endpoint dan token",
      detail: hasDraftSyncCredentials
        ? "Endpoint dan token sudah terisi di form ini. Nilai plaintext tetap lokal di tab browser sampai disimpan terenkripsi."
        : `Isi ${syncEndpointLabel} dan ${syncTokenLabel}. Jangan tempel format ENV_KEY=..., cukup nilainya saja.`,
      tone: hasDraftSyncCredentials ? "success" : "warning",
    },
    {
      step: "03",
      title: "Test connection",
      detail: syncConnectionStatus === "success"
        ? "Provider berhasil diuji dari browser ini."
        : syncConnectionStatus === "error"
          ? "Test provider gagal. Perbaiki endpoint/token sebelum menyimpan profile."
          : "Jalankan Test Connection sebelum menyimpan agar kesalahan URL/token ketahuan lebih awal.",
      tone: syncConnectionStatus === "success" ? "success" : syncConnectionStatus === "error" ? "warning" : "neutral",
    },
    {
      step: "04",
      title: "Save dan first sync",
      detail: isSyncProfileActive
        ? `Profile aktif. Lakukan pull untuk membaca remote terbaru atau push untuk mengirim delta lokal ke ${activeSyncProviderLabel}.`
        : "Setelah save, lakukan first pull/push sesuai kondisi provider. Jangan aktifkan cleanup sebelum minimal satu pull selesai.",
      tone: isSyncProfileActive ? "success" : syncConnectionStatus === "success" ? "neutral" : "warning",
    },
  ];

  useEffect(() => {
    if (!isAccountConnected) {
      setGeneratedRecoveryKey("");
      setRecoveryMessage("");
      setRecoveryActionStatus("idle");
      setRecoveryCopied(false);
      setVerificationEmail("");
      setVerificationToken("");
      setVerificationMessage("");
      setVerificationActionStatus("idle");
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      setPasswordChangeMessage("");
      setPasswordChangeStatus("idle");
      setSyncProviderType("external_turso");
      setSyncLabelHint("");
      setSyncEndpoint("");
      setSyncAccessToken("");
      setSyncProfileStatus("idle");
      setSyncProfileMessage("");
      setSyncConnectionStatus("idle");
      setSyncConnectionMessage("");
      setSyncRuntimeStatus("idle");
      setSyncRuntimeMessage("");
      setMigrationProviderType("external_d1_bridge");
      setMigrationLabelHint("");
      setMigrationEndpoint("");
      setMigrationAccessToken("");
      setMigrationStatus("idle");
      setMigrationMessage("");
      setMigrationConnectionStatus("idle");
      setMigrationConnectionMessage("");
    }
  }, [isAccountConnected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("verify_email_token") ?? params.get("emailVerificationToken");
    if (token && EMAIL_VERIFICATION_TOKEN_PATTERN.test(token)) {
      pendingAutoVerificationTokenRef.current = token;
      setVerificationToken(token);
      setVerificationActionStatus("idle");
      setVerificationMessage("Link verifikasi terdeteksi. Ciphora akan memverifikasi otomatis setelah sesi account siap.");
    }
  }, []);

  useEffect(() => {
    return () => {
      if (localResetTimerRef.current) {
        window.clearTimeout(localResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!syncProfile) {
      setSyncRuntimeStatus("idle");
      setSyncRuntimeMessage("");
      setMigrationStatus("idle");
      setMigrationMessage("");
      setMigrationConnectionStatus("idle");
      setMigrationConnectionMessage("");
      return;
    }
    setSyncProviderType(syncProfile.providerType);
    setSyncLabelHint(syncProfile.labelHint ?? "");
    setSyncEndpoint("");
    setSyncAccessToken("");
    setSyncRuntimeStatus("idle");
    setSyncRuntimeMessage("");
    setMigrationProviderType(SYNC_PROVIDER_TYPES.find((providerType) => providerType !== syncProfile.providerType) ?? "external_turso");
    setMigrationLabelHint(syncProfile.labelHint ?? "");
    setMigrationEndpoint("");
    setMigrationAccessToken("");
    setMigrationStatus("idle");
    setMigrationMessage("");
    setMigrationConnectionStatus("idle");
    setMigrationConnectionMessage("");
  }, [syncProfile]);

  const clearAccountStatus = () => {
    if (accountStatus === "error" || accountStatus === "success") {
      setAccountStatus("idle");
      setAccountMessage("");
    }
  };

  const clearVerificationStatus = () => {
    if (verificationActionStatus === "error" || verificationActionStatus === "success") {
      setVerificationActionStatus("idle");
      setVerificationMessage("");
    }
  };

  const clearPasswordChangeStatus = () => {
    if (passwordChangeStatus === "error" || passwordChangeStatus === "success") {
      setPasswordChangeStatus("idle");
      setPasswordChangeMessage("");
    }
  };

  const clearSyncProfileStatus = () => {
    if (syncProfileStatus === "error" || syncProfileStatus === "success") {
      setSyncProfileStatus("idle");
      setSyncProfileMessage("");
    }
  };

  const clearSyncConnectionStatus = () => {
    if (syncConnectionStatus === "error" || syncConnectionStatus === "success") {
      setSyncConnectionStatus("idle");
      setSyncConnectionMessage("");
    }
  };

  const clearSyncRuntimeStatus = () => {
    if (syncRuntimeStatus === "error" || syncRuntimeStatus === "success") {
      setSyncRuntimeStatus("idle");
      setSyncRuntimeMessage("");
    }
  };

  const handleAccountSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!accountEmail.trim()) {
      setAccountStatus("error");
      setAccountMessage("Email account wajib diisi.");
      return;
    }

    if (accountPassword.length < 10) {
      setAccountStatus("error");
      setAccountMessage("Account password minimal 10 karakter.");
      return;
    }

    if (accountMode === "create" && accountPassword !== accountConfirmPassword) {
      setAccountStatus("error");
      setAccountMessage("Konfirmasi account password belum sama.");
      return;
    }

    setAccountStatus("loading");
    setAccountMessage(accountMode === "create" ? "Membuat Ciphora account..." : "Menghubungkan Ciphora account...");

    const result = accountMode === "create"
      ? await onCreateAccount?.(accountEmail, accountPassword)
      : await onLoginAccount?.(accountEmail, accountPassword);

    if (result?.ok) {
      setAccountStatus("success");
      setAccountMessage(accountMode === "create" ? "Ciphora account tersambung." : "Ciphora account aktif di browser ini.");
      setAccountPassword("");
      setAccountConfirmPassword("");
      return;
    }

    setAccountStatus("error");
    setAccountMessage(result?.message ?? "Account action gagal.");
    setAccountPassword("");
    setAccountConfirmPassword("");
  };

  const handleAccountLogout = async () => {
    setAccountStatus("loading");
    setAccountMessage("Mengakhiri Ciphora account session...");
    const result = await onLogoutAccount?.();
    if (result?.ok) {
      setAccountStatus("success");
      setAccountMessage("Ciphora account session selesai. Vault lokal tetap terbuka.");
      return;
    }
    setAccountStatus("error");
    setAccountMessage(result?.message ?? "Gagal logout dari Ciphora account.");
  };

  const runDeviceAction = async (
    loadingMessage: string,
    action: () => Promise<{ ok: boolean; message?: string } | undefined>,
  ) => {
    setDeviceActionStatus("loading");
    setDeviceActionMessage(loadingMessage);
    const result = await action();
    if (result?.ok) {
      setDeviceActionStatus("success");
      setDeviceActionMessage(result.message ?? "Device/session diperbarui.");
      return;
    }
    setDeviceActionStatus("error");
    setDeviceActionMessage(result?.message ?? "Device/session action gagal.");
  };

  const handleRefreshDeviceSessions = () => {
    void runDeviceAction(
      "Merefresh daftar device, session, dan audit event...",
      async () => onRefreshDeviceSessions?.(),
    );
  };

  const handleRevokeSession = (sessionId: string) => {
    void runDeviceAction(
      "Mencabut account session yang dipilih...",
      async () => onRevokeAccountSession?.(sessionId),
    );
  };

  const handleRevokeOtherSessions = () => {
    void runDeviceAction(
      "Mencabut semua session device lain...",
      async () => onRevokeAllAccountSessions?.(false),
    );
  };

  const handleRevokeAllSessions = () => {
    void runDeviceAction(
      "Mencabut semua session termasuk browser ini...",
      async () => onRevokeAllAccountSessions?.(true),
    );
  };

  const handleSetDeviceTrusted = (deviceId: string, trusted: boolean) => {
    void runDeviceAction(
      trusted ? "Menandai device sebagai trusted..." : "Mencabut trusted marker device...",
      async () => onSetDeviceTrusted?.(deviceId, trusted),
    );
  };

  const handleSendVerificationEmail = async () => {
    if (!verificationEmail.trim()) {
      setVerificationActionStatus("error");
      setVerificationMessage("Masukkan email account untuk mengirim link verifikasi.");
      return;
    }

    setVerificationActionStatus("loading");
    setVerificationMessage("Mengirim link verifikasi email...");
    const result = await onSendEmailVerification?.(verificationEmail);
    if (result?.ok) {
      setVerificationActionStatus("success");
      setVerificationMessage(result.message ?? "Link verifikasi dikirim. Buka inbox lalu klik link tersebut.");
      return;
    }

    setVerificationActionStatus("error");
    setVerificationMessage(result?.message ?? "Gagal mengirim link verifikasi email.");
  };

  const handleConfirmVerificationToken = async () => {
    if (!verificationToken.trim()) {
      setVerificationActionStatus("error");
      setVerificationMessage("Token verifikasi wajib diisi. Buka link dari email atau paste token di sini.");
      return;
    }

    setVerificationActionStatus("loading");
    setVerificationMessage("Memverifikasi email...");
    const result = await onConfirmEmailVerification?.(verificationToken);
    if (result?.ok) {
      setVerificationActionStatus("success");
      setVerificationToken("");
      pendingAutoVerificationTokenRef.current = null;
      removeEmailVerificationTokenFromUrl();
      setVerificationMessage(result.message ?? "Email account berhasil diverifikasi.");
      return;
    }

    setVerificationActionStatus("error");
    setVerificationMessage(result?.message ?? "Gagal memverifikasi email.");
  };

  useEffect(() => {
    const token = verificationToken.trim();
    if (!token || pendingAutoVerificationTokenRef.current !== token) return;

    if (emailVerified) {
      pendingAutoVerificationTokenRef.current = null;
      setVerificationToken("");
      setVerificationActionStatus("success");
      setVerificationMessage("Email account sudah terverifikasi.");
      removeEmailVerificationTokenFromUrl();
      return;
    }

    if (
      !isAccountConnected
      || accountSessionLoading
      || emailVerificationLoading
      || verificationActionStatus === "loading"
      || !onConfirmEmailVerification
    ) {
      return;
    }

    pendingAutoVerificationTokenRef.current = null;
    setVerificationActionStatus("loading");
    setVerificationMessage("Link verifikasi terdeteksi. Memverifikasi email otomatis...");

    void onConfirmEmailVerification(token)
      .then((result) => {
        removeEmailVerificationTokenFromUrl();
        if (result?.ok) {
          setVerificationActionStatus("success");
          setVerificationToken("");
          setVerificationMessage(result.message ?? "Email account berhasil diverifikasi.");
          return;
        }

        setVerificationActionStatus("error");
        setVerificationMessage(result?.message ?? "Gagal memverifikasi email. Klik Confirm Email untuk mencoba lagi.");
      })
      .catch(() => {
        removeEmailVerificationTokenFromUrl();
        setVerificationActionStatus("error");
        setVerificationMessage("Gagal memverifikasi email. Klik Confirm Email untuk mencoba lagi.");
      });
  }, [
    accountSessionLoading,
    emailVerificationLoading,
    emailVerified,
    isAccountConnected,
    onConfirmEmailVerification,
    verificationActionStatus,
    verificationToken,
  ]);

  const handlePasswordChangeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!passwordCurrent) {
      setPasswordChangeStatus("error");
      setPasswordChangeMessage("Account password lama wajib diisi.");
      return;
    }

    if (passwordNext.length < 10) {
      setPasswordChangeStatus("error");
      setPasswordChangeMessage("Account password baru minimal 10 karakter.");
      return;
    }

    if (passwordNext !== passwordConfirm) {
      setPasswordChangeStatus("error");
      setPasswordChangeMessage("Konfirmasi account password baru belum sama.");
      return;
    }

    if (passwordNext === passwordCurrent) {
      setPasswordChangeStatus("error");
      setPasswordChangeMessage("Account password baru harus berbeda dari password lama.");
      return;
    }

    setPasswordChangeStatus("loading");
    setPasswordChangeMessage("Mengganti account password dan merotasi wrapper...");

    const result = await onChangeAccountPassword?.(passwordCurrent, passwordNext);
    if (result?.ok) {
      setPasswordChangeStatus("success");
      setPasswordChangeMessage("Account password diganti. Sesi lain sudah dicabut.");
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      return;
    }

    setPasswordChangeStatus("error");
    setPasswordChangeMessage(result?.message ?? "Gagal mengganti account password.");
    setPasswordCurrent("");
    setPasswordNext("");
    setPasswordConfirm("");
  };

  const handleRecoverySetup = async () => {
    setRecoveryActionStatus("loading");
    setRecoveryCopied(false);
    setGeneratedRecoveryKey("");
    setRecoveryMessage(
      isRecoveryUpgradeRequired
        ? "Upgrading Recovery Key with verifier-backed reset support..."
        : isRecoveryEnabled
          ? "Rotating Recovery Key..."
          : "Generating Recovery Key...",
    );

    const result = await onSetupRecoveryKey?.();
    if (result?.ok && result.recoveryKey) {
      setRecoveryActionStatus("success");
      setGeneratedRecoveryKey(result.recoveryKey);
      setRecoveryMessage(
        isRecoveryUpgradeRequired
          ? "Recovery Key baru sudah verifier-backed. Simpan sekarang; key lama tidak dipakai lagi untuk reset."
          : "Recovery Key dibuat. Simpan sekarang; Ciphora tidak bisa menampilkannya lagi.",
      );
      return;
    }

    setRecoveryActionStatus("error");
    setRecoveryMessage(result?.message ?? "Gagal membuat Recovery Key.");
  };

  const handleCopyRecoveryKey = async () => {
    if (!generatedRecoveryKey || !navigator.clipboard) {
      setRecoveryCopied(false);
      return;
    }

    await navigator.clipboard.writeText(generatedRecoveryKey);
    setRecoveryCopied(true);
    setTimeout(() => setRecoveryCopied(false), 2500);
  };

  const handleSyncProfileSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!syncEndpoint.trim()) {
      setSyncProfileStatus("error");
      setSyncProfileMessage(`${syncEndpointLabel} wajib diisi.`);
      return;
    }

    if (!syncAccessToken.trim()) {
      setSyncProfileStatus("error");
      setSyncProfileMessage(`${syncTokenLabel} wajib diisi.`);
      return;
    }

    if (syncLabelHint.trim().length > 80) {
      setSyncProfileStatus("error");
      setSyncProfileMessage("Label sync maksimal 80 karakter.");
      return;
    }

    setSyncProfileStatus("loading");
    setSyncConnectionStatus("idle");
    setSyncConnectionMessage("");
    setSyncRuntimeStatus("idle");
    setSyncRuntimeMessage("");
    setSyncProfileMessage(`Menyimpan profil sync ${syncProviderLabel} terenkripsi...`);

    const result = await onSaveSyncProfile?.({
      providerType: syncProviderType,
      labelHint: syncLabelHint.trim() || undefined,
      endpoint: syncEndpoint,
      accessToken: syncAccessToken,
    });

    if (result?.ok) {
      setSyncProfileStatus("success");
      setSyncProfileMessage("Profil sync terenkripsi tersimpan. URL dan token tidak ditampilkan lagi di browser.");
      setSyncEndpoint("");
      setSyncAccessToken("");
      return;
    }

    setSyncProfileStatus("error");
    setSyncProfileMessage(result?.message ?? "Gagal menyimpan sync profile.");
  };

  const handleSyncProfileDisconnect = async (mode: SyncDisconnectMode) => {
    setSyncProfileStatus("loading");
    setSyncConnectionStatus("idle");
    setSyncConnectionMessage("");
    setSyncRuntimeStatus("idle");
    setSyncRuntimeMessage("");
    setSyncProfileMessage(
      mode === "cleanup_known_remote"
        ? `Menonaktifkan profil sync dan membersihkan record ${activeSyncProviderLabel} yang sudah dikenal browser ini...`
        : "Menonaktifkan profil sync terenkripsi tanpa mengubah data remote...",
    );

    const result = await onDeleteSyncProfile?.(mode);
    if (result?.ok) {
      setSyncProfileStatus("success");
      setSyncProfileMessage(result.message ?? "Profil sync dinonaktifkan. Vault tetap lokal sampai kamu menyimpan profil baru.");
      setSyncEndpoint("");
      setSyncAccessToken("");
      return;
    }

    setSyncProfileStatus("error");
    setSyncProfileMessage(result?.message ?? "Gagal menonaktifkan sync profile.");
  };

  const handleLoadSyncProfileForEdit = async () => {
    setSyncProfileStatus("loading");
    setSyncConnectionStatus("idle");
    setSyncConnectionMessage("");
    setSyncRuntimeStatus("idle");
    setSyncRuntimeMessage("");
    setSyncProfileMessage("Membuka profil sync terenkripsi lokal ke form ini...");

    const result = await onLoadSyncProfileForEdit?.();
    if (result?.ok && result.config) {
      setSyncProviderType(result.config.providerType);
      setSyncLabelHint(result.config.labelHint ?? "");
      setSyncEndpoint(result.config.endpoint);
      setSyncAccessToken(result.config.accessToken);
      setSyncProfileStatus("success");
      setSyncProfileMessage(
        result.message
        ?? `Profil sync tersimpan dimuat lokal ke form ini${result.config.savedAt ? ` dari snapshot ${new Date(result.config.savedAt).toLocaleString()}` : ""}.`,
      );
      return;
    }

    setSyncProfileStatus("error");
    setSyncProfileMessage(result?.message ?? "Gagal memuat sync profile tersimpan.");
  };

  const handleSyncProfileConnectionTest = async () => {
    if (!syncEndpoint.trim()) {
      setSyncConnectionStatus("error");
      setSyncConnectionMessage(`${syncEndpointLabel} wajib diisi sebelum koneksi diuji.`);
      return;
    }

    if (!syncAccessToken.trim()) {
      setSyncConnectionStatus("error");
      setSyncConnectionMessage(`${syncTokenLabel} wajib diisi sebelum koneksi diuji.`);
      return;
    }

    setSyncConnectionStatus("loading");
    setSyncProfileStatus("idle");
    setSyncProfileMessage("");
    setSyncRuntimeStatus("idle");
    setSyncRuntimeMessage("");
    setSyncConnectionMessage(`Menguji koneksi ${syncProviderLabel} dari browser ini...`);

    const result = await onTestSyncProfileConnection?.({
      providerType: syncProviderType,
      endpoint: syncEndpoint,
      accessToken: syncAccessToken,
    });

    if (result?.ok) {
      setSyncConnectionStatus("success");
      setSyncConnectionMessage(result.message ?? "Koneksi provider valid.");
      return;
    }

    setSyncConnectionStatus("error");
    setSyncConnectionMessage(result?.message ?? "Koneksi provider gagal diuji.");
  };

  const handleMigrationConnectionTest = async () => {
    if (!migrationEndpoint.trim()) {
      setMigrationConnectionStatus("error");
      setMigrationConnectionMessage(`${migrationEndpointLabel} wajib diisi sebelum koneksi target diuji.`);
      return;
    }

    if (!migrationAccessToken.trim()) {
      setMigrationConnectionStatus("error");
      setMigrationConnectionMessage(`${migrationTokenLabel} wajib diisi sebelum koneksi target diuji.`);
      return;
    }

    setMigrationConnectionStatus("loading");
    setMigrationStatus("idle");
    setMigrationMessage("");
    setMigrationConnectionMessage(`Menguji koneksi target ${migrationProviderLabel} dari browser ini...`);

    const result = await onTestSyncProfileConnection?.({
      providerType: migrationProviderType,
      endpoint: migrationEndpoint,
      accessToken: migrationAccessToken,
    });

    if (result?.ok) {
      setMigrationConnectionStatus("success");
      setMigrationConnectionMessage(result.message ?? "Koneksi target provider valid.");
      return;
    }

    setMigrationConnectionStatus("error");
    setMigrationConnectionMessage(result?.message ?? "Koneksi target provider gagal diuji.");
  };

  const handleMigrationSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!syncProfile) {
      setMigrationStatus("error");
      setMigrationMessage("Belum ada sync profile aktif yang bisa dijadikan sumber migrasi.");
      return;
    }

    if (migrationProviderType === syncProfile.providerType) {
      setMigrationStatus("error");
      setMigrationMessage("Target provider harus berbeda dari provider aktif sekarang.");
      return;
    }

    if (!migrationEndpoint.trim()) {
      setMigrationStatus("error");
      setMigrationMessage(`${migrationEndpointLabel} target wajib diisi.`);
      return;
    }

    if (!migrationAccessToken.trim()) {
      setMigrationStatus("error");
      setMigrationMessage(`${migrationTokenLabel} target wajib diisi.`);
      return;
    }

    if (migrationLabelHint.trim().length > 80) {
      setMigrationStatus("error");
      setMigrationMessage("Label target maksimal 80 karakter.");
      return;
    }

    setMigrationStatus("loading");
    setMigrationConnectionStatus("idle");
    setMigrationConnectionMessage("");
    setMigrationMessage(`Memigrasikan snapshot terenkripsi dari ${activeSyncProviderLabel} ke ${migrationProviderLabel}...`);

    const result = await onMigrateSyncProfile?.({
      providerType: migrationProviderType,
      labelHint: migrationLabelHint.trim() || undefined,
      endpoint: migrationEndpoint,
      accessToken: migrationAccessToken,
    });

    if (result?.ok) {
      setMigrationStatus("success");
      setMigrationMessage(result.message ?? "Migrasi provider selesai.");
      setMigrationEndpoint("");
      setMigrationAccessToken("");
      return;
    }

    setMigrationStatus("error");
    setMigrationMessage(result?.message ?? "Migrasi provider gagal.");
  };

  const handlePushTursoSync = async () => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Mengenkripsi vault lokal dan mengirim snapshot ke Turso...");
    const result = await onPushTursoSync?.();

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Push ke Turso selesai.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Push ke Turso gagal.");
  };

  const handlePullTursoSync = async () => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Mengambil snapshot vault terenkripsi dari Turso...");
    const result = await onPullTursoSync?.();

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Pull dari Turso selesai.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Pull dari Turso gagal.");
  };

  const handlePushD1BridgeSync = async () => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Mengenkripsi vault lokal dan mengirim snapshot ke D1 Bridge...");
    const result = await onPushD1BridgeSync?.();

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Push ke D1 Bridge selesai.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Push ke D1 Bridge gagal.");
  };

  const handlePullD1BridgeSync = async () => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Mengambil snapshot vault terenkripsi dari D1 Bridge...");
    const result = await onPullD1BridgeSync?.();

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Pull dari D1 Bridge selesai.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Pull dari D1 Bridge gagal.");
  };

  const handlePushD1DirectSync = async () => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Mengenkripsi vault lokal dan mengirim snapshot ke D1 Direct...");
    const result = await onPushD1DirectSync?.();

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Push ke D1 Direct selesai.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Push ke D1 Direct gagal.");
  };

  const handlePullD1DirectSync = async () => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Mengambil snapshot vault terenkripsi dari D1 Direct...");
    const result = await onPullD1DirectSync?.();

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Pull dari D1 Direct selesai.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Pull dari D1 Direct gagal.");
  };

  const handleResolveSyncConflict = async (conflictId: string, resolution: SyncConflictResolution) => {
    setSyncRuntimeStatus("loading");
    setSyncRuntimeMessage("Membaca snapshot provider dan menerapkan keputusan konflik...");
    const result = await onResolveSyncConflict?.({ conflictId, resolution });

    if (result?.ok) {
      setSyncRuntimeStatus("success");
      setSyncRuntimeMessage(result.message ?? "Konflik sync berhasil di-resolve.");
      return;
    }

    setSyncRuntimeStatus("error");
    setSyncRuntimeMessage(result?.message ?? "Konflik sync gagal di-resolve.");
  };

  const surfaceMeta = {
    settings: {
      eyebrow: t("settings.surface.settings.eyebrow", { appName: APP_NAME }),
      title: t("settings.surface.settings.title"),
      description: t("settings.surface.settings.description"),
      icon: GearSix,
      footer: t("settings.surface.settings.footer"),
      badge: t("settings.badge.control"),
      maxWidthClass: "max-w-5xl",
    },
    account: {
      eyebrow: t("settings.surface.account.eyebrow", { appName: APP_NAME }),
      title: t("settings.surface.account.title"),
      description: t("settings.surface.account.description"),
      icon: UserCircle,
      footer: t("settings.surface.account.footer"),
      badge: t("settings.badge.account"),
      maxWidthClass: "max-w-3xl",
    },
    security: {
      eyebrow: t("settings.surface.security.eyebrow", { appName: APP_NAME }),
      title: t("settings.surface.security.title"),
      description: t("settings.surface.security.description"),
      icon: ShieldCheck,
      footer: t("settings.surface.security.footer"),
      badge: t("settings.badge.security"),
      maxWidthClass: "max-w-5xl",
    },
    data: {
      eyebrow: t("settings.surface.data.eyebrow", { appName: APP_NAME }),
      title: t("settings.surface.data.title"),
      description: t("settings.surface.data.description"),
      icon: Database,
      footer: t("settings.surface.data.footer"),
      badge: t("settings.badge.localData"),
      maxWidthClass: "max-w-3xl",
    },
    preferences: {
      eyebrow: t("settings.surface.preferences.eyebrow", { appName: APP_NAME }),
      title: t("settings.surface.preferences.title"),
      description: t("settings.surface.preferences.description"),
      icon: GearSix,
      footer: t("settings.surface.preferences.footer"),
      badge: t("settings.badge.localPrefs"),
      maxWidthClass: "max-w-3xl",
    },
    sync: {
      eyebrow: t("settings.surface.sync.eyebrow", { appName: APP_NAME }),
      title: t("settings.surface.sync.title"),
      description: t("settings.surface.sync.description"),
      icon: ArrowsDownUp,
      footer: t("settings.surface.sync.footer"),
      badge: t("settings.badge.sync"),
      maxWidthClass: "max-w-5xl",
    },
  }[surface];
  const HeaderIcon = surfaceMeta.icon;
  const settingsHubItems = [
    {
      title: t("nav.account"),
      description: t("settings.hub.account.desc"),
      path: ROUTE_PATHS.accountSettings,
      icon: UserCircle,
      status: accountBadgeLabel,
      statusClass: accountBadgeClass,
    },
    {
      title: t("settings.surface.security.title"),
      description: t("settings.hub.security.desc"),
      path: ROUTE_PATHS.securityCenter,
      icon: ShieldCheck,
      status: isRecoveryEnabled ? "RECOVERY READY" : "RECOVERY CHECK",
      statusClass: recoveryBadgeClass,
    },
    {
      title: t("nav.sync"),
      description: t("settings.hub.sync.desc"),
      path: ROUTE_PATHS.syncSettings,
      icon: ArrowsDownUp,
      status: syncStatusSummary?.statusLabel ?? "LOCAL ONLY",
      statusClass: syncStatusBadgeClass,
    },
    {
      title: t("settings.surface.data.title"),
      description: t("settings.hub.data.desc"),
      path: ROUTE_PATHS.dataSettings,
      icon: Database,
      status: "ENCRYPTED",
      statusClass: "bg-amber-400/10 text-amber-400 border border-amber-400/30",
    },
    {
      title: t("nav.preferences"),
      description: t("settings.hub.preferences.desc"),
      path: ROUTE_PATHS.preferencesSettings,
      icon: GearSix,
      status: pinBadgeLabel,
      statusClass: pinBadgeClass,
    },
  ];

  return (
    <section
      id={`${surface}-settings`}
      className="bg-background min-h-screen py-12 px-4 md:px-8"
    >
      <div className={`${surfaceMeta.maxWidthClass} mx-auto`}>
        {/* Page Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <HeaderIcon
              weight="duotone"
              size={22}
              className="text-amber-400"
            />
            <span className="text-xs font-mono tracking-widest text-amber-400 uppercase">
              {surfaceMeta.eyebrow}
            </span>
          </div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-foreground tracking-tight">
            {surfaceMeta.title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {surfaceMeta.description}
          </p>
        </div>

        <div className={isHubSurface ? "grid gap-4 md:grid-cols-2" : "space-y-0 border border-border rounded-sm overflow-hidden"}>
          {isHubSurface && settingsHubItems.map((item) => {
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className="group border border-border rounded-sm bg-card px-5 py-5 transition-all duration-150 hover:border-amber-400/60 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground transition-colors duration-150 group-hover:border-amber-400/60 group-hover:text-amber-400">
                      <ItemIcon weight="duotone" size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  </div>
                  <Badge className={`shrink-0 text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${item.statusClass}`}>
                    {item.status}
                  </Badge>
                </div>
              </Link>
            );
          })}

          {isPreferencesSurface && (
            <>
          {/* Group 1: Session security */}
          <div className="bg-card">
            {/* Group Header */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
              <LockKey weight="duotone" size={16} className="text-amber-400" />
              <span className="text-xs font-mono font-semibold tracking-widest text-amber-400 uppercase">
                {t("settings.preferences.sessionSecurity")}
              </span>
              {isAutoLockActive && (
                <Badge className="ml-auto bg-amber-400/10 text-amber-400 border border-amber-400/30 text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5">
                  AKTIF
                </Badge>
              )}
            </div>

            {/* Auto-lock Timeout Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 border-b border-border hover:border-l-2 hover:border-l-amber-400 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Timer
                  weight="duotone"
                  size={18}
                  className="text-muted-foreground mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                    {t("settings.preferences.autoLockTimeout")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.preferences.autoLockDesc")}
                  </p>
                </div>
              </div>
              <div className="relative sm:w-48 shrink-0">
                <select
                  value={autoLockValue}
                  onChange={(e) => handleAutoLockChange(e.target.value)}
                  className="w-full appearance-none bg-muted border border-border text-foreground text-sm rounded-sm px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150 cursor-pointer"
                >
                  {localizedAutoLockOptions.map((opt) => (
                    <option
                      key={opt.value}
                      value={opt.value}
                      className="bg-neutral-900"
                    >
                      {opt.label}
                    </option>
                  ))}
                </select>
                <CaretDown
                  weight="bold"
                  size={12}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </div>

          </div>

          <Separator className="bg-border" />
            </>
          )}

          {/* Group 2: Ciphora account */}
          {showAccountShell && (
          <div className="bg-card">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
              <CloudCheck weight="duotone" size={16} className="text-amber-400" />
              <span className="text-xs font-mono font-semibold tracking-widest text-amber-400 uppercase">
                Ciphora Account
              </span>
              <Badge className={`ml-auto text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${accountBadgeClass}`}>
                {accountBadgeLabel}
              </Badge>
            </div>

            <div className="px-5 py-4 border-b border-border">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <UserCircle weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {isAccountConnected ? "Account session aktif" : "Hubungkan account tanpa mengubah vault lokal"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {isAccountConnected
                        ? `Shard ${accountSession.user.shardId} aktif sampai ${new Date(accountSession.session.expiresAt).toLocaleString()}. Vault item tetap tersimpan lokal sampai BYODB sync diaktifkan.`
                        : "Account Ciphora hanya mengelola identitas dan encrypted root-key wrapper. Vault data tidak dikirim ke server Ciphora."}
                    </p>
                  </div>
                </div>
                {isAccountConnected && onLogoutAccount && (
                  <button
                    type="button"
                    onClick={handleAccountLogout}
                    disabled={accountStatus === "loading"}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 border border-border text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                  >
                    <SignOut weight="duotone" size={13} />
                    Logout Account
                  </button>
                )}
              </div>
            </div>

            {isAccountConnected && (
              <div className="px-5 py-4 border-b border-border bg-muted/10 space-y-4">
                {isSecuritySurface && (
                  <>
                <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <ShieldCheck weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Device & Session Management
                          </p>
                          <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${deviceManagementBadgeClass}`}>
                            {deviceManagementBadgeLabel}
                          </Badge>
                          {currentAccountDevice?.trusted && (
                            <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              TRUSTED DEVICE
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Lihat session account aktif, cabut session device lain, tandai device dipercaya, dan cek audit log login/sync profile. Ciphora tidak menampilkan raw IP, user-agent, atau session token.
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={handleRefreshDeviceSessions}
                        disabled={deviceActionStatus === "loading" || deviceSessionLoading || !onRefreshDeviceSessions}
                        className="inline-flex items-center justify-center gap-1.5 border border-border text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                      >
                        <Timer weight="duotone" size={13} />
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={handleRevokeOtherSessions}
                        disabled={deviceActionStatus === "loading" || activeAccountSessions.filter((session) => !session.isCurrent).length === 0 || !onRevokeAllAccountSessions}
                        className="inline-flex items-center justify-center gap-1.5 border border-amber-400/50 text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-amber-400 hover:border-amber-400 hover:bg-amber-400/10 transition-all duration-150 disabled:opacity-60"
                      >
                        <SignOut weight="duotone" size={13} />
                        Revoke Other Devices
                      </button>
                      <button
                        type="button"
                        onClick={handleRevokeAllSessions}
                        disabled={deviceActionStatus === "loading" || activeAccountSessions.length === 0 || !onRevokeAllAccountSessions}
                        className="inline-flex items-center justify-center gap-1.5 border border-red-800 text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-red-400 hover:bg-red-500/10 hover:border-red-600 transition-all duration-150 disabled:opacity-60"
                      >
                        <Trash weight="duotone" size={13} />
                        Revoke All + Logout
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Last Login
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {formatSyncTime(deviceSummary?.lastLoginAt)}
                      </p>
                    </div>
                    <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Active Sessions
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {activeAccountSessionCount}
                      </p>
                    </div>
                    <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Trusted Devices
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {trustedAccountDeviceCount}
                      </p>
                    </div>
                  </div>

                  {deviceActionMessage && (
                    <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      deviceActionStatus === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : deviceActionStatus === "success"
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                    }`}>
                      {deviceActionMessage}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Devices
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        {deviceSessionLoading ? "Loading..." : `${deviceSessionState?.devices.length ?? 0} known`}
                      </p>
                    </div>
                    {(deviceSessionState?.devices.length ?? 0) === 0 ? (
                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                        Belum ada device metadata. Klik Refresh setelah account session aktif.
                      </div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {deviceSessionState?.devices.slice(0, 6).map((device) => (
                          <div key={device.deviceId} className="border border-border rounded-sm bg-background/60 px-3 py-3 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {device.label}
                                  {device.isCurrentDevice ? " - Current" : ""}
                                </p>
                                <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                  Last login {formatSyncTime(device.lastLoginAt)}
                                </p>
                                <p className="text-[11px] text-muted-foreground font-mono">
                                  Last seen {formatSyncTime(device.lastSeenAt)}
                                </p>
                              </div>
                              <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${
                                device.trusted
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                  : "bg-muted text-muted-foreground border border-border"
                              }`}>
                                {device.trusted ? "TRUSTED" : "UNTRUSTED"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] text-muted-foreground">
                                {device.activeSessionCount} active / {device.sessionCount} total sessions
                              </p>
                              <button
                                type="button"
                                onClick={() => handleSetDeviceTrusted(device.deviceId, !device.trusted)}
                                disabled={deviceActionStatus === "loading" || !onSetDeviceTrusted}
                                className="inline-flex items-center justify-center gap-1.5 border border-border text-[10px] font-mono uppercase tracking-wide px-2.5 py-1.5 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                              >
                                <ShieldCheck weight="duotone" size={12} />
                                {device.trusted ? "Untrust" : "Trust"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Sessions
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Recent 8
                      </p>
                    </div>
                    <div className="space-y-2">
                      {accountSessionsPreview.map((session) => (
                        <div key={session.sessionId} className="border border-border rounded-sm bg-background/60 px-3 py-2">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-foreground">
                                  {session.deviceLabel}
                                </p>
                                <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${getSessionStatusClass(session.status, session.isCurrent)}`}>
                                  {session.isCurrent ? "CURRENT" : session.status.toUpperCase()}
                                </Badge>
                                {session.trustedDevice && (
                                  <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                    TRUSTED DEVICE
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                Login {formatSyncTime(session.createdAt)} - Last seen {formatSyncTime(session.lastSeenAt)}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-mono">
                                Expires {formatSyncTime(session.expiresAt)}
                                {session.revokedAt ? ` - Revoked ${formatSyncTime(session.revokedAt)}` : ""}
                              </p>
                            </div>
                            {!session.isCurrent && session.status === "active" && (
                              <button
                                type="button"
                                onClick={() => handleRevokeSession(session.sessionId)}
                                disabled={deviceActionStatus === "loading" || !onRevokeAccountSession}
                                className="shrink-0 inline-flex items-center justify-center gap-1.5 border border-red-800 text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-red-400 hover:bg-red-500/10 hover:border-red-600 transition-all duration-150 disabled:opacity-60"
                              >
                                <Trash weight="duotone" size={13} />
                                Revoke
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Login / Sync Audit Log
                      </p>
                      <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                        ACCOUNT LOCAL
                      </Badge>
                    </div>
                    <div className="border border-border rounded-sm overflow-hidden">
                      {accountAuditEventsPreview.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-muted-foreground bg-muted/20">
                          Belum ada audit event login/sync profile untuk account ini.
                        </div>
                      ) : (
                        accountAuditEventsPreview.map((event, index) => (
                          <div key={event.eventId} className={`px-3 py-2.5 bg-background/60 ${index > 0 ? "border-t border-border" : ""}`}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-foreground">
                                    {event.label}
                                  </p>
                                  <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${getAuditSeverityClass(event.severity)}`}>
                                    {event.severity.toUpperCase()}
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                  {event.type} - {formatSyncTime(event.createdAt)}
                                </p>
                                {formatAuditMetadata(event.metadata) && (
                                  <p className="text-[11px] text-muted-foreground font-mono mt-1">
                                    {formatAuditMetadata(event.metadata)}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Sync vault manual/auto ke BYODB berjalan langsung dari browser ke provider user, jadi server Ciphora hanya bisa mengaudit perubahan sync profile, bukan isi item atau setiap record push/pull.
                    </p>
                  </div>
                </div>
                  </>
                )}

                {isAccountSurface && (
                  <>
                <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <CheckCircle weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Email Verification
                          </p>
                          <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${emailBadgeClass}`}>
                            {emailBadgeLabel}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Verifikasi inbox dipakai untuk account recovery gate. Ciphora tetap hanya menyimpan hash email, jadi masukkan email saat perlu mengirim link.
                        </p>
                        {emailVerificationStatus?.verifiedAt && (
                          <p className="text-[11px] text-muted-foreground font-mono mt-2">
                            Verified {new Date(emailVerificationStatus.verifiedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {!emailVerified && (
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="space-y-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Account Email
                        </span>
                        <input
                          type="email"
                          value={verificationEmail}
                          onChange={(event) => {
                            setVerificationEmail(event.target.value);
                            clearVerificationStatus();
                          }}
                          autoComplete="email"
                          className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                          placeholder="you@example.com"
                          disabled={verificationActionStatus === "loading"}
                        />
                      </label>
                      <Button
                        type="button"
                        onClick={handleSendVerificationEmail}
                        disabled={verificationActionStatus === "loading" || !onSendEmailVerification}
                        className="self-end bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                      >
                        Send Verify Email
                      </Button>
                    </div>
                  )}

                  {!emailVerified && (
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="space-y-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Verification Token
                        </span>
                        <input
                          type="text"
                          value={verificationToken}
                          onChange={(event) => {
                            pendingAutoVerificationTokenRef.current = null;
                            setVerificationToken(event.target.value);
                            clearVerificationStatus();
                          }}
                          autoComplete="off"
                          className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150 font-mono"
                          placeholder="Filled automatically when opening the email link"
                          disabled={verificationActionStatus === "loading"}
                        />
                      </label>
                      <Button
                        type="button"
                        onClick={handleConfirmVerificationToken}
                        disabled={verificationActionStatus === "loading" || !onConfirmEmailVerification}
                        className="self-end border border-border bg-background text-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:border-amber-400 hover:text-amber-400 transition-all duration-150"
                      >
                        Confirm Email
                      </Button>
                    </div>
                  )}

                  {verificationMessage && (
                    <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      verificationActionStatus === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : verificationActionStatus === "success" || emailVerified
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                    }`}>
                      {verificationMessage}
                    </div>
                  )}
                </div>
                  </>
                )}

                {isSyncSurface && (
                  <>
                {syncStatusSummary && (
                  <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <ArrowsDownUp weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">
                              Sync Status Center
                            </p>
                            <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${syncStatusBadgeClass}`}>
                              {syncStatusSummary.statusLabel}
                            </Badge>
                            <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                              {syncStatusSummary.syncBehaviorLabel}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                            {syncStatusSummary.statusDetail}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] font-mono text-muted-foreground">
                        {syncStatusSummary.providerLabel}
                        {syncStatusSummary.profileLabelHint ? ` - ${syncStatusSummary.profileLabelHint}` : ""}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Mode
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {syncStatusSummary.mode === "local_only" ? "Local-Only Vault" : `Connected Sync - ${syncStatusSummary.providerLabel}`}
                        </p>
                      </div>

                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Pending Local Items
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {syncStatusSummary.pendingLocalItemCount}
                        </p>
                      </div>

                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Pending Local Deletes
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {syncStatusSummary.pendingLocalDeleteCount}
                        </p>
                      </div>

                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Provider Snapshot
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {syncStatusSummary.remoteActiveCount} active
                          {syncStatusSummary.remoteTombstoneCount > 0 ? ` - ${syncStatusSummary.remoteTombstoneCount} tombstone` : ""}
                        </p>
                      </div>

                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Last Push
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {formatSyncTime(syncStatusSummary.lastPushedAt)}
                        </p>
                      </div>

                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Last Pull
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {formatSyncTime(syncStatusSummary.lastPulledAt)}
                        </p>
                      </div>

                      <div className="border border-border rounded-sm bg-muted/30 px-3 py-3 space-y-1">
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Unresolved Conflicts
                        </p>
                        <p className={syncStatusSummary.unresolvedConflictCount > 0 ? "text-sm font-medium text-amber-400" : "text-sm font-medium text-foreground"}>
                          {syncStatusSummary.unresolvedConflictCount}
                        </p>
                      </div>
                    </div>

                    {syncHealthItems.length > 0 && (
                      <div className="border border-border rounded-sm bg-background/50 px-3 py-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                              Sync Health Checklist
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              Ringkasan actionable dari kondisi account, provider, local drift, konflik, recovery, dan auto-sync.
                            </p>
                          </div>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                            LOCAL SIGNALS
                          </Badge>
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          {syncHealthItems.map((item) => (
                            <div key={item.title} className={`border rounded-sm px-3 py-2.5 ${getSyncToneClasses(item.tone)}`}>
                              <div className="flex items-start gap-2">
                                <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${getSyncToneIconClasses(item.tone)}`}>
                                  <CheckCircle weight="duotone" size={13} />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-foreground">
                                    {item.title}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                                    {item.detail}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {syncStatusSummary.unresolvedConflicts.length > 0 && (
                      <div className="border border-amber-400/30 bg-amber-400/5 rounded-sm px-3 py-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
                            Conflict Journal
                          </p>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                            ACTION REQUIRED
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          {syncStatusSummary.unresolvedConflicts.slice(0, 4).map((conflict) => (
                            <div key={conflict.conflictId} className="border border-border bg-background/60 rounded-sm px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-mono text-foreground">
                                  {conflict.recordId}
                                </p>
                                <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                                  {conflict.operation.toUpperCase()}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                                {formatConflictReason(conflict.reason)} - remote v{conflict.remoteVersion ?? "?"} - {formatSyncTime(conflict.detectedAt)}
                              </p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <button
                                  type="button"
                                  onClick={() => void handleResolveSyncConflict(conflict.conflictId, "keep_local")}
                                  disabled={!onResolveSyncConflict || syncRuntimeStatus === "loading"}
                                  className="inline-flex items-center justify-center rounded-sm border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 text-[10px] font-mono uppercase tracking-wide text-amber-400 transition-colors hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Izinkan push berikutnya menulis versi lokal untuk record ini jika remote masih sama dengan snapshot konflik."
                                >
                                  Keep Local
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleResolveSyncConflict(conflict.conflictId, "keep_remote")}
                                  disabled={!onResolveSyncConflict || syncRuntimeStatus === "loading"}
                                  className="inline-flex items-center justify-center rounded-sm border border-border bg-muted px-2.5 py-2 text-[10px] font-mono uppercase tracking-wide text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Ambil versi remote sekarang dan jadikan item utama di browser ini."
                                >
                                  Keep Remote
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleResolveSyncConflict(conflict.conflictId, "keep_both")}
                                  disabled={!onResolveSyncConflict || syncRuntimeStatus === "loading" || conflict.operation === "delete"}
                                  className="inline-flex items-center justify-center rounded-sm border border-border bg-background px-2.5 py-2 text-[10px] font-mono uppercase tracking-wide text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                  title={conflict.operation === "delete" ? "Keep both tidak tersedia untuk delete conflict karena salinan lokal sudah dihapus." : "Pakai versi remote sebagai item utama dan simpan versi lokal sebagai item baru."}
                                >
                                  Keep Both
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleResolveSyncConflict(conflict.conflictId, "manual_edit")}
                                  disabled={!onResolveSyncConflict || syncRuntimeStatus === "loading" || conflict.operation === "delete"}
                                  className="inline-flex items-center justify-center rounded-sm border border-border bg-background px-2.5 py-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Tandai konflik sebagai sudah direview manual; versi lokal tetap menjadi kandidat push berikutnya."
                                >
                                  Manual Edit
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {syncStatusSummary.unresolvedConflicts.length > 4 && (
                          <p className="text-[11px] text-muted-foreground font-mono">
                            +{syncStatusSummary.unresolvedConflicts.length - 4} konflik lain tersimpan di encrypted local sync state.
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Ciphora menahan push untuk record yang konflik agar remote tidak tertimpa diam-diam. Resolusi tetap berjalan di browser ini: remote record didekripsi lokal memakai vault key aktif, bukan oleh server Ciphora.
                        </p>
                      </div>
                    )}

                    <div className="border-l-2 border-l-amber-400 bg-amber-400/5 rounded-r-sm px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                      {syncStatusSummary.hint}
                    </div>
                  </div>
                )}

                <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <Timer weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Smart Auto Sync
                          </p>
                          <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${autoSyncBadgeClass}`}>
                            {autoSyncBadgeLabel}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Saat aktif, Ciphora akan pull saat app kembali fokus lalu auto push perubahan lokal setelah jeda singkat. Fitur ini hanya berjalan saat vault unlocked, session account aktif, sync profile aktif, dan tab ini sedang terbuka.
                        </p>
                        {autoSyncRuntime?.lastActionAt && (
                          <p className="text-[11px] text-muted-foreground font-mono mt-2">
                            Last auto {autoSyncRuntime.lastAction ?? "sync"} - {new Date(autoSyncRuntime.lastActionAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSetAutoSyncEnabled?.(!autoSyncEnabled)}
                      disabled={!onSetAutoSyncEnabled}
                      className={`shrink-0 inline-flex items-center justify-center gap-1.5 text-xs font-mono tracking-wide px-3 py-2 rounded-sm transition-all duration-150 disabled:opacity-60 ${
                        autoSyncEnabled
                          ? "border border-border text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted"
                          : "bg-primary text-primary-foreground hover:bg-amber-400 hover:text-neutral-950"
                      }`}
                    >
                      <Timer weight="duotone" size={13} />
                      {autoSyncEnabled ? "Disable Auto Sync" : "Enable Auto Sync"}
                    </button>
                  </div>

                  {autoSyncRuntime?.message && (
                    <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      autoSyncRuntime.status === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : autoSyncRuntime.status === "ready"
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                    }`}>
                      {autoSyncRuntime.message}
                    </div>
                  )}
                </div>

                <form onSubmit={handleSyncProfileSubmit} className="space-y-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3 min-w-0">
                      <CloudCheck weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Encrypted Sync Profile
                          </p>
                          <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${syncProfileBadgeClass}`}>
                            {syncProfileBadgeLabel}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          Browser mengenkripsi profil provider BYODB dengan vault key aktif. Ciphora hanya menyimpan ciphertext profil ini; test koneksi dan load ulang profil tersimpan berjalan lokal di browser. Turso dan D1 Direct punya direct client; provider lain memakai Ciphora-compatible HTTP Bridge milik user.
                        </p>
                        {isSyncProfileActive && syncProfile && (
                          <p className="text-[11px] text-muted-foreground font-mono mt-2">
                            {activeSyncProviderLabel}
                            {syncProfile.labelHint ? ` - ${syncProfile.labelHint}` : ""}
                            {` - updated ${new Date(syncProfile.updatedAt).toLocaleString()}`}
                          </p>
                        )}
                      </div>
                    </div>
                    {isSyncProfileActive && (
                      <Badge className="shrink-0 text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                        DISCONNECT FLOW READY
                      </Badge>
                    )}
                  </div>

                  <div className="border border-border rounded-sm bg-background/50 px-3 py-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Sync Setup Wizard
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Ikuti urutan ini agar profile BYODB tidak tersimpan dengan credential salah atau first sync yang membingungkan.
                        </p>
                      </div>
                      <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                        ONE ACTIVE PROFILE
                      </Badge>
                    </div>

                    <div className="grid gap-2 md:grid-cols-4">
                      {providerSetupSteps.map((step) => (
                        <div key={step.step} className={`border rounded-sm px-3 py-3 ${getSyncToneClasses(step.tone)}`}>
                          <div className="flex items-start gap-2">
                            <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border text-[10px] font-mono ${getSyncToneIconClasses(step.tone)}`}>
                              {step.step}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground">
                                {step.title}
                              </p>
                              <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                                {step.detail}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Provider
                      </span>
                      <div className="relative">
                        <select
                          value={syncProviderType}
                          onChange={(event) => {
                            setSyncProviderType(event.target.value as SyncProviderType);
                            clearSyncProfileStatus();
                            clearSyncConnectionStatus();
                            clearSyncRuntimeStatus();
                          }}
                          className="w-full appearance-none bg-muted border border-border text-foreground text-sm rounded-sm px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150 cursor-pointer"
                        >
                          {SYNC_PROVIDER_TYPES.map((providerType) => (
                            <option key={providerType} value={providerType} className="bg-neutral-900">
                              {getSyncProviderDisplayLabel(providerType)}
                            </option>
                          ))}
                        </select>
                        <CaretDown
                          weight="bold"
                          size={12}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                        />
                      </div>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Label Hint
                      </span>
                      <input
                        type="text"
                        value={syncLabelHint}
                        onChange={(event) => {
                          setSyncLabelHint(event.target.value);
                          clearSyncProfileStatus();
                          clearSyncConnectionStatus();
                          clearSyncRuntimeStatus();
                        }}
                        maxLength={80}
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder="Personal, Primary, Backup"
                      />
                    </label>

                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {syncEndpointLabel}
                      </span>
                      <input
                        type="text"
                        value={syncEndpoint}
                        onChange={(event) => {
                          setSyncEndpoint(event.target.value);
                          clearSyncProfileStatus();
                          clearSyncConnectionStatus();
                          clearSyncRuntimeStatus();
                        }}
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder={syncEndpointPlaceholder}
                      />
                    </label>

                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {syncTokenLabel}
                      </span>
                      <input
                        type="password"
                        value={syncAccessToken}
                        onChange={(event) => {
                          setSyncAccessToken(event.target.value);
                          clearSyncProfileStatus();
                          clearSyncConnectionStatus();
                          clearSyncRuntimeStatus();
                        }}
                        autoComplete="off"
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder={getSyncTokenPlaceholder(syncProviderType)}
                      />
                    </label>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {getSyncConnectionHelp(syncProviderType)}
                    </p>

                    {syncConnectionMessage && (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        syncConnectionStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : syncConnectionStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {syncConnectionMessage}
                      </div>
                    )}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      {syncProfileMessage ? (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        syncProfileStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : syncProfileStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {syncProfileMessage}
                      </div>
                      ) : (
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Simpan ulang profil jika URL atau token berubah. Gunakan <span className="text-foreground">Load Saved Profile</span> jika ingin memuat ulang endpoint dan token terenkripsi ke form ini hanya di browser sekarang.
                        </p>
                      )}

                      <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                        {isSyncProfileActive && onLoadSyncProfileForEdit && (
                          <button
                            type="button"
                            onClick={handleLoadSyncProfileForEdit}
                            disabled={syncProfileStatus === "loading"}
                            className="inline-flex items-center justify-center gap-1.5 border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                          >
                            <FloppyDisk weight="duotone" size={14} />
                            {syncProfileStatus === "loading" ? "Loading..." : "Load Saved Profile"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleSyncProfileConnectionTest}
                          disabled={syncConnectionStatus === "loading" || !onTestSyncProfileConnection}
                          className="inline-flex items-center justify-center gap-1.5 border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                        >
                          <CloudCheck weight="duotone" size={14} />
                          {syncConnectionStatus === "loading" ? "Testing..." : "Test Connection"}
                        </button>
                        <Button
                          type="submit"
                          disabled={syncProfileStatus === "loading" || !onSaveSyncProfile}
                          className="bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                        >
                          {syncProfileStatus === "loading" ? (
                            "Processing..."
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <CloudCheck weight="duotone" size={14} />
                              Save Encrypted Profile
                            </span>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </form>

                {isSyncProfileActive && onDeleteSyncProfile && (
                  <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Disconnect Sync
                          </p>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-red-500/10 text-red-400 border border-red-500/30">
                            REMOTE SAFETY
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Putus sync sekarang punya dua jalur. <span className="text-foreground">Disconnect only</span> akan mematikan encrypted sync profile dan mereset metadata sync lokal tanpa mengubah provider. <span className="text-foreground">Cleanup known remote + disconnect</span> akan mencoba men-tombstone record {activeSyncProviderLabel} yang memang sudah dikenal browser ini sebelum profil dimatikan.
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-2 leading-relaxed">
                          Record remote yang belum pernah dikenal browser ini sengaja tidak dihapus. Jika kamu ingin browser ini tahu snapshot provider terbaru dulu, lakukan pull sebelum cleanup.
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => void handleSyncProfileDisconnect("disable_only")}
                          disabled={syncProfileStatus === "loading"}
                          className="inline-flex items-center justify-center gap-1.5 border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                        >
                          <Trash weight="duotone" size={14} />
                          Disconnect Only
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSyncProfileDisconnect("cleanup_known_remote")}
                          disabled={syncProfileStatus === "loading"}
                          className="inline-flex items-center justify-center gap-1.5 border border-red-800 text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-red-400 hover:bg-red-500/10 hover:border-red-600 transition-all duration-150 disabled:opacity-60"
                        >
                          <Trash weight="duotone" size={14} />
                          Cleanup Known Remote + Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {isSyncProfileActive && onMigrateSyncProfile && (
                  <form onSubmit={handleMigrationSubmit} className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Provider Migration Wizard
                          </p>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                            ONE ACTIVE PROFILE
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Wizard ini akan pull snapshot terbaru dari <span className="text-foreground">{activeSyncProviderLabel}</span>, memastikan target <span className="text-foreground">{migrationProviderLabel}</span> kosong, push snapshot terenkripsi ke target, verifikasi jumlah item, lalu baru mengganti encrypted sync profile aktif.
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-2 leading-relaxed">
                          Provider lama sengaja tidak dibersihkan otomatis. v1 migrasi hanya menerima target kosong agar handoff tetap aman dan tidak membuat dua profile aktif sekaligus.
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                        <span>{activeSyncProviderLabel}</span>
                        <ArrowsDownUp weight="duotone" size={14} className="text-amber-400" />
                        <span>{migrationProviderLabel}</span>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          Target Provider
                        </span>
                        <div className="relative">
                          <select
                            value={migrationProviderType}
                            onChange={(event) => setMigrationProviderType(event.target.value as SyncProviderType)}
                            className="w-full appearance-none bg-muted border border-border text-foreground text-sm rounded-sm px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150 cursor-pointer"
                          >
                            {SYNC_PROVIDER_TYPES.map((providerType) => (
                              <option key={providerType} value={providerType} disabled={syncProfile?.providerType === providerType}>
                                {getSyncProviderDisplayLabel(providerType)}
                              </option>
                            ))}
                          </select>
                          <CaretDown
                            weight="bold"
                            size={12}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                          />
                        </div>
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          Target Label
                        </span>
                        <input
                          value={migrationLabelHint}
                          onChange={(event) => setMigrationLabelHint(event.target.value)}
                          placeholder="opsional: device baru / shard cadangan"
                          maxLength={80}
                          className="w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          {migrationEndpointLabel}
                        </span>
                        <input
                          value={migrationEndpoint}
                          onChange={(event) => setMigrationEndpoint(event.target.value)}
                          placeholder={migrationEndpointPlaceholder}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          className="w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        />
                      </label>

                      <label className="space-y-1.5">
                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                          {migrationTokenLabel}
                        </span>
                        <input
                          value={migrationAccessToken}
                          onChange={(event) => setMigrationAccessToken(event.target.value)}
                          type="password"
                          placeholder={getSyncTokenPlaceholder(migrationProviderType)}
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          className="w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        />
                      </label>
                    </div>

                    {migrationConnectionMessage && (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        migrationConnectionStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : migrationConnectionStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {migrationConnectionMessage}
                      </div>
                    )}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      {migrationMessage ? (
                        <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                          migrationStatus === "error"
                            ? "border-l-red-500 bg-red-500/5 text-red-400"
                            : migrationStatus === "success"
                              ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                              : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                        }`}>
                          {migrationMessage}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Gunakan target provider kosong. Wizard ini tidak akan menyimpan target ke Ciphora sampai copy dan verifikasi count selesai.
                        </p>
                      )}

                      <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={handleMigrationConnectionTest}
                          disabled={migrationConnectionStatus === "loading" || migrationStatus === "loading" || !onTestSyncProfileConnection}
                          className="inline-flex items-center justify-center gap-1.5 border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                        >
                          <CloudCheck weight="duotone" size={14} />
                          {migrationConnectionStatus === "loading" ? "Testing..." : "Test Target"}
                        </button>
                        <Button
                          type="submit"
                          disabled={migrationStatus === "loading" || !onMigrateSyncProfile}
                          className="bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                        >
                          {migrationStatus === "loading" ? (
                            "Migrating..."
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <ArrowsDownUp weight="duotone" size={14} />
                              Migrate + Switch Active Profile
                            </span>
                          )}
                        </Button>
                      </div>
                    </div>
                  </form>
                )}

                {isSyncProfileActive && syncProfile?.providerType === "external_turso" && (
                  <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Manual Turso Vault Sync
                          </p>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                            SNAPSHOT
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Push akan mengenkripsi item vault aktif dan hanya menerapkan delete yang memang sudah diketahui browser ini. Pull akan merge record aktif dari Turso ke vault lokal, sambil menjaga item lokal yang belum ada di provider. Activity log tetap lokal.
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={handlePullTursoSync}
                          disabled={syncRuntimeStatus === "loading" || !onPullTursoSync}
                          className="inline-flex items-center justify-center border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                        >
                          {syncRuntimeStatus === "loading" ? "Working..." : "Pull From Turso"}
                        </button>
                        <Button
                          type="button"
                          onClick={handlePushTursoSync}
                          disabled={syncRuntimeStatus === "loading" || !onPushTursoSync}
                          className="bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                        >
                          {syncRuntimeStatus === "loading" ? "Working..." : "Push To Turso"}
                        </Button>
                      </div>
                    </div>

                    {syncRuntimeMessage && (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        syncRuntimeStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : syncRuntimeStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {syncRuntimeMessage}
                      </div>
                    )}
                  </div>
                )}

                {isSyncProfileActive && syncProfile && isBridgeSyncProvider(syncProfile.providerType) && (
                  <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Manual {activeSyncProviderLabel} Vault Sync
                          </p>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                            SNAPSHOT
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Push akan mengenkripsi item vault aktif dan hanya menerapkan delete yang memang sudah diketahui browser ini. Pull akan merge record aktif dari {activeSyncProviderLabel} ke vault lokal, sambil menjaga item lokal yang belum ada di provider. Endpoint harus bridge kompatibel Ciphora dengan route /health, /schema/apply, /records, dan /sync/push.
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={handlePullD1BridgeSync}
                          disabled={syncRuntimeStatus === "loading" || !onPullD1BridgeSync}
                          className="inline-flex items-center justify-center border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                        >
                          {syncRuntimeStatus === "loading" ? "Working..." : `Pull From ${activeSyncProviderLabel}`}
                        </button>
                        <Button
                          type="button"
                          onClick={handlePushD1BridgeSync}
                          disabled={syncRuntimeStatus === "loading" || !onPushD1BridgeSync}
                          className="bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                        >
                          {syncRuntimeStatus === "loading" ? "Working..." : `Push To ${activeSyncProviderLabel}`}
                        </Button>
                      </div>
                    </div>

                    {syncRuntimeMessage && (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        syncRuntimeStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : syncRuntimeStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {syncRuntimeMessage}
                      </div>
                    )}
                  </div>
                )}

                {isSyncProfileActive && syncProfile?.providerType === "external_d1_direct" && (
                  <div className="border border-border rounded-sm bg-background/40 px-4 py-4 space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            Manual D1 Direct Vault Sync
                          </p>
                          <Badge className="text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 bg-amber-400/10 text-amber-400 border border-amber-400/30">
                            ADVANCED
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Push dan pull memakai Cloudflare D1 REST API langsung dari browser. Provider config tetap terenkripsi di sync profile, tapi token Cloudflare harus tersedia di runtime browser saat sync berjalan. Jika browser/CORS menolak request, pakai D1 Bridge.
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={handlePullD1DirectSync}
                          disabled={syncRuntimeStatus === "loading" || !onPullD1DirectSync}
                          className="inline-flex items-center justify-center border border-border text-xs font-mono tracking-wide px-4 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150 disabled:opacity-60"
                        >
                          {syncRuntimeStatus === "loading" ? "Working..." : "Pull From D1 Direct"}
                        </button>
                        <Button
                          type="button"
                          onClick={handlePushD1DirectSync}
                          disabled={syncRuntimeStatus === "loading" || !onPushD1DirectSync}
                          className="bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                        >
                          {syncRuntimeStatus === "loading" ? "Working..." : "Push To D1 Direct"}
                        </Button>
                      </div>
                    </div>

                    {syncRuntimeMessage && (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        syncRuntimeStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : syncRuntimeStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {syncRuntimeMessage}
                      </div>
                    )}
                  </div>
                )}
                  </>
                )}

                {isSecuritySurface && (
                  <>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    <Key weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          Recovery Key
                        </p>
                        <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${recoveryBadgeClass}`}>
                          {recoveryBadgeLabel}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {isRecoveryUpgradeRequired
                          ? "Recovery Key lama terdeteksi, tapi belum punya verifier reset modern. Upgrade akan membuat Recovery Key baru yang bisa dipakai untuk forgot-password ceremony."
                          : "Recovery Key membungkus vault key aktif di browser ini. Server hanya menyimpan ciphertext wrapper, bukan Recovery Key atau plaintext vault key."}
                      </p>
                      {(isRecoveryEnabled || isRecoveryUpgradeRequired) && recoveryStatus?.lastRotatedAt && (
                        <p className="text-[11px] text-muted-foreground font-mono mt-2">
                          Last rotated {new Date(recoveryStatus.lastRotatedAt).toLocaleString()}
                          {recoveryStatus.recoveryKeyHint ? ` - hint ${recoveryStatus.recoveryKeyHint}` : ""}
                        </p>
                      )}
                      {isRecoveryUpgradeRequired && (
                        <div className="mt-3 border-l-2 border-l-amber-400 bg-amber-400/[0.07] px-3 py-2 rounded-r-sm text-xs leading-relaxed text-amber-300">
                          Upgrade ini merotasi recovery wrapper dan menampilkan Recovery Key baru sekali saja. Simpan key baru sebelum menutup halaman.
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRecoverySetup}
                    disabled={recoveryActionStatus === "loading" || !onSetupRecoveryKey}
                    className="shrink-0 inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground text-xs font-mono tracking-wide px-3 py-2 rounded-sm hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150 disabled:opacity-60"
                  >
                    <Key weight="duotone" size={13} />
                    {recoveryActionStatus === "loading"
                      ? "Processing..."
                      : isRecoveryEnabled
                        ? "Rotate Recovery Key"
                        : isRecoveryUpgradeRequired
                          ? "Upgrade Recovery Key"
                          : "Generate Recovery Key"}
                  </button>
                </div>

                {generatedRecoveryKey && (
                  <div className="border border-amber-400/40 bg-amber-400/[0.07] rounded-sm p-3 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-mono uppercase tracking-widest text-amber-400">
                          Save this key now
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Kunci ini hanya muncul sekali. Jika account password lupa dan Recovery Key hilang, Ciphora tidak bisa membuka vault/sync profile lama.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyRecoveryKey}
                        className="inline-flex items-center gap-1.5 border border-amber-400/40 text-xs font-mono tracking-wide px-2.5 py-1.5 rounded-sm text-amber-400 hover:bg-amber-400/10 transition-all duration-150"
                      >
                        <Copy weight="duotone" size={13} />
                        {recoveryCopied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="break-all rounded-sm border border-border bg-background px-3 py-2 text-xs font-mono text-foreground">
                      {generatedRecoveryKey}
                    </div>
                  </div>
                )}

                {recoveryMessage && (
                  <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                    recoveryActionStatus === "error"
                      ? "border-l-red-500 bg-red-500/5 text-red-400"
                      : recoveryActionStatus === "success"
                        ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                        : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                  }`}>
                    {recoveryMessage}
                  </div>
                )}
                  </>
                )}

                {isAccountSurface && (
                  <>
                <form onSubmit={handlePasswordChangeSubmit} className="border-t border-border pt-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <LockKey weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Change Account Password
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        Browser membuat verifier dan password wrapper baru dari vault key aktif. Plaintext password dan vault key tidak dikirim ke server; sesi lain akan dicabut.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Current Password
                      </span>
                      <input
                        type="password"
                        value={passwordCurrent}
                        onChange={(event) => {
                          setPasswordCurrent(event.target.value);
                          clearPasswordChangeStatus();
                        }}
                        autoComplete="current-password"
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder="Old account password"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        New Password
                      </span>
                      <input
                        type="password"
                        value={passwordNext}
                        onChange={(event) => {
                          setPasswordNext(event.target.value);
                          clearPasswordChangeStatus();
                        }}
                        autoComplete="new-password"
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder="New account password"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Confirm
                      </span>
                      <input
                        type="password"
                        value={passwordConfirm}
                        onChange={(event) => {
                          setPasswordConfirm(event.target.value);
                          clearPasswordChangeStatus();
                        }}
                        autoComplete="new-password"
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder="Repeat new password"
                      />
                    </label>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {passwordChangeMessage ? (
                      <div className={`border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                        passwordChangeStatus === "error"
                          ? "border-l-red-500 bg-red-500/5 text-red-400"
                          : passwordChangeStatus === "success"
                            ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                            : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                      }`}>
                        {passwordChangeMessage}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Gunakan password account yang berbeda dari master password vault jika memungkinkan.
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={passwordChangeStatus === "loading" || !onChangeAccountPassword}
                      className="shrink-0 bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                    >
                      {passwordChangeStatus === "loading" ? (
                        "Processing..."
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <LockKey weight="duotone" size={14} />
                          Change Password
                        </span>
                      )}
                    </Button>
                  </div>
                </form>
                  </>
                )}
              </div>
            )}

            {!isAccountConnected && (
              <form onSubmit={handleAccountSubmit} className="px-5 py-4 space-y-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMode("create");
                      clearAccountStatus();
                    }}
                    className={`px-3 py-2 rounded-sm border text-xs font-mono tracking-wide transition-all duration-150 ${
                      accountMode === "create"
                        ? "border-amber-400 bg-amber-400/10 text-amber-400"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMode("login");
                      clearAccountStatus();
                    }}
                    className={`px-3 py-2 rounded-sm border text-xs font-mono tracking-wide transition-all duration-150 ${
                      accountMode === "login"
                        ? "border-amber-400 bg-amber-400/10 text-amber-400"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    Login Account
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Email
                    </span>
                    <input
                      type="email"
                      value={accountEmail}
                      onChange={(event) => {
                        setAccountEmail(event.target.value);
                        clearAccountStatus();
                      }}
                      autoComplete="email"
                      className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                      placeholder="you@example.com"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Account Password
                    </span>
                    <input
                      type="password"
                      value={accountPassword}
                      onChange={(event) => {
                        setAccountPassword(event.target.value);
                        clearAccountStatus();
                      }}
                      autoComplete={accountMode === "create" ? "new-password" : "current-password"}
                      className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                      placeholder={accountMode === "create" ? "Create account password" : "Enter account password"}
                    />
                  </label>
                  {accountMode === "create" && (
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Confirm Account Password
                      </span>
                      <input
                        type="password"
                        value={accountConfirmPassword}
                        onChange={(event) => {
                          setAccountConfirmPassword(event.target.value);
                          clearAccountStatus();
                        }}
                        autoComplete="new-password"
                        className="w-full bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm rounded-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400 transition-all duration-150"
                        placeholder="Repeat account password"
                      />
                    </label>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {accountMode === "create"
                      ? "Browser akan membuat verifier dan encrypted wrapper dari vault key aktif. Plaintext key tidak dikirim."
                      : "Login memverifikasi account dan memastikan wrapper cocok dengan vault lokal yang sedang terbuka."}
                  </p>
                  <Button
                    type="submit"
                    disabled={accountStatus === "loading" || !onCreateAccount || !onLoginAccount}
                    className="shrink-0 bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
                  >
                    {accountStatus === "loading" ? (
                      "Processing..."
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <Key weight="duotone" size={14} />
                        {accountMode === "create" ? "Create Account" : "Login Account"}
                      </span>
                    )}
                  </Button>
                </div>
              </form>
            )}

            {accountMessage && (
              <div className={`mx-5 mb-4 border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                accountStatus === "error"
                  ? "border-l-red-500 bg-red-500/5 text-red-400"
                  : accountStatus === "success"
                    ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                    : "border-l-amber-400 bg-amber-400/5 text-amber-400"
              }`}>
                {accountMessage}
              </div>
            )}
          </div>
          )}

          {isDataSurface && (
            <>
          {/* Group 3: Vault transfer */}
          <div className="bg-card">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
              <FloppyDisk
                weight="duotone"
                size={16}
                className="text-amber-400"
              />
              <span className="text-xs font-mono font-semibold tracking-widest text-amber-400 uppercase">
                Transfer Vault
              </span>
              <Badge className="ml-auto bg-amber-400/10 text-amber-400 border border-amber-400/30 text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5">
                ENCRYPTED
              </Badge>
            </div>

            {/* Export Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 border-b border-border hover:border-l-2 hover:border-l-amber-400 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Export
                  weight="duotone"
                  size={18}
                  className="text-muted-foreground mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                    Export Vault Lokal
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Unduh backup vault terenkripsi dari browser ini untuk penyimpanan offline.
                  </p>
                </div>
              </div>
              <Button
                onClick={handleExport}
                disabled={exportStatus === "loading"}
                className="shrink-0 bg-primary text-primary-foreground rounded-sm text-xs font-mono tracking-wide px-4 py-2 h-auto hover:bg-amber-400 hover:text-neutral-950 transition-all duration-150"
              >
                {exportStatus === "loading" ? (
                  "Mengekspor..."
                ) : exportStatus === "success" ? (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle weight="duotone" size={14} />
                    Berhasil
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Export weight="duotone" size={14} />
                    Export
                  </span>
                )}
              </Button>
            </div>

            {/* Star Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 border-b border-border hover:border-l-2 hover:border-l-amber-400 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Star
                  weight="duotone"
                  size={18}
                  className="text-muted-foreground mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                    Restore Backup
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Muat backup terenkripsi Ciphora atau import file JSON legacy ke vault aktif.
                  </p>
                </div>
              </div>
              <label className="shrink-0 cursor-pointer">
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImport}
                />
                <span
                  className={`inline-flex items-center gap-1.5 border text-xs font-mono tracking-wide px-4 py-2 rounded-sm transition-all duration-150 ${
                    importStatus === "success"
                      ? "border-amber-400 text-amber-400 bg-amber-400/10"
                      : importStatus === "error"
                        ? "border-red-500 text-red-400 bg-red-500/10"
                        : "border-border text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {importStatus === "success" ? (
                    <>
                      <CheckCircle weight="duotone" size={14} />
                      Dipulihkan
                    </>
                  ) : (
                    <>
                      <Star weight="duotone" size={14} />
                      Import Backup
                    </>
                  )}
                </span>
              </label>
            </div>

            {/* Local Reset Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 hover:border-l-2 hover:border-l-red-500 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Trash
                  weight="duotone"
                  size={18}
                  className="text-muted-foreground mt-0.5 shrink-0 group-hover:text-red-400 transition-colors duration-150"
                />
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-red-400 transition-colors duration-150">
                    Reset Local Storage
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    Hapus vault lokal, PIN, session key, preferensi, dan device id di browser ini saja. Setelah reset, kamu bisa login/restore account yang sudah pernah dibuat dari layar unlock.
                  </p>
                  {localResetMessage && (
                    <div className={`mt-2 border-l-2 px-3 py-2 rounded-r-sm text-xs leading-relaxed ${
                      localResetStatus === "error"
                        ? "border-l-red-500 bg-red-500/5 text-red-400"
                        : localResetStatus === "success"
                          ? "border-l-emerald-500 bg-emerald-500/5 text-emerald-400"
                          : "border-l-amber-400 bg-amber-400/5 text-amber-400"
                    }`}>
                      {localResetMessage}
                    </div>
                  )}
                </div>
              </div>
              {onResetLocalStorage && (
                <button
                  type="button"
                  onClick={handleResetLocalStorage}
                  disabled={localResetStatus === "loading"}
                  className={`shrink-0 inline-flex items-center justify-center gap-1.5 rounded-sm border text-xs font-mono tracking-wide px-4 py-2 transition-all duration-150 disabled:opacity-60 ${
                    localResetStatus === "confirm"
                      ? "border-red-500 bg-red-500 text-white hover:bg-red-400 hover:border-red-400"
                      : "border-red-500/50 text-red-400 hover:border-red-500 hover:bg-red-500/10"
                  }`}
                >
                  <Trash weight="duotone" size={14} />
                  {localResetStatus === "loading"
                    ? "Resetting..."
                    : localResetStatus === "confirm"
                      ? "Confirm Reset"
                      : "Reset Local Storage"}
                </button>
              )}
            </div>
          </div>
            </>
          )}

          {isPreferencesSurface && (
            <>
          <Separator className="bg-border" />

          {/* Group 3: Appearance */}
          <div className="bg-card">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
              <Moon weight="duotone" size={16} className="text-amber-400" />
              <span className="text-xs font-mono font-semibold tracking-widest text-amber-400 uppercase">
                {t("settings.preferences.appearance")}
              </span>
            </div>

            {/* Language Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 border-b border-border hover:border-l-2 hover:border-l-amber-400 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <GearSix weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                    {t("settings.preferences.language")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.preferences.languageDesc")}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:w-72 shrink-0">
                {LANGUAGE_OPTIONS.map((option) => {
                  const isSelected = locale === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLocale(option.value)}
                      className={`rounded-sm border px-3 py-2 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${
                        isSelected
                          ? "border-amber-400 bg-amber-400/10 text-amber-400"
                          : "border-border text-muted-foreground hover:border-foreground/30 hover:bg-muted hover:text-foreground"
                      }`}
                      aria-pressed={isSelected}
                    >
                      <span className="block text-xs font-mono font-semibold tracking-widest">
                        {option.shortLabel}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-mono">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dark Mode Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 border-b border-border hover:border-l-2 hover:border-l-amber-400 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {theme === "dark"
                  ? <Moon weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                  : <Sun weight="duotone" size={18} className="text-amber-400 mt-0.5 shrink-0" />
                }
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                    {theme === "dark" ? t("settings.preferences.darkMode") : t("settings.preferences.lightMode")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {theme === "dark"
                      ? t("settings.preferences.darkModeDesc")
                      : t("settings.preferences.lightModeDesc")
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={onToggleTheme}
                className={`relative shrink-0 w-11 h-6 rounded-sm transition-colors duration-200 focus:outline-none focus:ring-1 focus:ring-amber-400 ${
                  theme === "dark" ? "bg-amber-400" : "bg-amber-400"
                }`}
                aria-label={t("settings.preferences.toggleDark")}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-background border border-border rounded-sm transition-transform duration-200 ${
                    theme === "dark" ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* PIN Management Row */}
            <div className="group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 px-5 py-4 border-b border-border hover:border-l-2 hover:border-l-amber-400 transition-all duration-150">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Fingerprint weight="duotone" size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-amber-400 transition-colors duration-150">
                    {t("settings.preferences.quickPin")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pinDescription}
                  </p>
                </div>
              </div>
              <div className="shrink-0 flex flex-wrap items-center gap-2">
                <Badge className={`text-[10px] font-mono tracking-wide rounded-sm px-2 py-0.5 ${pinBadgeClass}`}>
                  {pinBadgeLabel}
                </Badge>
                {onSetupPin && (
                  <button
                    onClick={onSetupPin}
                    className="flex items-center gap-1.5 border border-border text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-muted transition-all duration-150"
                  >
                    <Fingerprint weight="duotone" size={13} />
                    {pinPrimaryLabel}
                  </button>
                )}
                {pinState === "active" && onRemovePin && (
                  <button
                    onClick={onRemovePin}
                    className="flex items-center gap-1.5 border border-red-800 text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-red-400 hover:bg-red-500/10 hover:border-red-600 transition-all duration-150"
                  >
                    <Trash weight="duotone" size={13} />
                    {t("settings.preferences.removePin")}
                  </button>
                )}
                {pinState === "legacy" && onRemoveLegacyPin && (
                  <button
                    onClick={onRemoveLegacyPin}
                    className="flex items-center gap-1.5 border border-red-800 text-xs font-mono tracking-wide px-3 py-2 rounded-sm text-red-400 hover:bg-red-500/10 hover:border-red-600 transition-all duration-150"
                  >
                    <Trash weight="duotone" size={13} />
                    {t("settings.preferences.removeLegacy")}
                  </button>
                )}
              </div>
            </div>
          </div>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground font-mono">
            {surfaceMeta.footer}
          </p>
          <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono tracking-wide rounded-sm px-2 py-1">
            {surfaceMeta.badge}
          </Badge>
        </div>
      </div>
    </section>
  );
}

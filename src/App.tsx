import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import VaultNav from "./sections/VaultNav";
import VaultTopbar from "./sections/VaultTopbar";
import MobileBottomNav from "./sections/MobileBottomNav";
import ItemModal from "./sections/ItemModal";
import DeleteConfirm from "./sections/DeleteConfirm";
import { ToastProvider, useToast } from "./components/Toast";
import { STORAGE_KEYS, EXPORT_FILE_PREFIX, readStorageValue, removeStorageValue, resetCiphoraBrowserStorage, writeStorageValue } from "./lib/app-config";
import {
  changeCiphoraAccountPassword,
  createLocalCiphoraSyncProfile,
  createCiphoraAccount,
  decryptCiphoraSyncProfileConfig,
  getCiphoraAccountSession,
  getCiphoraEmailVerificationStatus,
  getCiphoraRecoveryStatus,
  getCiphoraSyncProfile,
  loginCiphoraAccountForRestore,
  loginCiphoraAccount,
  logoutCiphoraAccount,
  confirmCiphoraEmailVerification,
  getCiphoraDeviceSessionState,
  requestCiphoraRecoveryResetEmail,
  revokeCiphoraAccountSession,
  revokeCiphoraAccountSessions,
  resetCiphoraAccountPasswordWithRecoveryKey,
  saveCiphoraSyncProfile,
  sendCiphoraEmailVerification,
  setCiphoraDeviceTrusted,
  setupCiphoraRecoveryKey,
  deleteCiphoraSyncProfile,
  getSyncProviderDisplayLabel,
  isBridgeSyncProvider,
  type AccountSession,
  type DeviceSessionState,
  type EmailVerificationStatus,
  type RecoveryStatus,
  type SyncProfile,
  type SyncProviderType,
} from "./lib/account-client";
import { pullVaultSnapshotFromD1Bridge, pushVaultSnapshotToD1Bridge, resolveD1BridgeSyncConflict } from "./lib/d1-bridge-sync";
import { pullVaultSnapshotFromD1Direct, pushVaultSnapshotToD1Direct, resolveD1DirectSyncConflict } from "./lib/d1-direct-sync";
import { testSyncProviderConnection } from "./lib/sync-provider-client";
import type { SyncConflictResolution } from "./lib/sync-conflict-resolution";
import { buildSyncStatusSummary, hasPendingLocalSync, type AutoSyncRuntimeState } from "./lib/sync-status";
import { pullVaultSnapshotFromTurso, pushVaultSnapshotToTurso, resolveTursoSyncConflict } from "./lib/turso-vault-sync";
import { getDefaultVaultPath, getPathForPanel, getScreenFromPath, isVaultPanel, ROUTE_PATHS, type VaultPanel } from "./lib/routes";
import { useI18n } from "./lib/i18n";
import { formatTotpCode, generateTotpCode, getTotpSecondsLeft } from "./lib/totp";
import { useVaultStore, type TotpState } from "./hooks/useVaultStore";
import {
  clearLegacyPlaintextVault,
  clearQuickUnlockPin,
  clearVaultSession,
  createEmptyVaultData,
  createEmptyVaultSyncState,
  createEncryptedBackupFile,
  createVaultActivity,
  generateVaultId,
  hasConfiguredVault,
  hasQuickUnlockPin,
  initializeEncryptedVault,
  installRestoredEncryptedVault,
  loadVaultData,
  parseImportedVaultFile,
  readLegacyPlaintextVault,
  readSessionKey,
  replaceEncryptedBackup,
  storeQuickUnlockPin,
  unlockEncryptedVault,
  unlockWithQuickPin,
  writeSessionKey,
  type VaultActivity,
  type VaultData,
  type VaultSyncState,
} from "./lib/vault-storage";
import type { ItemType, VaultItem } from "./sections/ItemModal";

const LandingPage = lazy(() => import("./sections/LandingPage"));
const PublicInfoPage = lazy(() => import("./sections/PublicInfoPage"));
const UnlockVault = lazy(() => import("./sections/UnlockVault"));
const PinUnlock = lazy(() => import("./sections/PinUnlock"));
const VaultDashboard = lazy(() => import("./sections/VaultDashboard"));
const ItemLibrary = lazy(() => import("./sections/ItemLibrary"));
const GeneratorTools = lazy(() => import("./sections/GeneratorTools"));
const SecuritySettings = lazy(() => import("./sections/SecuritySettings"));
const SecurityAudit = lazy(() => import("./sections/SecurityAudit"));

type Theme = "dark" | "light";
type VaultImportResult = { ok: boolean; message: string };
type SyncDisconnectMode = "disable_only" | "cleanup_known_remote";
type SettingsSurface = "settings" | "sync" | "account" | "security" | "data" | "preferences";
const AUTO_PULL_COOLDOWN_MS = 15_000;
const PRE_PUSH_PULL_STALE_MS = 60_000;
const EMAIL_VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{24,256}$/;

function readEmailVerificationTokenFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const token = params.get("verify_email_token") ?? params.get("emailVerificationToken");
  if (!token || !EMAIL_VERIFICATION_TOKEN_PATTERN.test(token)) return null;
  return token;
}

function buildEmailVerificationSettingsPath(token: string) {
  const params = new URLSearchParams();
  params.set("verify_email_token", token);
  return `${ROUTE_PATHS.accountSettings}?${params.toString()}`;
}

function hasWindow() {
  return typeof window !== "undefined";
}

function readTheme(): Theme {
  if (!hasWindow()) return "dark";
  const savedTheme = readStorageValue(window.localStorage, STORAGE_KEYS.theme);
  return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
}

function readAutoLockDuration(): number | null {
  if (!hasWindow()) return 300;
  const savedValue = readStorageValue(window.localStorage, STORAGE_KEYS.autoLockSeconds);
  if (savedValue === "never") return null;

  const parsed = Number(savedValue);
  return [60, 300, 900, 1800, 3600].includes(parsed) ? parsed : 300;
}

function readAutoSyncEnabled() {
  if (!hasWindow()) return false;
  return readStorageValue(window.localStorage, STORAGE_KEYS.autoSyncEnabled) === "1";
}

function readAutoSyncViewportActive() {
  if (!hasWindow()) return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

function createAutoSyncRuntimeState(enabled: boolean): AutoSyncRuntimeState {
  if (!enabled) {
    return {
      enabled: false,
      status: "disabled",
      message: "Auto sync tidak aktif di browser ini.",
    };
  }

  return {
    enabled: true,
    status: "paused",
    message: "Auto sync menunggu vault unlocked, sync profile aktif, dan tab Ciphora aktif.",
  };
}

function getSyncProviderLabel(providerType: SyncProviderType) {
  return getSyncProviderDisplayLabel(providerType);
}

function RouteLoadingState() {
  const { t } = useI18n();
  return (
    <section className="min-h-[60vh] bg-background text-foreground flex items-center justify-center">
      <div className="text-center space-y-2">
        <p className="text-xs font-mono tracking-[0.3em] uppercase text-amber-500">Ciphora</p>
        <p className="text-xs font-mono text-muted-foreground">{t("common.loadingRoute")}</p>
      </div>
    </section>
  );
}

function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteLoadingState />}>
      {children}
    </Suspense>
  );
}

function getActiveProviderSyncState(syncProfile: SyncProfile, syncState: VaultSyncState) {
  if (syncProfile.providerType === "external_turso") {
    return syncState.turso?.profileId === syncProfile.profileId ? syncState.turso : null;
  }

  if (isBridgeSyncProvider(syncProfile.providerType)) {
    return syncState.d1Bridge?.profileId === syncProfile.profileId ? syncState.d1Bridge : null;
  }

  if (syncProfile.providerType === "external_d1_direct") {
    return syncState.d1Direct?.profileId === syncProfile.profileId ? syncState.d1Direct : null;
  }

  return null;
}

function shouldPullBeforePush(syncProfile: SyncProfile, vaultData: VaultData) {
  if (vaultData.syncState.pendingLocalDeletes.length > 0) {
    return true;
  }

  const providerState = getActiveProviderSyncState(syncProfile, vaultData.syncState);
  if (!providerState) {
    return true;
  }

  const lastRemoteRefreshAt = providerState.lastMergedAt ?? providerState.lastPulledAt;
  if (!lastRemoteRefreshAt) {
    return true;
  }

  const lastRemoteRefreshMs = Date.parse(lastRemoteRefreshAt);
  if (!Number.isFinite(lastRemoteRefreshMs)) {
    return true;
  }

  return Date.now() - lastRemoteRefreshMs >= PRE_PUSH_PULL_STALE_MS;
}

function buildDisconnectCleanupVaultData(syncProfile: SyncProfile, vaultData: VaultData, deletedAt: string) {
  const providerState = getActiveProviderSyncState(syncProfile, vaultData.syncState);
  const knownActiveRemoteRecordIds = (providerState?.knownRemoteRecords ?? [])
    .filter((record) => record.deletedAt === null)
    .map((record) => record.recordId);
  const pendingDeleteMap = new Map(
    vaultData.syncState.pendingLocalDeletes.map((entry) => [entry.recordId, entry] as const),
  );

  for (const recordId of knownActiveRemoteRecordIds) {
    if (!pendingDeleteMap.has(recordId)) {
      pendingDeleteMap.set(recordId, {
        recordId,
        deletedAt,
      });
    }
  }

  return {
    cleanupKnownRemoteCount: knownActiveRemoteRecordIds.length,
    vaultData: {
      ...vaultData,
      items: [],
      syncState: {
        ...vaultData.syncState,
        pendingLocalDeletes: Array.from(pendingDeleteMap.values()),
      },
      updatedAt: deletedAt,
    } satisfies VaultData,
  };
}

function buildInstalledMigrationSyncState(syncState: VaultSyncState, providerType: SyncProviderType, profileId: string): VaultSyncState {
  if (providerType === "external_turso") {
    return {
      pendingLocalDeletes: [],
      conflicts: syncState.conflicts,
      turso: syncState.turso
        ? {
          ...syncState.turso,
          profileId,
        }
        : {
          profileId,
          knownRemoteRecords: [],
        },
      d1Bridge: syncState.d1Bridge,
      d1Direct: syncState.d1Direct,
    };
  }

  if (isBridgeSyncProvider(providerType)) {
    return {
      pendingLocalDeletes: [],
      conflicts: syncState.conflicts,
      turso: syncState.turso,
      d1Bridge: syncState.d1Bridge
        ? {
          ...syncState.d1Bridge,
          profileId,
        }
        : {
          profileId,
          knownRemoteRecords: [],
        },
      d1Direct: syncState.d1Direct,
    };
  }

  return {
    pendingLocalDeletes: [],
    conflicts: syncState.conflicts,
    turso: syncState.turso,
    d1Bridge: syncState.d1Bridge,
    d1Direct: syncState.d1Direct
      ? {
        ...syncState.d1Direct,
        profileId,
      }
      : {
        profileId,
        knownRemoteRecords: [],
      },
  };
}

async function pushVaultSnapshotToProvider(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}) {
  if (input.syncProfile.providerType === "external_turso") {
    return pushVaultSnapshotToTurso(input);
  }

  if (input.syncProfile.providerType === "external_d1_bridge") {
    return pushVaultSnapshotToD1Bridge(input);
  }

  if (input.syncProfile.providerType === "external_d1_direct") {
    return pushVaultSnapshotToD1Direct(input);
  }

  if (isBridgeSyncProvider(input.syncProfile.providerType)) {
    return pushVaultSnapshotToD1Bridge(input);
  }

  return pushVaultSnapshotToD1Direct(input);
}

async function pullVaultSnapshotFromProvider(input: {
  rootKeyBase64: string;
  syncProfile: SyncProfile;
  vaultData: VaultData;
}) {
  if (input.syncProfile.providerType === "external_turso") {
    return pullVaultSnapshotFromTurso(input);
  }

  if (input.syncProfile.providerType === "external_d1_bridge") {
    return pullVaultSnapshotFromD1Bridge(input);
  }

  if (input.syncProfile.providerType === "external_d1_direct") {
    return pullVaultSnapshotFromD1Direct(input);
  }

  if (isBridgeSyncProvider(input.syncProfile.providerType)) {
    return pullVaultSnapshotFromD1Bridge(input);
  }

  return pullVaultSnapshotFromD1Direct(input);
}

function VaultShell({
  onLock,
  onAddItem,
  onSearch,
  searchValue,
  theme,
  onToggleTheme,
  onExportVault,
  autoLockSeconds,
  autoLockDurationSeconds,
}: {
  onLock: () => void;
  onAddItem: (type?: ItemType) => void;
  onSearch: (query: string) => void;
  searchValue: string;
  theme: Theme;
  onToggleTheme: () => void;
  onExportVault: () => void;
  autoLockSeconds: number;
  autoLockDurationSeconds: number | null;
}) {
  const location = useLocation();
  const screen = getScreenFromPath(location.pathname);
  const showVaultChrome = isVaultPanel(screen);
  const activePanel = showVaultChrome ? screen : "vault-dashboard";

  return (
    <div className={`${showVaultChrome ? "h-screen flex overflow-hidden" : "min-h-screen"} bg-background text-foreground`}>
      {showVaultChrome && (
        <VaultNav autoLockSeconds={autoLockDurationSeconds === null ? null : autoLockSeconds} />
      )}

      <div className={showVaultChrome ? "flex-1 flex flex-col overflow-hidden" : ""}>
        {showVaultChrome && (
          <div className="animate-fade-in sticky top-0 z-30">
            <VaultTopbar
              activePanel={activePanel}
              onLock={onLock}
              onAddItem={onAddItem}
              onSearch={onSearch}
              searchValue={searchValue}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onExportVault={onExportVault}
            />
          </div>
        )}

        <main className={showVaultChrome ? "flex-1 overflow-y-auto pb-16 lg:pb-0" : ""}>
          <RouteSuspense>
            <Outlet />
          </RouteSuspense>
        </main>
      </div>

      {showVaultChrome && (
        <MobileBottomNav />
      )}
    </div>
  );
}

function AppInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useI18n();
  const [sessionKeyState, setSessionKeyState] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(() => (hasWindow() ? hasConfiguredVault(window.localStorage) : false));
  const [hasQuickPinState, setHasQuickPinState] = useState(() => (hasWindow() ? hasQuickUnlockPin(window.localStorage) : false));
  const [hasLegacyPinState, setHasLegacyPinState] = useState(() => (hasWindow() ? !!readStorageValue(window.localStorage, STORAGE_KEYS.pinHash) : false));
  const {
    items: localItems,
    activities,
    syncState: vaultSyncState,
    isPending: itemsPending,
    error: vaultError,
    refreshVault,
    createItem,
    updateItem,
    removeItem,
    logActivity: appendActivity,
    replaceVault,
  } = useVaultStore(sessionKeyState);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalInitialType, setItemModalInitialType] = useState<ItemType>("password");
  const [editItem, setEditItem] = useState<VaultItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; type: string; name: string } | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [autoLockDurationSeconds, setAutoLockDurationSeconds] = useState<number | null>(readAutoLockDuration);
  const [autoLockSeconds, setAutoLockSeconds] = useState(() => readAutoLockDuration() ?? 0);
  const [totpStates, setTotpStates] = useState<Record<number, TotpState>>({});
  const [queuedActivity, setQueuedActivity] = useState<Omit<VaultActivity, "id" | "createdAt"> | null>(null);
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [accountSessionLoading, setAccountSessionLoading] = useState(false);
  const [deviceSessionState, setDeviceSessionState] = useState<DeviceSessionState | null>(null);
  const [deviceSessionLoading, setDeviceSessionLoading] = useState(false);
  const [emailVerificationStatus, setEmailVerificationStatus] = useState<EmailVerificationStatus | null>(null);
  const [emailVerificationLoading, setEmailVerificationLoading] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [recoveryStatusLoading, setRecoveryStatusLoading] = useState(false);
  const [syncProfile, setSyncProfile] = useState<SyncProfile | null>(null);
  const [syncProfileLoading, setSyncProfileLoading] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(readAutoSyncEnabled);
  const [isAutoSyncViewportActive, setIsAutoSyncViewportActive] = useState(readAutoSyncViewportActive);
  const [autoSyncRuntime, setAutoSyncRuntime] = useState<AutoSyncRuntimeState>(() => createAutoSyncRuntimeState(readAutoSyncEnabled()));
  const syncActionLockRef = useRef<null | { action: "push" | "pull" | "disconnect" | "migrate" | "resolve"; trigger: "manual" | "auto" }>(null);
  const autoPushTimerRef = useRef<number | null>(null);
  const autoPullCooldownRef = useRef(0);
  const syncStatusSummary = buildSyncStatusSummary({
    syncProfile,
    syncState: vaultSyncState,
    items: localItems,
    autoSyncEnabled,
  });
  const hasAutoSyncPrerequisites = !!sessionKeyState && !!accountSession && !!syncProfile;
  const hasPendingLocalAutoSync = hasPendingLocalSync(syncStatusSummary);

  const refreshPinState = useCallback(() => {
    if (!hasWindow()) {
      setHasQuickPinState(false);
      setHasLegacyPinState(false);
      return;
    }

    setHasQuickPinState(hasQuickUnlockPin(window.localStorage));
    setHasLegacyPinState(!!readStorageValue(window.localStorage, STORAGE_KEYS.pinHash));
  }, []);

  const sessionKey = sessionKeyState;
  const isUnlocked = !!sessionKey;
  const hasPin = hasQuickPinState;
  const pinSetupRequested = new URLSearchParams(location.search).get("mode") === "setup";
  const emailVerificationTokenFromUrl = readEmailVerificationTokenFromSearch(location.search);
  const emailVerificationSettingsPath = emailVerificationTokenFromUrl
    ? buildEmailVerificationSettingsPath(emailVerificationTokenFromUrl)
    : ROUTE_PATHS.accountSettings;

  useEffect(() => {
    if (!hasWindow()) {
      setIsSessionReady(true);
      return;
    }

    let cancelled = false;

    const restoreSession = async () => {
      const configured = hasConfiguredVault(window.localStorage);
      setVaultConfigured(configured);
      refreshPinState();

      if (!configured) {
        clearVaultSession(window.sessionStorage);
        if (!cancelled) {
          setSessionKeyState(null);
          setIsSessionReady(true);
        }
        return;
      }

      const storedSessionKey = readSessionKey(window.sessionStorage);
      if (!storedSessionKey) {
        if (!cancelled) {
          setSessionKeyState(null);
          setIsSessionReady(true);
        }
        return;
      }

      try {
        await loadVaultData(window.localStorage, storedSessionKey);
        if (!cancelled) {
          setSessionKeyState(storedSessionKey);
          setIsSessionReady(true);
        }
      } catch {
        clearVaultSession(window.sessionStorage);
        if (!cancelled) {
          setSessionKeyState(null);
          setIsSessionReady(true);
        }
      }
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [refreshPinState]);

  useEffect(() => {
    if (!hasWindow()) return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === STORAGE_KEYS.pinWrap.current
        || event.key === STORAGE_KEYS.pinHash.current
        || event.key === STORAGE_KEYS.pinHash.legacy
      ) {
        refreshPinState();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refreshPinState]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.classList.remove("light");
      root.classList.remove("dark");
    }
    if (hasWindow()) {
      writeStorageValue(window.localStorage, STORAGE_KEYS.theme, theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!queuedActivity || !sessionKey) return;

    void appendActivity(queuedActivity)
      .catch(() => {})
      .finally(() => {
        setQueuedActivity(null);
      });
  }, [appendActivity, queuedActivity, sessionKey]);

  useEffect(() => {
    if (!vaultError || !sessionKey || !hasWindow()) return;

    console.error(vaultError);
    clearVaultSession(window.sessionStorage);
    setSessionKeyState(null);
    setIsSessionReady(true);
    navigate(ROUTE_PATHS.unlockVault, { replace: true });
    toast("Vault session expired. Unlock again.", "warning");
  }, [navigate, sessionKey, toast, vaultError]);

  const buildInitialVaultData = useCallback(() => {
    const legacyVault = readLegacyPlaintextVault(window.localStorage);
    if (legacyVault) {
      return {
        mode: "migrated" as const,
        data: createEmptyVaultData({
          items: legacyVault.items,
          activities: [
            createVaultActivity({
              type: "migration",
              label: "Legacy vault encrypted",
              detail: `${legacyVault.items.length} existing item${legacyVault.items.length === 1 ? "" : "s"} moved into encrypted storage`,
              severity: "warning",
            }),
            ...legacyVault.activities,
          ],
        }),
      };
    }

    return {
      mode: "empty" as const,
      data: createEmptyVaultData({
        items: [],
        activities: [
          createVaultActivity({
            type: "unlock",
            label: "Encrypted vault ready",
            detail: "Encrypted vault initialized on this device",
            severity: "info",
          }),
        ],
      }),
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      toast(nextTheme === "light" ? "Switched to Light Mode" : "Switched to Dark Mode", "info", 2000);
      return nextTheme;
    });
  }, [toast]);

  const passwords = localItems.filter((item) => item.type === "password");
  const totps = localItems.filter((item) => item.type === "totp");
  const notes = localItems.filter((item) => item.type === "note");
  const cards = localItems.filter((item) => item.type === "card");
  const sshKeys = localItems.filter((item) => item.type === "ssh");
  const identities = localItems.filter((item) => item.type === "identity");
  const apiKeys = localItems.filter((item) => item.type === "apiKey");
  const wifiNetworks = localItems.filter((item) => item.type === "wifi");
  const recoveryCodes = localItems.filter((item) => item.type === "recoveryCode");
  const softwareLicenses = localItems.filter((item) => item.type === "softwareLicense");
  const databaseCredentials = localItems.filter((item) => item.type === "databaseCredential");
  const totpStateKey = totps
    .map((item) => `${item.id}:${item.secret ?? ""}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      const timestamp = Date.now();
      const secondsLeft = getTotpSecondsLeft(timestamp);
      const nextStates: Record<number, TotpState> = {};

      void Promise.all(
        totps.map(async (item) => {
          try {
            const code = await generateTotpCode(item.secret ?? "", { timestamp });
            nextStates[item.id] = {
              secondsLeft,
              code: formatTotpCode(code),
            };
          } catch {
            nextStates[item.id] = {
              secondsLeft,
              code: "--- ---",
              error: "Invalid Base32 secret",
            };
          }
        }),
      ).then(() => {
        if (!cancelled) {
          setTotpStates(nextStates);
        }
      });
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [totpStateKey]);

  useEffect(() => {
    setAutoLockSeconds(autoLockDurationSeconds ?? 0);
  }, [autoLockDurationSeconds]);

  useEffect(() => {
    if (autoLockDurationSeconds === null) return undefined;

    const timerId = window.setInterval(() => {
      setAutoLockSeconds((currentValue) => (currentValue > 0 ? currentValue - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [autoLockDurationSeconds]);

  const resetAutoLock = useCallback(() => setAutoLockSeconds(autoLockDurationSeconds ?? 0), [autoLockDurationSeconds]);

  const logActivity = useCallback((type: string, label: string, detail: string, severity: string) => {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    void appendActivity({ type, label, detail, severity, time });
  }, [appendActivity]);

  const refreshEmailVerificationStatus = useCallback(async () => {
    if (!hasWindow()) return;
    setEmailVerificationLoading(true);
    try {
      const status = await getCiphoraEmailVerificationStatus();
      setEmailVerificationStatus(status);
    } catch (error) {
      console.error(error);
      setEmailVerificationStatus(null);
    } finally {
      setEmailVerificationLoading(false);
    }
  }, []);

  const refreshRecoveryStatus = useCallback(async () => {
    if (!hasWindow()) return;
    setRecoveryStatusLoading(true);
    try {
      const status = await getCiphoraRecoveryStatus();
      setRecoveryStatus(status);
    } catch (error) {
      console.error(error);
      setRecoveryStatus(null);
    } finally {
      setRecoveryStatusLoading(false);
    }
  }, []);

  const refreshSyncProfile = useCallback(async () => {
    if (!hasWindow()) return;
    setSyncProfileLoading(true);
    try {
      const profile = await getCiphoraSyncProfile();
      setSyncProfile(profile);
    } catch (error) {
      console.error(error);
      setSyncProfile(null);
    } finally {
      setSyncProfileLoading(false);
    }
  }, []);

  const refreshDeviceSessionState = useCallback(async () => {
    if (!hasWindow()) return;
    setDeviceSessionLoading(true);
    try {
      const state = await getCiphoraDeviceSessionState();
      setDeviceSessionState(state);
    } catch (error) {
      console.error(error);
      setDeviceSessionState(null);
    } finally {
      setDeviceSessionLoading(false);
    }
  }, []);

  const refreshAccountSession = useCallback(async () => {
    if (!hasWindow()) return;
    setAccountSessionLoading(true);
    try {
      const session = await getCiphoraAccountSession();
      setAccountSession(session);
      if (session) {
        await Promise.all([
          refreshDeviceSessionState(),
          refreshEmailVerificationStatus(),
          refreshRecoveryStatus(),
          refreshSyncProfile(),
        ]);
      } else {
        setDeviceSessionState(null);
        setEmailVerificationStatus(null);
        setRecoveryStatus(null);
        setSyncProfile(null);
      }
    } catch (error) {
      console.error(error);
      setAccountSession(null);
      setDeviceSessionState(null);
      setEmailVerificationStatus(null);
      setRecoveryStatus(null);
      setSyncProfile(null);
    } finally {
      setAccountSessionLoading(false);
    }
  }, [refreshDeviceSessionState, refreshEmailVerificationStatus, refreshRecoveryStatus, refreshSyncProfile]);

  useEffect(() => {
    if (!isSessionReady) return;
    void refreshAccountSession();
  }, [isSessionReady, refreshAccountSession]);

  const handleCreateAccount = useCallback(async (email: string, password: string) => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum membuat Ciphora account." };
    }

    const result = await createCiphoraAccount({
      email,
      password,
      rootKeyBase64: sessionKey,
    });

    if (result.ok && result.session) {
      setAccountSession(result.session);
      await Promise.all([
        refreshDeviceSessionState(),
        refreshEmailVerificationStatus(),
        refreshRecoveryStatus(),
        refreshSyncProfile(),
      ]);
      const verification = await sendCiphoraEmailVerification(email);
      logActivity("account", "Ciphora account connected", "Encrypted root-key wrapper stored in account control plane", "info");
      toast(verification.ok ? "Ciphora account connected. Verification email sent." : "Ciphora account connected", "success");
      return { ok: true };
    }

    toast(result.message ?? "Failed to create Ciphora account", "error");
    return { ok: false, message: result.message };
  }, [logActivity, refreshDeviceSessionState, refreshEmailVerificationStatus, refreshRecoveryStatus, refreshSyncProfile, sessionKey, toast]);

  const handleLoginAccount = useCallback(async (email: string, password: string) => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum login Ciphora account." };
    }

    const result = await loginCiphoraAccount({
      email,
      password,
      currentRootKeyBase64: sessionKey,
    });

    if (result.ok && result.session) {
      setAccountSession(result.session);
      await Promise.all([
        refreshDeviceSessionState(),
        refreshEmailVerificationStatus(),
        refreshRecoveryStatus(),
        refreshSyncProfile(),
      ]);
      logActivity("account", "Ciphora account session active", "Account wrapper matched the local vault key", "info");
      toast("Ciphora account session active", "success");
      return { ok: true };
    }

    toast(result.message ?? "Failed to login Ciphora account", "error");
    return { ok: false, message: result.message };
  }, [logActivity, refreshDeviceSessionState, refreshEmailVerificationStatus, refreshRecoveryStatus, refreshSyncProfile, sessionKey, toast]);

  const handleLogoutAccount = useCallback(async () => {
    const result = await logoutCiphoraAccount();
    if (result.ok) {
      setAccountSession(null);
      setDeviceSessionState(null);
      setEmailVerificationStatus(null);
      setRecoveryStatus(null);
      setSyncProfile(null);
      logActivity("account", "Ciphora account logged out", "Server account session revoked", "info");
      toast("Ciphora account logged out", "info");
      return { ok: true };
    }

    toast(result.message ?? "Failed to logout Ciphora account", "error");
    return { ok: false, message: result.message };
  }, [logActivity, toast]);

  const clearAccountControlPlaneState = useCallback(() => {
    setAccountSession(null);
    setDeviceSessionState(null);
    setEmailVerificationStatus(null);
    setRecoveryStatus(null);
    setSyncProfile(null);
  }, []);

  const handleRefreshDeviceSessions = useCallback(async () => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum refresh device/session." };
    }
    await refreshDeviceSessionState();
    return { ok: true };
  }, [accountSession, refreshDeviceSessionState]);

  const handleRevokeAccountSession = useCallback(async (sessionId: string) => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum mencabut session." };
    }

    const result = await revokeCiphoraAccountSession(sessionId);
    if (result.ok) {
      logActivity("account", "Account session revoked", "A selected Ciphora account session was revoked server-side", "warning");
      toast(result.message ?? "Account session revoked", "success");
      if (result.currentSessionRevoked) {
        clearAccountControlPlaneState();
      } else {
        await refreshDeviceSessionState();
      }
      return { ok: true, message: result.message };
    }

    toast(result.message ?? "Failed to revoke account session", "error");
    return { ok: false, message: result.message };
  }, [accountSession, clearAccountControlPlaneState, logActivity, refreshDeviceSessionState, toast]);

  const handleRevokeAllAccountSessions = useCallback(async (includeCurrent = false) => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum mencabut semua session." };
    }

    const result = await revokeCiphoraAccountSessions(includeCurrent);
    if (result.ok) {
      logActivity(
        "account",
        includeCurrent ? "All account sessions revoked" : "Other account sessions revoked",
        includeCurrent ? "All Ciphora account sessions were revoked server-side" : "All other Ciphora account sessions were revoked server-side",
        "warning",
      );
      toast(result.message ?? "Account sessions revoked", "success");
      if (result.currentSessionRevoked) {
        clearAccountControlPlaneState();
      } else {
        await refreshDeviceSessionState();
      }
      return { ok: true, message: result.message };
    }

    toast(result.message ?? "Failed to revoke account sessions", "error");
    return { ok: false, message: result.message };
  }, [accountSession, clearAccountControlPlaneState, logActivity, refreshDeviceSessionState, toast]);

  const handleSetDeviceTrusted = useCallback(async (deviceId: string, trusted: boolean) => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum mengubah trust device." };
    }

    const result = await setCiphoraDeviceTrusted(deviceId, trusted);
    if (result.ok) {
      logActivity("account", trusted ? "Device trusted" : "Device trust removed", "Device trust marker updated in account control plane", "info");
      toast(result.message ?? "Device trust updated", "success");
      await refreshDeviceSessionState();
      return { ok: true, message: result.message };
    }

    toast(result.message ?? "Failed to update device trust", "error");
    return { ok: false, message: result.message };
  }, [accountSession, logActivity, refreshDeviceSessionState, toast]);

  const handleChangeAccountPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum mengganti Ciphora account password." };
    }

    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum mengganti Ciphora account password." };
    }

    const result = await changeCiphoraAccountPassword({
      currentPassword,
      newPassword,
      rootKeyBase64: sessionKey,
    });

    if (result.ok) {
      await refreshAccountSession();
      logActivity("account", "Ciphora account password changed", "Password wrapper rotated; other sessions revoked", "warning");
      toast("Ciphora account password changed", "success");
      return { ok: true };
    }

    toast(result.message ?? "Failed to change Ciphora account password", "error");
    return { ok: false, message: result.message };
  }, [accountSession, logActivity, refreshAccountSession, sessionKey, toast]);

  const handleSetupRecoveryKey = useCallback(async () => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum membuat Recovery Key." };
    }

    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum membuat Recovery Key." };
    }

    const result = await setupCiphoraRecoveryKey({
      rootKeyBase64: sessionKey,
    });

    if (result.ok && result.recoveryKey) {
      setRecoveryStatus(result.recovery ?? null);
      logActivity("account", "Recovery Key rotated", "Encrypted recovery wrapper stored in account control plane", "warning");
      toast("Recovery Key generated. Save it now.", "warning", 5000);
      return { ok: true, recoveryKey: result.recoveryKey };
    }

    toast(result.message ?? "Failed to generate Recovery Key", "error");
    return { ok: false, message: result.message };
  }, [accountSession, logActivity, sessionKey, toast]);

  const handleSendEmailVerification = useCallback(async (email: string) => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum mengirim verifikasi email." };
    }

    const result = await sendCiphoraEmailVerification(email);
    if (result.ok) {
      await refreshEmailVerificationStatus();
      logActivity("account", "Email verification sent", "Inbox verification link requested", "info");
      toast(result.message ?? "Verification email sent", "success");
      return { ok: true, message: result.message };
    }

    toast(result.message ?? "Failed to send verification email", "error");
    return { ok: false, message: result.message };
  }, [accountSession, logActivity, refreshEmailVerificationStatus, toast]);

  const handleConfirmEmailVerification = useCallback(async (token: string) => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum memverifikasi email." };
    }

    const result = await confirmCiphoraEmailVerification(token);
    if (result.ok) {
      setEmailVerificationStatus(result.emailVerification ?? { verified: true, verifiedAt: new Date().toISOString() });
      logActivity("account", "Email verified", "Account inbox ownership confirmed", "info");
      toast("Ciphora account email verified", "success");
      return { ok: true, message: result.message };
    }

    toast(result.message ?? "Failed to verify email", "error");
    return { ok: false, message: result.message };
  }, [accountSession, logActivity, toast]);

  const handleSaveSyncProfile = useCallback(async (input: {
    providerType: SyncProviderType;
    labelHint?: string;
    endpoint: string;
    accessToken: string;
  }) => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum menyimpan sync profile." };
    }

    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum menyimpan sync profile." };
    }

    const result = await saveCiphoraSyncProfile({
      rootKeyBase64: sessionKey,
      providerType: input.providerType,
      labelHint: input.labelHint,
      endpoint: input.endpoint,
      accessToken: input.accessToken,
    });

    if (result.ok) {
      setSyncProfile(result.syncProfile ?? null);
      logActivity(
        "account",
        "Encrypted sync profile saved",
        `${getSyncProviderLabel(input.providerType)} profile stored for future BYODB sync`,
        "info",
      );
      toast("Encrypted sync profile saved", "success");
      return { ok: true };
    }

    toast(result.message ?? "Failed to save sync profile", "error");
    return { ok: false, message: result.message };
  }, [accountSession, logActivity, sessionKey, toast]);

  const handleLoadSyncProfileForEdit = useCallback(async () => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum memuat sync profile tersimpan." };
    }

    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum memuat sync profile tersimpan." };
    }

    if (!syncProfile) {
      return { ok: false, message: "Belum ada sync profile aktif untuk dimuat." };
    }

    try {
      const config = await decryptCiphoraSyncProfileConfig({
        rootKeyBase64: sessionKey,
        syncProfile,
      });

      logActivity(
        "sync",
        "Encrypted sync profile loaded for edit",
        `${getSyncProviderLabel(config.providerType)} provider config decrypted locally into this browser tab`,
        "warning",
      );
      toast("Stored sync profile loaded locally into the form", "success");

      return {
        ok: true,
        message: "Profil sync tersimpan dimuat lokal ke form ini. Ciphora tetap tidak melihat plaintext URL atau token provider.",
        config,
      };
    } catch (error) {
      console.error(error);
      const message = "Gagal membuka sync profile tersimpan dengan vault key aktif di browser ini.";
      toast(message, "error");
      return { ok: false, message };
    }
  }, [accountSession, logActivity, sessionKey, syncProfile, toast]);

  const clearAutoPushTimer = useCallback(() => {
    if (!hasWindow() || autoPushTimerRef.current === null) return;
    window.clearTimeout(autoPushTimerRef.current);
    autoPushTimerRef.current = null;
  }, []);

  const handleDeleteSyncProfile = useCallback(async (mode: SyncDisconnectMode = "disable_only") => {
    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum menonaktifkan sync profile." };
    }

    if (!syncProfile) {
      return { ok: false, message: "Belum ada sync profile aktif untuk dinonaktifkan." };
    }

    if (syncActionLockRef.current) {
      return { ok: false, message: "Sinkronisasi lain sedang berjalan. Tunggu sebentar lalu coba lagi." };
    }

    clearAutoPushTimer();
    const providerLabel = getSyncProviderLabel(syncProfile.providerType);
    let cleanupKnownRemoteCount = 0;
    let cleanupSummary: { cleanedCount: number; preservedRemoteCount: number } | null = null;

    if (mode === "cleanup_known_remote") {
      if (!sessionKey) {
        return { ok: false, message: "Unlock vault lokal dulu sebelum cleanup provider dilakukan." };
      }

      syncActionLockRef.current = {
        action: "disconnect",
        trigger: "manual",
      };

      try {
        const currentVaultData = await refreshVault();
        if (!currentVaultData) {
          return { ok: false, message: "Vault lokal tidak bisa dimuat untuk cleanup sync profile." };
        }

        const deletedAt = new Date().toISOString();
        const cleanupInput = buildDisconnectCleanupVaultData(syncProfile, currentVaultData, deletedAt);
        cleanupKnownRemoteCount = cleanupInput.cleanupKnownRemoteCount;

        if (cleanupKnownRemoteCount > 0) {
          const cleanupResult = await pushVaultSnapshotToProvider({
            rootKeyBase64: sessionKey,
            syncProfile,
            vaultData: cleanupInput.vaultData,
          });

          if (!cleanupResult.ok) {
            const message = `Cleanup ${providerLabel} gagal. ${cleanupResult.message}`;
            toast(message, "error");
            return { ok: false, message };
          }

          cleanupSummary = {
            cleanedCount: cleanupResult.tombstoneCount,
            preservedRemoteCount: cleanupResult.preservedRemoteCount,
          };
        }
      } finally {
        syncActionLockRef.current = null;
      }
    }

    const result = await deleteCiphoraSyncProfile();
    if (result.ok) {
      setSyncProfile(null);
      const latestVaultData = await refreshVault();
      if (latestVaultData) {
        try {
          await replaceVault({
            items: latestVaultData.items,
            activities: latestVaultData.activities,
            syncState: createEmptyVaultSyncState(),
          });
        } catch (error) {
          console.error(error);
        }
      }

      if (autoSyncEnabled) {
        setAutoSyncRuntime((currentValue) => ({
          enabled: true,
          status: "paused",
          message: "Auto sync menunggu encrypted sync profile aktif lagi.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        }));
      }

      let detail = "Encrypted sync profile removed from account control plane; vault returns to local-only mode in this browser";
      let message = "Profil sync dinonaktifkan. Data remote tidak diubah, dan vault kembali local-only di browser ini.";

      if (mode === "cleanup_known_remote") {
        if (cleanupKnownRemoteCount > 0 && cleanupSummary) {
          detail = `${cleanupSummary.cleanedCount} known ${providerLabel} records were tombstoned before the encrypted sync profile was removed`;
          message = `Profil sync dinonaktifkan. ${cleanupSummary.cleanedCount} record ${providerLabel} yang sudah diketahui browser ini dibersihkan dari remote sebelum disconnect.`;
          if (cleanupSummary.preservedRemoteCount > 0) {
            message += ` ${cleanupSummary.preservedRemoteCount} record remote yang belum pernah dikenal browser ini dibiarkan aman sampai kamu pull dari browser yang mengenalnya.`;
            detail += `; ${cleanupSummary.preservedRemoteCount} unseen remote records were preserved`;
          }
        } else {
          detail = `Encrypted sync profile removed from account control plane; this browser had no known active ${providerLabel} records that were safe to clean up`;
          message = `Profil sync dinonaktifkan. Browser ini belum punya record ${providerLabel} aktif yang aman untuk dibersihkan, jadi remote yang belum dikenal tetap dibiarkan.`;
        }
      }

      logActivity("sync", "Encrypted sync profile disconnected", detail, "warning");
      toast(message, "warning", cleanupSummary?.preservedRemoteCount ? 5000 : undefined);
      return { ok: true, message };
    }

    if (mode === "cleanup_known_remote" && cleanupSummary) {
      const message = `Cleanup ${providerLabel} sudah selesai, tetapi profil sync gagal dinonaktifkan. ${result.message ?? "Coba nonaktifkan lagi tanpa menutup browser ini."}`;
      toast(message, "error");
      return { ok: false, message };
    }

    toast(result.message ?? "Failed to disable sync profile", "error");
    return { ok: false, message: result.message };
  }, [accountSession, autoSyncEnabled, clearAutoPushTimer, logActivity, refreshVault, replaceVault, sessionKey, syncProfile, toast]);

  const handleTestSyncProfileConnection = useCallback(async (input: {
    providerType: SyncProviderType;
    endpoint: string;
    accessToken: string;
  }) => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum menguji koneksi provider." };
    }

    const result = await testSyncProviderConnection(input);
    if (result.ok) {
      logActivity(
        "sync",
        "BYODB provider connection verified",
        `${getSyncProviderLabel(input.providerType)} test succeeded from this browser`,
        "info",
      );
      toast(result.message, "success");
      return { ok: true, message: result.message };
    }

    toast(result.message, "error");
    return { ok: false, message: result.message };
  }, [logActivity, sessionKey, toast]);

  const handleMigrateSyncProfile = useCallback(async (input: {
    providerType: SyncProviderType;
    labelHint?: string;
    endpoint: string;
    accessToken: string;
  }) => {
    if (!sessionKey) {
      return { ok: false, message: "Unlock vault lokal dulu sebelum memigrasikan sync provider." };
    }

    if (!accountSession) {
      return { ok: false, message: "Login Ciphora account dulu sebelum memigrasikan sync provider." };
    }

    if (!syncProfile) {
      return { ok: false, message: "Belum ada sync profile aktif untuk dimigrasikan." };
    }

    if (input.providerType === syncProfile.providerType) {
      return {
        ok: false,
        message: `Provider aktif sekarang sudah ${getSyncProviderLabel(syncProfile.providerType)}. Gunakan Load Saved Profile jika kamu hanya ingin merotasi URL atau token provider yang sama.`,
      };
    }

    if (syncActionLockRef.current) {
      return { ok: false, message: "Sinkronisasi lain sedang berjalan. Tunggu sebentar lalu coba lagi." };
    }

    const targetProfileResult = await createLocalCiphoraSyncProfile({
      rootKeyBase64: sessionKey,
      providerType: input.providerType,
      labelHint: input.labelHint,
      endpoint: input.endpoint,
      accessToken: input.accessToken,
      profileId: `migration-${Date.now()}`,
    });

    if (!targetProfileResult.ok || !targetProfileResult.syncProfile) {
      return {
        ok: false,
        message: targetProfileResult.message ?? "Gagal menyiapkan target provider untuk migrasi.",
      };
    }

    const sourceLabel = getSyncProviderLabel(syncProfile.providerType);
    const targetLabel = getSyncProviderLabel(input.providerType);
    clearAutoPushTimer();
    syncActionLockRef.current = {
      action: "migrate",
      trigger: "manual",
    };

    try {
      const currentVaultData = await refreshVault();
      if (!currentVaultData) {
        return { ok: false, message: "Vault lokal tidak bisa dimuat untuk migrasi provider." };
      }

      const sourcePullResult = await pullVaultSnapshotFromProvider({
        rootKeyBase64: sessionKey,
        syncProfile,
        vaultData: currentVaultData,
      });

      if (!sourcePullResult.ok) {
        return {
          ok: false,
          message: `Refresh ${sourceLabel} sebelum migrasi gagal. ${sourcePullResult.message}`,
        };
      }

      const sourceVaultData: VaultData = {
        ...currentVaultData,
        items: sourcePullResult.items,
        syncState: sourcePullResult.syncState,
        updatedAt: sourcePullResult.checkedAt,
      };

      await replaceVault({
        items: sourceVaultData.items,
        activities: sourceVaultData.activities,
        syncState: sourceVaultData.syncState,
      });

      const migrationVaultData: VaultData = {
        ...sourceVaultData,
        syncState: createEmptyVaultSyncState(),
      };

      const targetPreflightResult = await pullVaultSnapshotFromProvider({
        rootKeyBase64: sessionKey,
        syncProfile: targetProfileResult.syncProfile,
        vaultData: migrationVaultData,
      });

      if (!targetPreflightResult.ok) {
        return {
          ok: false,
          message: `Verifikasi target ${targetLabel} gagal. ${targetPreflightResult.message}`,
        };
      }

      if (targetPreflightResult.remoteActiveCount > 0) {
        return {
          ok: false,
          message: `Target ${targetLabel} masih berisi ${targetPreflightResult.remoteActiveCount} item aktif. Pakai provider kosong atau bersihkan target dulu sebelum migrasi.`,
        };
      }

      const targetPushResult = await pushVaultSnapshotToProvider({
        rootKeyBase64: sessionKey,
        syncProfile: targetProfileResult.syncProfile,
        vaultData: migrationVaultData,
      });

      if (!targetPushResult.ok) {
        return {
          ok: false,
          message: `Push migrasi ke ${targetLabel} gagal. ${targetPushResult.message}`,
        };
      }

      const targetVerifyResult = await pullVaultSnapshotFromProvider({
        rootKeyBase64: sessionKey,
        syncProfile: targetProfileResult.syncProfile,
        vaultData: {
          ...migrationVaultData,
          syncState: targetPushResult.syncState,
          updatedAt: targetPushResult.checkedAt,
        },
      });

      if (!targetVerifyResult.ok) {
        return {
          ok: false,
          message: `Snapshot terenkripsi sudah dikirim ke ${targetLabel}, tetapi verifikasi akhir gagal. ${targetVerifyResult.message} Sync profile aktif belum diganti.`,
        };
      }

      if (targetVerifyResult.remoteActiveCount !== sourceVaultData.items.length) {
        return {
          ok: false,
          message: `Snapshot target ${targetLabel} berhasil ditulis, tetapi jumlah item aktif ${targetVerifyResult.remoteActiveCount} tidak sama dengan vault lokal ${sourceVaultData.items.length}. Sync profile aktif belum diganti.`,
        };
      }

      const saveResult = await saveCiphoraSyncProfile({
        rootKeyBase64: sessionKey,
        providerType: input.providerType,
        labelHint: input.labelHint,
        endpoint: input.endpoint,
        accessToken: input.accessToken,
      });

      if (!saveResult.ok || !saveResult.syncProfile) {
        return {
          ok: false,
          message: `Snapshot target ${targetLabel} sudah valid, tetapi encrypted sync profile aktif gagal diganti. ${saveResult.message ?? "Coba simpan target provider lagi sebelum mengulang migrasi."}`,
        };
      }

      const installedSyncState = buildInstalledMigrationSyncState(
        targetVerifyResult.syncState,
        saveResult.syncProfile.providerType,
        saveResult.syncProfile.profileId,
      );

      await replaceVault({
        items: targetVerifyResult.items,
        activities: sourceVaultData.activities,
        syncState: installedSyncState,
      });

      setSyncProfile(saveResult.syncProfile);
      logActivity(
        "sync",
        "Sync provider migrated",
        `${sourceVaultData.items.length} item terenkripsi dipindahkan dari ${sourceLabel} ke ${targetLabel}; target kosong diverifikasi sebelum encrypted sync profile aktif diganti`,
        "warning",
      );

      if (autoSyncEnabled) {
        setAutoSyncRuntime((currentValue) => ({
          enabled: true,
          status: "ready",
          message: "Auto sync aktif. Menunggu focus atau perubahan lokal berikutnya.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        }));
      }

      const message = `Migrasi provider selesai. ${sourceVaultData.items.length} item terenkripsi dipindahkan dari ${sourceLabel} ke ${targetLabel}, lalu sync profile aktif diganti. Provider lama dibiarkan apa adanya sampai kamu membersihkannya sendiri.`;
      toast(message, "success", 5000);
      return { ok: true, message };
    } finally {
      syncActionLockRef.current = null;
    }
  }, [accountSession, autoSyncEnabled, clearAutoPushTimer, logActivity, refreshVault, replaceVault, sessionKey, syncProfile, toast]);

  const handleSetAutoSyncEnabled = useCallback((enabled: boolean) => {
    setAutoSyncEnabled(enabled);

    if (hasWindow()) {
      writeStorageValue(window.localStorage, STORAGE_KEYS.autoSyncEnabled, enabled ? "1" : "0");
    }

    if (!enabled) {
      clearAutoPushTimer();
      setAutoSyncRuntime((currentValue) => ({
        enabled: false,
        status: "disabled",
        message: "Auto sync tidak aktif di browser ini.",
        lastAction: currentValue.lastAction,
        lastActionAt: currentValue.lastActionAt,
      }));
      return;
    }

    setAutoSyncRuntime((currentValue) => ({
      enabled: true,
      status: "paused",
      message: "Auto sync menunggu vault unlocked, sync profile aktif, dan tab Ciphora aktif.",
      lastAction: currentValue.lastAction,
      lastActionAt: currentValue.lastActionAt,
    }));
  }, [clearAutoPushTimer]);

  const runProviderSync = useCallback(async (input: {
    action: "push" | "pull";
    trigger: "manual" | "auto";
    reason?: string;
  }) => {
    clearAutoPushTimer();

    if (syncActionLockRef.current) {
      const message = input.trigger === "manual"
        ? "Sinkronisasi lain sedang berjalan. Tunggu sebentar lalu coba lagi."
        : "Auto sync menunggu sinkronisasi lain selesai.";

      if (input.trigger === "auto" && autoSyncEnabled) {
        setAutoSyncRuntime((currentValue) => ({
          enabled: true,
          status: "scheduled",
          message,
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        }));
      }

      return { ok: false, message };
    }

    if (!sessionKey) {
      const message = "Unlock vault lokal dulu sebelum menjalankan sync.";
      if (input.trigger === "auto" && autoSyncEnabled) {
        setAutoSyncRuntime((currentValue) => ({
          enabled: true,
          status: "paused",
          message: "Auto sync menunggu vault unlocked lagi.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        }));
      }
      return { ok: false, message };
    }

    if (!accountSession) {
      const message = "Login Ciphora account dulu sebelum menjalankan sync.";
      if (input.trigger === "auto" && autoSyncEnabled) {
        setAutoSyncRuntime((currentValue) => ({
          enabled: true,
          status: "paused",
          message: "Auto sync menunggu session account Ciphora aktif.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        }));
      }
      return { ok: false, message };
    }

    if (!syncProfile) {
      const message = "Simpan encrypted sync profile dulu sebelum menjalankan sync.";
      if (input.trigger === "auto" && autoSyncEnabled) {
        setAutoSyncRuntime((currentValue) => ({
          enabled: true,
          status: "paused",
          message: "Auto sync menunggu encrypted sync profile aktif.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        }));
      }
      return { ok: false, message };
    }

    if (input.trigger === "auto" && !isAutoSyncViewportActive) {
      setAutoSyncRuntime((currentValue) => ({
        enabled: true,
        status: "paused",
        message: "Auto sync menunggu tab Ciphora aktif lagi.",
        lastAction: currentValue.lastAction,
        lastActionAt: currentValue.lastActionAt,
      }));
      return { ok: false, message: "Auto sync menunggu tab aktif." };
    }

    const providerLabel = getSyncProviderLabel(syncProfile.providerType);
    syncActionLockRef.current = {
      action: input.action,
      trigger: input.trigger,
    };

    if (input.trigger === "auto" && autoSyncEnabled) {
      setAutoSyncRuntime((currentValue) => ({
        enabled: true,
        status: "syncing",
        message: `Auto ${input.action} ${providerLabel} sedang berjalan...`,
        lastAction: input.action,
        lastActionAt: currentValue.lastActionAt,
      }));
    }

    try {
      const currentVaultData = await refreshVault();
      if (!currentVaultData) {
        const message = "Vault lokal tidak bisa dimuat untuk sinkronisasi.";
        if (input.trigger === "auto" && autoSyncEnabled) {
          setAutoSyncRuntime((currentValue) => ({
            enabled: true,
            status: "error",
            message,
            lastAction: currentValue.lastAction,
            lastActionAt: currentValue.lastActionAt,
          }));
        } else {
          toast(message, "error");
        }
        return { ok: false, message };
      }

      let workingVaultData = currentVaultData;
      let refreshedBeforePush = false;
      if (input.action === "push" && shouldPullBeforePush(syncProfile, workingVaultData)) {
        if (input.trigger === "auto" && autoSyncEnabled) {
          setAutoSyncRuntime((currentValue) => ({
            enabled: true,
            status: "syncing",
            message: `Auto push ${providerLabel} sedang refresh remote dulu...`,
            lastAction: "pull",
            lastActionAt: currentValue.lastActionAt,
          }));
        }

        const prePushPullResult = await pullVaultSnapshotFromProvider({
          rootKeyBase64: sessionKey,
          syncProfile,
          vaultData: workingVaultData,
        });

        if (!prePushPullResult.ok) {
          const message = `Refresh ${providerLabel} sebelum push gagal. ${prePushPullResult.message}`;
          if (input.trigger === "auto" && autoSyncEnabled) {
            setAutoSyncRuntime({
              enabled: true,
              status: "error",
              message,
              lastAction: input.action,
              lastActionAt: prePushPullResult.checkedAt,
            });
          } else {
            toast(message, "error");
          }
          return { ok: false, message };
        }

        await replaceVault({
          items: prePushPullResult.items,
          activities: workingVaultData.activities,
          syncState: prePushPullResult.syncState,
        });

        workingVaultData = {
          ...workingVaultData,
          items: prePushPullResult.items,
          syncState: prePushPullResult.syncState,
        };
        refreshedBeforePush = true;
      }

      if (syncProfile.providerType === "external_turso") {
        if (input.action === "push") {
          const result = await pushVaultSnapshotToTurso({
            rootKeyBase64: sessionKey,
            syncProfile,
            vaultData: workingVaultData,
          });

          if (!result.ok) {
            if (input.trigger === "auto" && autoSyncEnabled) {
              setAutoSyncRuntime({
                enabled: true,
                status: "error",
                message: `Auto push ${providerLabel} gagal. ${result.message}`,
                lastAction: input.action,
                lastActionAt: result.checkedAt,
              });
            } else {
              toast(result.message, "error");
            }
            return { ok: false, message: result.message };
          }

          await replaceVault({
            items: workingVaultData.items,
            activities: workingVaultData.activities,
            syncState: result.syncState,
          });

          if (input.trigger === "manual") {
            logActivity(
              "sync",
              "Turso vault pushed",
              `${result.pushedCount} item delta terenkripsi${result.tombstoneCount > 0 ? ` dan ${result.tombstoneCount} tombstone` : ""} dikirim ke provider milik user${refreshedBeforePush ? "; remote direfresh dulu sebelum push" : ""}${result.preservedRemoteCount > 0 ? `; ${result.preservedRemoteCount} item remote belum disentuh` : ""}${result.conflictCount > 0 ? `; ${result.conflictCount} konflik remote diblokir` : ""}`,
              result.conflictCount > 0 ? "warning" : "info",
            );
            toast(result.message, result.conflictCount > 0 ? "warning" : "success");
            if (autoSyncEnabled) {
              setAutoSyncRuntime((currentValue) => ({
                enabled: true,
                status: result.conflictCount > 0 ? "error" : "ready",
                message: result.conflictCount > 0
                  ? "Auto sync berhenti karena ada konflik remote yang perlu direview."
                  : "Auto sync aktif. Menunggu focus atau perubahan lokal berikutnya.",
                lastAction: currentValue.lastAction,
                lastActionAt: currentValue.lastActionAt,
              }));
            }
          } else {
            setAutoSyncRuntime({
              enabled: true,
              status: result.conflictCount > 0 ? "error" : "ready",
              message: `Auto push ${providerLabel} selesai. ${result.message}`,
              lastAction: input.action,
              lastActionAt: result.checkedAt,
            });
          }

          return { ok: true, message: result.message };
        }

        const result = await pullVaultSnapshotFromTurso({
          rootKeyBase64: sessionKey,
          syncProfile,
          vaultData: workingVaultData,
        });

        if (!result.ok) {
          if (input.trigger === "auto" && autoSyncEnabled) {
            setAutoSyncRuntime({
              enabled: true,
              status: "error",
              message: `Auto pull ${providerLabel} gagal. ${result.message}`,
              lastAction: input.action,
              lastActionAt: result.checkedAt,
            });
          } else {
            toast(result.message, "error");
          }
          return { ok: false, message: result.message };
        }

        await replaceVault({
          items: result.items,
          activities: workingVaultData.activities,
          syncState: result.syncState,
        });

        if (input.trigger === "manual") {
          logActivity(
            "sync",
            "Turso vault pulled",
            `${result.mergedCount} item remote dimuat${result.deletedCount > 0 ? `, ${result.deletedCount} delete remote diterapkan` : ""}${result.preservedLocalCount > 0 ? `, ${result.preservedLocalCount} item lokal dipertahankan` : ""}`,
            result.deletedCount > 0 ? "warning" : "info",
          );
          toast(result.message, result.mergedCount > 0 || result.deletedCount > 0 ? "success" : "info");
          if (autoSyncEnabled) {
            setAutoSyncRuntime((currentValue) => ({
              enabled: true,
              status: "ready",
              message: "Auto sync aktif. Menunggu focus atau perubahan lokal berikutnya.",
              lastAction: currentValue.lastAction,
              lastActionAt: currentValue.lastActionAt,
            }));
          }
        } else {
          setAutoSyncRuntime({
            enabled: true,
            status: "ready",
            message: `Auto pull ${providerLabel} selesai. ${result.message}`,
            lastAction: input.action,
            lastActionAt: result.checkedAt,
          });
        }

        return { ok: true, message: result.message };
      }

      if (input.action === "push") {
        const result = await pushVaultSnapshotToProvider({
          rootKeyBase64: sessionKey,
          syncProfile,
          vaultData: workingVaultData,
        });

        if (!result.ok) {
          if (input.trigger === "auto" && autoSyncEnabled) {
            setAutoSyncRuntime({
              enabled: true,
              status: "error",
              message: `Auto push ${providerLabel} gagal. ${result.message}`,
              lastAction: input.action,
              lastActionAt: result.checkedAt,
            });
          } else {
            toast(result.message, "error");
          }
          return { ok: false, message: result.message };
        }

        await replaceVault({
          items: workingVaultData.items,
          activities: workingVaultData.activities,
          syncState: result.syncState,
        });

        if (input.trigger === "manual") {
          logActivity(
            "sync",
            `${providerLabel} vault pushed`,
            `${result.pushedCount} item delta terenkripsi${result.tombstoneCount > 0 ? ` dan ${result.tombstoneCount} tombstone` : ""} dikirim ke provider milik user${refreshedBeforePush ? "; remote direfresh dulu sebelum push" : ""}${result.preservedRemoteCount > 0 ? `; ${result.preservedRemoteCount} item remote belum disentuh` : ""}${result.conflictCount > 0 ? `; ${result.conflictCount} konflik remote diblokir` : ""}`,
            result.conflictCount > 0 ? "warning" : "info",
          );
          toast(result.message, result.conflictCount > 0 ? "warning" : "success");
          if (autoSyncEnabled) {
            setAutoSyncRuntime((currentValue) => ({
              enabled: true,
              status: result.conflictCount > 0 ? "error" : "ready",
              message: result.conflictCount > 0
                ? "Auto sync berhenti karena ada konflik remote yang perlu direview."
                : "Auto sync aktif. Menunggu focus atau perubahan lokal berikutnya.",
              lastAction: currentValue.lastAction,
              lastActionAt: currentValue.lastActionAt,
            }));
          }
        } else {
          setAutoSyncRuntime({
            enabled: true,
            status: result.conflictCount > 0 ? "error" : "ready",
            message: `Auto push ${providerLabel} selesai. ${result.message}`,
            lastAction: input.action,
            lastActionAt: result.checkedAt,
          });
        }

        return { ok: true, message: result.message };
      }

      const result = await pullVaultSnapshotFromProvider({
        rootKeyBase64: sessionKey,
        syncProfile,
        vaultData: workingVaultData,
      });

      if (!result.ok) {
        if (input.trigger === "auto" && autoSyncEnabled) {
          setAutoSyncRuntime({
            enabled: true,
            status: "error",
            message: `Auto pull ${providerLabel} gagal. ${result.message}`,
            lastAction: input.action,
            lastActionAt: result.checkedAt,
          });
        } else {
          toast(result.message, "error");
        }
        return { ok: false, message: result.message };
      }

      await replaceVault({
        items: result.items,
        activities: workingVaultData.activities,
        syncState: result.syncState,
      });

      if (input.trigger === "manual") {
        logActivity(
          "sync",
          `${providerLabel} vault pulled`,
          `${result.mergedCount} item remote dimuat${result.deletedCount > 0 ? `, ${result.deletedCount} delete remote diterapkan` : ""}${result.preservedLocalCount > 0 ? `, ${result.preservedLocalCount} item lokal dipertahankan` : ""}`,
          result.deletedCount > 0 ? "warning" : "info",
        );
        toast(result.message, result.mergedCount > 0 || result.deletedCount > 0 ? "success" : "info");
        if (autoSyncEnabled) {
          setAutoSyncRuntime((currentValue) => ({
            enabled: true,
            status: "ready",
            message: "Auto sync aktif. Menunggu focus atau perubahan lokal berikutnya.",
            lastAction: currentValue.lastAction,
            lastActionAt: currentValue.lastActionAt,
          }));
        }
      } else {
        setAutoSyncRuntime({
          enabled: true,
          status: "ready",
          message: `Auto pull ${providerLabel} selesai. ${result.message}`,
          lastAction: input.action,
          lastActionAt: result.checkedAt,
        });
      }

      return { ok: true, message: result.message };
    } finally {
      syncActionLockRef.current = null;
    }
  }, [accountSession, autoSyncEnabled, clearAutoPushTimer, isAutoSyncViewportActive, logActivity, refreshVault, replaceVault, sessionKey, syncProfile, toast]);

  const handleResolveSyncConflict = useCallback(async (input: {
    conflictId: string;
    resolution: SyncConflictResolution;
  }) => {
    if (!sessionKeyState || !syncProfile) {
      return { ok: false, message: "Vault harus unlocked dan sync profile aktif sebelum resolve konflik." };
    }

    if (syncActionLockRef.current) {
      return { ok: false, message: "Sync sedang berjalan. Tunggu proses sekarang selesai dulu." };
    }

    syncActionLockRef.current = { action: "resolve", trigger: "manual" };
    clearAutoPushTimer();

    try {
      const vaultData = await refreshVault();
      if (!vaultData) {
        return { ok: false, message: "Vault terenkripsi belum siap dibaca." };
      }

      const result = syncProfile.providerType === "external_turso"
        ? await resolveTursoSyncConflict({
          rootKeyBase64: sessionKeyState,
          syncProfile,
          vaultData,
          conflictId: input.conflictId,
          resolution: input.resolution,
        })
        : isBridgeSyncProvider(syncProfile.providerType)
          ? await resolveD1BridgeSyncConflict({
            rootKeyBase64: sessionKeyState,
            syncProfile,
            vaultData,
            conflictId: input.conflictId,
            resolution: input.resolution,
          })
          : await resolveD1DirectSyncConflict({
            rootKeyBase64: sessionKeyState,
            syncProfile,
            vaultData,
            conflictId: input.conflictId,
            resolution: input.resolution,
          });

      if (!result.ok) {
        toast(result.message, "warning");
        return { ok: false, message: result.message };
      }

      await replaceVault({
        items: result.items,
        activities: vaultData.activities,
        syncState: result.syncState,
      });

      const providerLabel = getSyncProviderLabel(syncProfile.providerType);
      logActivity(
        "sync",
        `${providerLabel} conflict resolved`,
        `${input.resolution.replace(/_/g, " ")} diterapkan untuk ${input.conflictId}`,
        input.resolution === "keep_remote" ? "warning" : "info",
      );
      toast(result.message, "success");
      if (autoSyncEnabled && (input.resolution === "keep_local" || input.resolution === "manual_edit" || input.resolution === "keep_both")) {
        setAutoSyncRuntime({
          enabled: true,
          status: "scheduled",
          message: "Konflik sudah di-resolve. Auto-sync akan mengevaluasi delta lokal berikutnya.",
          lastAction: "push",
          lastActionAt: result.checkedAt,
        });
      }

      return { ok: true, message: result.message };
    } finally {
      syncActionLockRef.current = null;
    }
  }, [
    autoSyncEnabled,
    clearAutoPushTimer,
    logActivity,
    refreshVault,
    replaceVault,
    sessionKeyState,
    syncProfile,
    toast,
  ]);

  const handlePushTursoSync = useCallback(async () => runProviderSync({ action: "push", trigger: "manual" }), [runProviderSync]);
  const handlePullTursoSync = useCallback(async () => runProviderSync({ action: "pull", trigger: "manual" }), [runProviderSync]);
  const handlePushD1BridgeSync = useCallback(async () => runProviderSync({ action: "push", trigger: "manual" }), [runProviderSync]);
  const handlePullD1BridgeSync = useCallback(async () => runProviderSync({ action: "pull", trigger: "manual" }), [runProviderSync]);
  const handlePushD1DirectSync = useCallback(async () => runProviderSync({ action: "push", trigger: "manual" }), [runProviderSync]);
  const handlePullD1DirectSync = useCallback(async () => runProviderSync({ action: "pull", trigger: "manual" }), [runProviderSync]);

  const maybeRunAutoPull = useCallback((reason: string) => {
    if (!autoSyncEnabled || !hasAutoSyncPrerequisites || !isAutoSyncViewportActive) {
      return;
    }

    const now = Date.now();
    if (now - autoPullCooldownRef.current < AUTO_PULL_COOLDOWN_MS) {
      return;
    }

    autoPullCooldownRef.current = now;
    void runProviderSync({
      action: "pull",
      trigger: "auto",
      reason,
    });
  }, [autoSyncEnabled, hasAutoSyncPrerequisites, isAutoSyncViewportActive, runProviderSync]);

  useEffect(() => {
    if (!hasWindow()) return undefined;

    const updateViewportState = () => {
      setIsAutoSyncViewportActive(readAutoSyncViewportActive());
    };

    updateViewportState();
    window.addEventListener("focus", updateViewportState);
    window.addEventListener("blur", updateViewportState);
    document.addEventListener("visibilitychange", updateViewportState);

    return () => {
      window.removeEventListener("focus", updateViewportState);
      window.removeEventListener("blur", updateViewportState);
      document.removeEventListener("visibilitychange", updateViewportState);
    };
  }, []);

  useEffect(() => {
    if (!autoSyncEnabled) {
      setAutoSyncRuntime((currentValue) => ({
        enabled: false,
        status: "disabled",
        message: "Auto sync tidak aktif di browser ini.",
        lastAction: currentValue.lastAction,
        lastActionAt: currentValue.lastActionAt,
      }));
      return;
    }

    if (!hasAutoSyncPrerequisites) {
      clearAutoPushTimer();
      setAutoSyncRuntime((currentValue) => currentValue.status === "syncing"
        ? currentValue
        : {
          enabled: true,
          status: "paused",
          message: "Auto sync menunggu vault unlocked, session account, dan sync profile aktif.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        });
      return;
    }

    if (!isAutoSyncViewportActive) {
      clearAutoPushTimer();
      setAutoSyncRuntime((currentValue) => currentValue.status === "syncing"
        ? currentValue
        : {
          enabled: true,
          status: "paused",
          message: "Auto sync menunggu tab Ciphora aktif lagi.",
          lastAction: currentValue.lastAction,
          lastActionAt: currentValue.lastActionAt,
        });
      return;
    }

    setAutoSyncRuntime((currentValue) => {
      if (currentValue.status === "syncing" || currentValue.status === "scheduled" || currentValue.status === "error") {
        return currentValue;
      }

      const message = hasPendingLocalAutoSync
        ? "Auto sync aktif. Perubahan lokal akan dipush otomatis setelah jeda singkat."
        : "Auto sync aktif. Pull berjalan saat app kembali fokus, dan push berjalan setelah perubahan lokal.";

      return {
        enabled: true,
        status: "ready",
        message,
        lastAction: currentValue.lastAction,
        lastActionAt: currentValue.lastActionAt,
      };
    });
  }, [autoSyncEnabled, clearAutoPushTimer, hasAutoSyncPrerequisites, hasPendingLocalAutoSync, isAutoSyncViewportActive]);

  useEffect(() => {
    if (!autoSyncEnabled || !hasAutoSyncPrerequisites || !isAutoSyncViewportActive) {
      return;
    }

    maybeRunAutoPull("app-focus");
  }, [autoSyncEnabled, hasAutoSyncPrerequisites, isAutoSyncViewportActive, maybeRunAutoPull, syncProfile?.profileId]);

  useEffect(() => {
    if (!autoSyncEnabled || !hasAutoSyncPrerequisites || !isAutoSyncViewportActive || !hasPendingLocalAutoSync) {
      clearAutoPushTimer();
      return undefined;
    }

    setAutoSyncRuntime((currentValue) => ({
      enabled: true,
      status: "scheduled",
      message: "Perubahan lokal terdeteksi. Auto push akan dijalankan sebentar lagi.",
      lastAction: currentValue.lastAction,
      lastActionAt: currentValue.lastActionAt,
    }));

    clearAutoPushTimer();
    autoPushTimerRef.current = window.setTimeout(() => {
      autoPushTimerRef.current = null;
      void runProviderSync({
        action: "push",
        trigger: "auto",
        reason: "local-change",
      });
    }, 3500);

    return () => {
      clearAutoPushTimer();
    };
  }, [
    autoSyncEnabled,
    clearAutoPushTimer,
    hasAutoSyncPrerequisites,
    hasPendingLocalAutoSync,
    isAutoSyncViewportActive,
    runProviderSync,
    syncStatusSummary.lastMergedAt,
    syncStatusSummary.lastPulledAt,
    syncStatusSummary.lastPushedAt,
    syncStatusSummary.pendingLocalDeleteCount,
    syncStatusSummary.pendingLocalItemCount,
  ]);

  const handleLock = useCallback(() => {
    if (hasWindow()) {
      clearVaultSession(window.sessionStorage);
    }
    setSessionKeyState(null);
    resetAutoLock();
    navigate(getDefaultVaultPath(false, hasPin));
  }, [hasPin, navigate, resetAutoLock]);

  const handleResetLocalStorage = useCallback(async () => {
    if (!hasWindow()) {
      return { ok: false, message: "Browser storage tidak tersedia." };
    }

    clearAutoPushTimer();

    try {
      await logoutCiphoraAccount();
    } catch (error) {
      console.error(error);
    }

    resetCiphoraBrowserStorage(window.localStorage);
    resetCiphoraBrowserStorage(window.sessionStorage);

    setSessionKeyState(null);
    setVaultConfigured(false);
    setHasQuickPinState(false);
    setHasLegacyPinState(false);
    setAccountSession(null);
    setDeviceSessionState(null);
    setEmailVerificationStatus(null);
    setRecoveryStatus(null);
    setSyncProfile(null);
    setAutoSyncEnabled(false);
    setAutoSyncRuntime(createAutoSyncRuntimeState(false));
    setGlobalSearch("");
    setItemModalOpen(false);
    setEditItem(null);
    setDeleteTarget(null);
    resetAutoLock();

    window.location.replace(ROUTE_PATHS.unlockVault);
    return { ok: true, message: "Storage lokal Ciphora di browser ini direset." };
  }, [clearAutoPushTimer, resetAutoLock]);

  useEffect(() => {
    if (isUnlocked && autoLockDurationSeconds !== null && autoLockSeconds === 0) handleLock();
  }, [autoLockDurationSeconds, autoLockSeconds, handleLock, isUnlocked]);

  useEffect(() => {
    let resetTimerId: number | null = null;

    const reset = () => {
      if (!isUnlocked) return;
      if (resetTimerId !== null) return;

      // Defer the shell state reset so link/default actions complete first.
      resetTimerId = window.setTimeout(() => {
        setAutoLockSeconds((currentValue) => (currentValue === (autoLockDurationSeconds ?? 0) ? currentValue : (autoLockDurationSeconds ?? 0)));
        resetTimerId = null;
      }, 0);
    };

    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("click", reset);

    return () => {
      if (resetTimerId !== null) {
        window.clearTimeout(resetTimerId);
      }
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("click", reset);
    };
  }, [autoLockDurationSeconds, isUnlocked]);

  const handleAutoLockDurationChange = useCallback((durationSeconds: number | null) => {
    setAutoLockDurationSeconds(durationSeconds);
    if (hasWindow()) {
      writeStorageValue(
        window.localStorage,
        STORAGE_KEYS.autoLockSeconds,
        durationSeconds === null ? "never" : String(durationSeconds),
      );
    }
  }, []);

  const handleGetStarted = () => {
    navigate(getDefaultVaultPath(isUnlocked, hasPin));
  };

  const handlePreUnlockBackupRestore = useCallback(async (file: File): Promise<VaultImportResult> => {
    if (!hasWindow()) {
      return { ok: false, message: "Browser crypto is unavailable." };
    }

    if (vaultConfigured) {
      return {
        ok: false,
        message: "A local vault already exists. Unlock it and use Settings to replace the vault backup.",
      };
    }

    try {
      const raw = await file.text();
      const parsed = await parseImportedVaultFile(raw);

      if (parsed.kind !== "encrypted") {
        return {
          ok: false,
          message: "Pre-unlock restore only accepts encrypted Ciphora backup files.",
        };
      }

      replaceEncryptedBackup(window.localStorage, parsed.backup);
      clearLegacyPlaintextVault(window.localStorage);
      removeStorageValue(window.localStorage, STORAGE_KEYS.pinHash);
      clearVaultSession(window.sessionStorage);
      setSessionKeyState(null);
      setVaultConfigured(true);
      refreshPinState();
      setIsSessionReady(true);
      resetAutoLock();
      navigate(ROUTE_PATHS.unlockVault, { replace: true });
      toast("Encrypted backup restored. Unlock it with the backup master password.", "success");

      return {
        ok: true,
        message: "Encrypted backup restored. Unlock it with the backup master password.",
      };
    } catch (caughtError) {
      console.error(caughtError);
      return {
        ok: false,
        message: "Failed to parse the selected encrypted backup file.",
      };
    }
  }, [navigate, refreshPinState, resetAutoLock, toast, vaultConfigured]);

  const handleRestoreFromAccount = useCallback(async (input: {
    email: string;
    accountPassword: string;
    localPassword: string;
  }): Promise<VaultImportResult> => {
    if (!hasWindow()) {
      return { ok: false, message: "Browser crypto is unavailable." };
    }

    if (vaultConfigured) {
      return {
        ok: false,
        message: "Vault lokal sudah ada di browser ini. Unlock dulu, lalu gunakan Settings untuk sync atau replace vault.",
      };
    }

    const loginResult = await loginCiphoraAccountForRestore({
      email: input.email,
      password: input.accountPassword,
    });

    if (!loginResult.ok || !loginResult.session || !loginResult.rootKeyBase64) {
      toast(loginResult.message ?? "Failed to login Ciphora account", "error");
      return {
        ok: false,
        message: loginResult.message ?? "Gagal login ke Ciphora account untuk restore device baru.",
      };
    }

    try {
      const activeSyncProfile = await getCiphoraSyncProfile();
      if (!activeSyncProfile) {
        await logoutCiphoraAccount();
        return {
          ok: false,
          message: "Account ini belum punya encrypted sync profile aktif. Pulihkan dulu dari backup terenkripsi atau aktifkan sync dari device lain.",
        };
      }

      const providerLabel = getSyncProviderLabel(activeSyncProfile.providerType);

      const pullResult = await pullVaultSnapshotFromProvider({
        rootKeyBase64: loginResult.rootKeyBase64,
        syncProfile: activeSyncProfile,
        vaultData: createEmptyVaultData(),
      });

      if (!pullResult.ok) {
        await logoutCiphoraAccount();
        toast(pullResult.message, "error");
        return {
          ok: false,
          message: pullResult.message,
        };
      }

      const restoredVault = createEmptyVaultData({
        items: pullResult.items,
        syncState: pullResult.syncState,
        activities: [
          createVaultActivity({
            type: "restore",
            label: "Vault restored",
            detail: pullResult.items.length > 0
              ? `${pullResult.items.length} item terenkripsi dipulihkan dari snapshot ${providerLabel} milik user`
              : `Encrypted ${providerLabel} snapshot aktif, tapi belum berisi item vault`,
            severity: pullResult.items.length > 0 ? "warning" : "info",
          }),
        ],
      });

      const installedVault = await installRestoredEncryptedVault(
        window.localStorage,
        input.localPassword,
        loginResult.rootKeyBase64,
        restoredVault,
      );

      clearLegacyPlaintextVault(window.localStorage);
      clearQuickUnlockPin(window.localStorage);
      removeStorageValue(window.localStorage, STORAGE_KEYS.pinHash);
      clearVaultSession(window.sessionStorage);
      writeSessionKey(window.sessionStorage, installedVault.rawKeyBase64);
      setSessionKeyState(installedVault.rawKeyBase64);
      setVaultConfigured(true);
      refreshPinState();
      setIsSessionReady(true);
      resetAutoLock();
      setAccountSession(loginResult.session);
      setSyncProfile(activeSyncProfile);
      void refreshDeviceSessionState();
      void refreshRecoveryStatus();
      navigate(ROUTE_PATHS.vaultDashboard, { replace: true });
      toast(
        pullResult.items.length > 0
          ? "Vault restored from Ciphora account"
          : `Ciphora account restored with an empty ${providerLabel} snapshot`,
        "success",
      );

      return {
        ok: true,
        message: pullResult.items.length > 0
          ? `Vault dipulihkan dari Ciphora account dan snapshot ${providerLabel}.`
          : `Account tersambung dan vault lokal baru dipasang dari snapshot ${providerLabel} yang masih kosong.`,
      };
    } catch (caughtError) {
      console.error(caughtError);
      await logoutCiphoraAccount();
      setAccountSession(null);
      setDeviceSessionState(null);
      setRecoveryStatus(null);
      setSyncProfile(null);
      return {
        ok: false,
        message: "Gagal menyelesaikan restore device baru dari Ciphora account.",
      };
    }
  }, [navigate, refreshDeviceSessionState, refreshPinState, refreshRecoveryStatus, resetAutoLock, toast, vaultConfigured]);

  const handleRequestRecoveryResetEmail = useCallback(async (email: string): Promise<{ ok: boolean; message?: string }> => {
    const result = await requestCiphoraRecoveryResetEmail(email);
    if (result.ok) {
      toast(result.message ?? "Recovery reset email requested", "success");
      return { ok: true, message: result.message };
    }

    toast(result.message ?? "Failed to request recovery reset email", "error");
    return { ok: false, message: result.message };
  }, [toast]);

  const handleRecoveryReset = useCallback(async (input: {
    email: string;
    emailResetToken: string;
    recoveryKey: string;
    newPassword: string;
  }): Promise<{ ok: boolean; message?: string }> => {
    const result = await resetCiphoraAccountPasswordWithRecoveryKey({
      email: input.email,
      emailResetToken: input.emailResetToken,
      recoveryKey: input.recoveryKey,
      newPassword: input.newPassword,
    });

    if (!result.ok || !result.session) {
      toast(result.message ?? "Failed to reset Ciphora account password", "error");
      return {
        ok: false,
        message: result.message ?? "Gagal mereset Ciphora account password dengan Recovery Key.",
      };
    }

    setAccountSession(result.session);
    await Promise.all([
      refreshDeviceSessionState(),
      refreshEmailVerificationStatus(),
      refreshRecoveryStatus(),
      refreshSyncProfile(),
    ]);
    toast("Ciphora account password reset", "success");
    return {
      ok: true,
      message: "Account password direset. Form restore account di bawah siap dipakai dengan password baru ini.",
    };
  }, [refreshDeviceSessionState, refreshEmailVerificationStatus, refreshRecoveryStatus, refreshSyncProfile, toast]);

  const handleUnlockSubmit = useCallback(async (password: string): Promise<{ ok: boolean; message?: string }> => {
    if (!hasWindow()) {
      return {
        ok: false,
        message: "Browser crypto is unavailable.",
      };
    }

    try {
      if (!vaultConfigured) {
        const initialVault = buildInitialVaultData();
        const nextVault = await initializeEncryptedVault(window.localStorage, password, initialVault.data);
        clearLegacyPlaintextVault(window.localStorage);
        clearQuickUnlockPin(window.localStorage);
        removeStorageValue(window.localStorage, STORAGE_KEYS.pinHash);
        writeSessionKey(window.sessionStorage, nextVault.rawKeyBase64);
        setSessionKeyState(nextVault.rawKeyBase64);
        setVaultConfigured(true);
        refreshPinState();
        setIsSessionReady(true);
        resetAutoLock();
        navigate(
          emailVerificationTokenFromUrl ? emailVerificationSettingsPath : ROUTE_PATHS.vaultDashboard,
          { replace: true },
        );
        toast(
          initialVault.mode === "migrated"
            ? "Legacy vault encrypted and unlocked"
            : "Encrypted vault created",
          "success",
        );
        return { ok: true };
      }

      const unlocked = await unlockEncryptedVault(window.localStorage, password);
      if (!unlocked) {
        return {
          ok: false,
          message: "Incorrect master password. Please try again.",
        };
      }

      writeSessionKey(window.sessionStorage, unlocked.rawKeyBase64);
      setSessionKeyState(unlocked.rawKeyBase64);
      refreshPinState();
      setIsSessionReady(true);
      resetAutoLock();
      setQueuedActivity({
        type: "unlock",
        label: "Vault unlocked",
        detail: "Master password verified",
        severity: "info",
        time: new Date().toTimeString().slice(0, 8),
      });
      navigate(
        emailVerificationTokenFromUrl ? emailVerificationSettingsPath : ROUTE_PATHS.vaultDashboard,
        { replace: true },
      );
      toast("Vault unlocked successfully", "success");
      return { ok: true };
    } catch (caughtError) {
      console.error(caughtError);
      return {
        ok: false,
        message: vaultConfigured
          ? "Failed to decrypt the encrypted vault."
          : "Failed to initialize the encrypted vault.",
      };
    }
  }, [
    buildInitialVaultData,
    emailVerificationSettingsPath,
    emailVerificationTokenFromUrl,
    navigate,
    refreshPinState,
    resetAutoLock,
    toast,
    vaultConfigured,
  ]);

  const handlePinUnlock = useCallback(async (pin: string): Promise<{ ok: boolean; message?: string }> => {
    if (!hasWindow()) {
      return {
        ok: false,
        message: "Browser crypto is unavailable.",
      };
    }

    const rawKeyBase64 = await unlockWithQuickPin(window.localStorage, pin);
    if (!rawKeyBase64) {
      return {
        ok: false,
        message: "Incorrect PIN. Use the master password if needed.",
      };
    }

    try {
      await loadVaultData(window.localStorage, rawKeyBase64);
      writeSessionKey(window.sessionStorage, rawKeyBase64);
      setSessionKeyState(rawKeyBase64);
      refreshPinState();
      setIsSessionReady(true);
      resetAutoLock();
      setQueuedActivity({
        type: "unlock",
        label: "Vault unlocked",
        detail: "Quick unlock PIN verified",
        severity: "info",
        time: new Date().toTimeString().slice(0, 8),
      });
      navigate(ROUTE_PATHS.vaultDashboard, { replace: true });
      toast("Vault unlocked via quick PIN", "success");
      return { ok: true };
    } catch (caughtError) {
      console.error(caughtError);
      clearQuickUnlockPin(window.localStorage);
      refreshPinState();
      return {
        ok: false,
        message: "Stored quick unlock is stale. Use the master password and configure a new PIN.",
      };
    }
  }, [navigate, refreshPinState, resetAutoLock, toast]);

  const handlePinSetup = useCallback(async (pin: string): Promise<{ ok: boolean; message?: string }> => {
    if (!hasWindow() || !sessionKey) {
      return {
        ok: false,
        message: "Unlock the vault with your master password first.",
      };
    }

    try {
      await storeQuickUnlockPin(window.localStorage, pin, sessionKey);
      removeStorageValue(window.localStorage, STORAGE_KEYS.pinHash);
      refreshPinState();
      navigate(ROUTE_PATHS.preferencesSettings, { replace: true });
      toast("Quick unlock PIN saved", "success");
      return { ok: true };
    } catch (caughtError) {
      console.error(caughtError);
      return {
        ok: false,
        message: "Failed to save the quick unlock PIN.",
      };
    }
  }, [navigate, refreshPinState, sessionKey, toast]);

  const handleRemoveSecurePin = useCallback(() => {
    if (!hasWindow()) return;
    clearQuickUnlockPin(window.localStorage);
    refreshPinState();
    toast("Quick unlock PIN removed", "warning");
  }, [refreshPinState, toast]);

  const handleRemoveLegacyPin = useCallback(() => {
    if (!hasWindow()) return;
    removeStorageValue(window.localStorage, STORAGE_KEYS.pinHash);
    refreshPinState();
    toast("Legacy PIN removed", "info");
  }, [refreshPinState, toast]);

  const handleNavigate = (id: string) => {
    if (!isUnlocked) return;
    const nextPath = getPathForPanel(id as VaultPanel);
    if (nextPath) {
      navigate(nextPath);
    }
  };

  const handleGlobalSearch = (query: string) => {
    setGlobalSearch(query);
    if (query.trim() && isUnlocked) {
      navigate(ROUTE_PATHS.itemLibrary);
    }
  };

  const handleOpenAdd = (type: ItemType = "password") => {
    setItemModalInitialType(type);
    setEditItem(null);
    setItemModalOpen(true);
  };

  const handleOpenEdit = (item: VaultItem) => {
    setEditItem(item);
    setItemModalOpen(true);
  };

  const handleSaveItem = async (item: VaultItem) => {
    const draft = {
      type: item.type,
      site: item.site,
      username: item.username,
      password: item.password,
      url: item.url,
      notes: item.notes,
      favicon: item.favicon,
      strength: item.strength,
      account: item.account,
      issuer: item.issuer,
      secret: item.secret,
      title: item.title,
      preview: item.preview,
      updatedAt: item.updatedAt,
      cardholder: item.cardholder,
      number: item.number,
      expiry: item.expiry,
      cvv: item.cvv,
      brand: item.brand,
      sshName: item.sshName,
      sshUsername: item.sshUsername,
      sshHost: item.sshHost,
      sshPort: item.sshPort,
      sshPrivateKey: item.sshPrivateKey,
      sshPublicKey: item.sshPublicKey,
      sshPassphrase: item.sshPassphrase,
      sshFingerprint: item.sshFingerprint,
      identityLabel: item.identityLabel,
      fullName: item.fullName,
      email: item.email,
      phone: item.phone,
      company: item.company,
      jobTitle: item.jobTitle,
      address: item.address,
      city: item.city,
      region: item.region,
      postalCode: item.postalCode,
      country: item.country,
      documentId: item.documentId,
      apiName: item.apiName,
      apiProvider: item.apiProvider,
      apiKey: item.apiKey,
      apiSecret: item.apiSecret,
      apiScopes: item.apiScopes,
      apiExpiry: item.apiExpiry,
      wifiName: item.wifiName,
      ssid: item.ssid,
      wifiPassword: item.wifiPassword,
      wifiSecurity: item.wifiSecurity,
      wifiNotes: item.wifiNotes,
      recoveryName: item.recoveryName,
      recoveryService: item.recoveryService,
      recoveryAccount: item.recoveryAccount,
      recoveryCodes: item.recoveryCodes,
      recoveryNotes: item.recoveryNotes,
      softwareName: item.softwareName,
      softwareVendor: item.softwareVendor,
      licenseKey: item.licenseKey,
      licenseEmail: item.licenseEmail,
      licenseSeats: item.licenseSeats,
      licenseExpiry: item.licenseExpiry,
      licenseNotes: item.licenseNotes,
      dbName: item.dbName,
      dbEngine: item.dbEngine,
      dbHost: item.dbHost,
      dbPort: item.dbPort,
      dbDatabase: item.dbDatabase,
      dbUsername: item.dbUsername,
      dbPassword: item.dbPassword,
      dbConnectionUrl: item.dbConnectionUrl,
      dbNotes: item.dbNotes,
    };
    const itemName = item.site
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
      ?? "Item";

    try {
      if (editItem) {
        await updateItem(editItem.id, draft);
        logActivity("edit", "Item edited", `${itemName} updated`, "info");
        toast(`"${itemName}" updated`, "success");
      } else {
        await createItem(draft);
        logActivity("add", "Item added", `${itemName} created`, "info");
        toast(`"${itemName}" added to vault`, "success");
      }
    } catch (error) {
      console.error(error);
      toast("Failed to save item", "error");
    }
  };

  const handleDeleteRequest = (id: number, type: string, name: string) => {
    setDeleteTarget({ id, type, name });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      await removeItem(deleteTarget.id);
      logActivity("delete", "Item deleted", `${deleteTarget.name} removed`, "destructive");
      toast(`"${deleteTarget.name}" deleted`, "warning");
    } catch (error) {
      console.error(error);
      toast("Failed to delete item", "error");
    }

    setDeleteTarget(null);
  };

  const exportVault = useCallback(() => {
    if (!hasWindow()) return;

    try {
      const data = createEncryptedBackupFile(window.localStorage);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${EXPORT_FILE_PREFIX}-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      logActivity("export", "Vault exported", `Encrypted backup ready (${localItems.length} items)`, "warning");
      toast(`Encrypted vault backup exported (${localItems.length} items)`, "success");
    } catch (caughtError) {
      console.error(caughtError);
      toast("Failed to export encrypted vault", "error");
    }
  }, [localItems, logActivity, toast]);

  const importVault = useCallback(async (file: File): Promise<VaultImportResult> => {
    if (!hasWindow()) {
      return { ok: false, message: "Browser crypto is unavailable." };
    }

    try {
      const raw = await file.text();
      const parsed = await parseImportedVaultFile(raw);

      if (parsed.kind === "encrypted") {
        replaceEncryptedBackup(window.localStorage, parsed.backup);
        clearLegacyPlaintextVault(window.localStorage);
        removeStorageValue(window.localStorage, STORAGE_KEYS.pinHash);
        clearVaultSession(window.sessionStorage);
        setSessionKeyState(null);
        setVaultConfigured(true);
        refreshPinState();
        setIsSessionReady(true);
        navigate(ROUTE_PATHS.unlockVault, { replace: true });
        toast("Encrypted backup restored. Unlock it with the backup master password.", "success");
        return {
          ok: true,
          message: "Encrypted backup restored.",
        };
      }

      if (parsed.data.items.length === 0) {
        return {
          ok: false,
          message: "No vault items found in the selected file.",
        };
      }

      const importedItems = parsed.data.items.map((item) => ({
        ...item,
        id: generateVaultId(),
      }));

      await replaceVault({
        items: [...localItems, ...importedItems],
        activities,
      });

      logActivity("import", "Vault imported", `${importedItems.length} legacy item${importedItems.length === 1 ? "" : "s"} restored`, "info");
      toast(`Imported ${importedItems.length} item${importedItems.length === 1 ? "" : "s"} successfully`, "success");

      return {
        ok: true,
        message: `Imported ${importedItems.length} item${importedItems.length === 1 ? "" : "s"}.`,
      };
    } catch (caughtError) {
      console.error(caughtError);
      toast("Failed to import vault file", "error");
      return {
        ok: false,
        message: "Failed to parse the selected vault file.",
      };
    }
  }, [activities, localItems, logActivity, navigate, refreshPinState, replaceVault, toast]);

  const lockedRedirectPath = emailVerificationTokenFromUrl
    ? `${ROUTE_PATHS.unlockVault}?verify_email_token=${encodeURIComponent(emailVerificationTokenFromUrl)}`
    : getDefaultVaultPath(false, hasPin);
  const renderSecuritySettingsSurface = (surface: SettingsSurface) => (
    <SecuritySettings
      surface={surface}
      onExportVault={exportVault}
      onImportVault={importVault}
      onResetLocalStorage={handleResetLocalStorage}
      pinState={hasPin ? "active" : hasLegacyPinState ? "legacy" : "inactive"}
      onSetupPin={() => navigate(`${ROUTE_PATHS.pinUnlock}?mode=setup`)}
      onRemovePin={hasPin ? handleRemoveSecurePin : undefined}
      onRemoveLegacyPin={hasLegacyPinState ? handleRemoveLegacyPin : undefined}
      theme={theme}
      onToggleTheme={toggleTheme}
      autoLockDurationSeconds={autoLockDurationSeconds}
      onAutoLockDurationChange={handleAutoLockDurationChange}
      accountSession={accountSession}
      accountSessionLoading={accountSessionLoading}
      deviceSessionState={deviceSessionState}
      deviceSessionLoading={deviceSessionLoading}
      emailVerificationStatus={emailVerificationStatus}
      emailVerificationLoading={emailVerificationLoading}
      recoveryStatus={recoveryStatus}
      recoveryStatusLoading={recoveryStatusLoading}
      syncProfile={syncProfile}
      syncStatusSummary={syncStatusSummary}
      syncProfileLoading={syncProfileLoading}
      autoSyncEnabled={autoSyncEnabled}
      autoSyncRuntime={autoSyncRuntime}
      onCreateAccount={handleCreateAccount}
      onLoginAccount={handleLoginAccount}
      onLogoutAccount={handleLogoutAccount}
      onRefreshDeviceSessions={handleRefreshDeviceSessions}
      onRevokeAccountSession={handleRevokeAccountSession}
      onRevokeAllAccountSessions={handleRevokeAllAccountSessions}
      onSetDeviceTrusted={handleSetDeviceTrusted}
      onChangeAccountPassword={handleChangeAccountPassword}
      onSendEmailVerification={handleSendEmailVerification}
      onConfirmEmailVerification={handleConfirmEmailVerification}
      onSetupRecoveryKey={handleSetupRecoveryKey}
      onSetAutoSyncEnabled={handleSetAutoSyncEnabled}
      onSaveSyncProfile={handleSaveSyncProfile}
      onLoadSyncProfileForEdit={handleLoadSyncProfileForEdit}
      onDeleteSyncProfile={handleDeleteSyncProfile}
      onTestSyncProfileConnection={handleTestSyncProfileConnection}
      onMigrateSyncProfile={handleMigrateSyncProfile}
      onPushTursoSync={handlePushTursoSync}
      onPullTursoSync={handlePullTursoSync}
      onPushD1BridgeSync={handlePushD1BridgeSync}
      onPullD1BridgeSync={handlePullD1BridgeSync}
      onPushD1DirectSync={handlePushD1DirectSync}
      onPullD1DirectSync={handlePullD1DirectSync}
      onResolveSyncConflict={handleResolveSyncConflict}
    />
  );

  if (!isSessionReady || (isUnlocked && itemsPending)) {
    return (
      <section className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-xs font-mono tracking-[0.3em] uppercase text-amber-500">Ciphora</p>
          <p className="text-xs font-mono text-muted-foreground">{t("common.loadingVault")}</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <Routes>
        <Route
          path={ROUTE_PATHS.landing}
          element={(
            <RouteSuspense>
              <LandingPage onGetStarted={handleGetStarted} />
            </RouteSuspense>
          )}
        />
        <Route
          path={ROUTE_PATHS.about}
          element={(
            <RouteSuspense>
              <PublicInfoPage page="about" onOpenVault={handleGetStarted} />
            </RouteSuspense>
          )}
        />
        <Route
          path={ROUTE_PATHS.contact}
          element={(
            <RouteSuspense>
              <PublicInfoPage page="contact" onOpenVault={handleGetStarted} />
            </RouteSuspense>
          )}
        />
        <Route
          path={ROUTE_PATHS.terms}
          element={(
            <RouteSuspense>
              <PublicInfoPage page="terms" onOpenVault={handleGetStarted} />
            </RouteSuspense>
          )}
        />
        <Route
          path={ROUTE_PATHS.privacy}
          element={(
            <RouteSuspense>
              <PublicInfoPage page="privacy" onOpenVault={handleGetStarted} />
            </RouteSuspense>
          )}
        />

        <Route
          path={ROUTE_PATHS.vaultRoot}
          element={(
            <VaultShell
              onLock={handleLock}
              onAddItem={handleOpenAdd}
              onSearch={handleGlobalSearch}
              searchValue={globalSearch}
              theme={theme}
              onToggleTheme={toggleTheme}
              onExportVault={exportVault}
              autoLockSeconds={autoLockSeconds}
              autoLockDurationSeconds={autoLockDurationSeconds}
            />
          )}
        >
          <Route index element={<Navigate to={getDefaultVaultPath(isUnlocked, hasPin)} replace />} />
          <Route
            path="unlock"
            element={isUnlocked
              ? <Navigate to={emailVerificationTokenFromUrl ? emailVerificationSettingsPath : ROUTE_PATHS.vaultDashboard} replace />
              : (
                <UnlockVault
                  mode={vaultConfigured ? "unlock" : "setup"}
                  onSubmit={handleUnlockSubmit}
                  onRestoreBackup={!vaultConfigured ? handlePreUnlockBackupRestore : undefined}
                  onRequestAccountRecoveryEmail={!vaultConfigured ? handleRequestRecoveryResetEmail : undefined}
                  onResetAccountWithRecoveryKey={!vaultConfigured ? handleRecoveryReset : undefined}
                  onRestoreFromAccount={!vaultConfigured ? handleRestoreFromAccount : undefined}
                  onSwitchToPin={hasPin ? (() => navigate(ROUTE_PATHS.pinUnlock)) : undefined}
                />
              )}
          />
          <Route
            path="pin"
            element={pinSetupRequested && isUnlocked
              ? (
                <PinUnlock
                  mode="setup"
                  onSetupPin={handlePinSetup}
                  onUseMasterPassword={() => navigate(ROUTE_PATHS.preferencesSettings, { replace: true })}
                  onResetPin={hasPin ? handleRemoveSecurePin : undefined}
                />
              )
              : isUnlocked
                ? <Navigate to={ROUTE_PATHS.vaultDashboard} replace />
                : hasPin
                  ? (
                    <PinUnlock
                      mode="enter"
                      onUnlockPin={handlePinUnlock}
                      onUseMasterPassword={() => navigate(ROUTE_PATHS.unlockVault, { replace: true })}
                      onResetPin={handleRemoveSecurePin}
                    />
                  )
                  : <Navigate to={ROUTE_PATHS.unlockVault} replace />}
          />
          <Route
            path="dashboard"
            element={isUnlocked
              ? (
                <VaultDashboard
                  onNavigate={handleNavigate}
                  onLock={handleLock}
                  onAddItem={handleOpenAdd}
                  passwords={passwords}
                  totps={totps}
                  notes={notes}
                  cards={cards}
                  sshKeys={sshKeys}
                  identities={identities}
                  apiKeys={apiKeys}
                  wifiNetworks={wifiNetworks}
                  recoveryCodes={recoveryCodes}
                  softwareLicenses={softwareLicenses}
                  databaseCredentials={databaseCredentials}
                  activities={activities}
                  autoLockSeconds={autoLockSeconds}
                  autoLockDurationSeconds={autoLockDurationSeconds}
                  onNavigateSettings={() => handleNavigate("security-settings")}
                  onExportVault={exportVault}
                />
              )
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="items"
            element={isUnlocked
              ? (
                <ItemLibrary
                  onNavigate={handleNavigate}
                  passwords={passwords}
                  totps={totps}
                  notes={notes}
                  cards={cards}
                  sshKeys={sshKeys}
                  identities={identities}
                  apiKeys={apiKeys}
                  wifiNetworks={wifiNetworks}
                  recoveryCodes={recoveryCodes}
                  softwareLicenses={softwareLicenses}
                  databaseCredentials={databaseCredentials}
                  totpStates={totpStates}
                  onAddItem={handleOpenAdd}
                  onEditItem={handleOpenEdit}
                  onDeleteItem={handleDeleteRequest}
                  autoLockSeconds={autoLockDurationSeconds === null ? null : autoLockSeconds}
                  externalSearch={globalSearch}
                  onClearExternalSearch={() => setGlobalSearch("")}
                />
              )
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="generator"
            element={isUnlocked
              ? (
                <GeneratorTools
                  passwords={passwords}
                  totps={totps}
                  notes={notes}
                  cards={cards}
                  sshKeys={sshKeys}
                  identities={identities}
                  apiKeys={apiKeys}
                  wifiNetworks={wifiNetworks}
                  recoveryCodes={recoveryCodes}
                  softwareLicenses={softwareLicenses}
                  databaseCredentials={databaseCredentials}
                  totpStates={totpStates}
                  onEditItem={handleOpenEdit}
                  onDeleteItem={handleDeleteRequest}
                  onExportVault={exportVault}
                />
              )
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="security/audit"
            element={isUnlocked
              ? (
                <SecurityAudit
                  passwords={passwords}
                  cards={cards}
                  recoveryCodes={recoveryCodes}
                  softwareLicenses={softwareLicenses}
                  databaseCredentials={databaseCredentials}
                  onEditItem={handleOpenEdit}
                  onDeleteItem={handleDeleteRequest}
                  onNavigate={handleNavigate}
                />
              )
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="settings"
            element={isUnlocked
              ? renderSecuritySettingsSurface("settings")
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="account"
            element={isUnlocked
              ? renderSecuritySettingsSurface("account")
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="security"
            element={isUnlocked
              ? renderSecuritySettingsSurface("security")
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="data"
            element={isUnlocked
              ? renderSecuritySettingsSurface("data")
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="preferences"
            element={isUnlocked
              ? renderSecuritySettingsSurface("preferences")
              : <Navigate to={lockedRedirectPath} replace />}
          />
          <Route
            path="sync"
            element={isUnlocked
              ? renderSecuritySettingsSurface("sync")
              : <Navigate to={lockedRedirectPath} replace />}
          />
        </Route>

        <Route path="*" element={<Navigate to={ROUTE_PATHS.landing} replace />} />
      </Routes>

      <ItemModal
        open={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        onSave={handleSaveItem}
        editItem={editItem}
        initialType={itemModalInitialType}
      />
      <DeleteConfirm
        open={!!deleteTarget}
        itemName={deleteTarget?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

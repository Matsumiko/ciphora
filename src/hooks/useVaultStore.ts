import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "../lib/app-config";
import {
  createEmptyVaultData,
  createVaultActivity,
  generateVaultId,
  loadVaultData,
  saveVaultData,
  type VaultActivity,
  type VaultData,
  type VaultDeletedRecord,
  type VaultSyncState,
} from "../lib/vault-storage";
import type { VaultItem } from "../sections/ItemModal";

export interface TotpState {
  secondsLeft: number;
  code: string;
  error?: string;
}

function hasWindow() {
  return typeof window !== "undefined";
}

function isVaultType(value: unknown): value is VaultItem["type"] {
  return (
    value === "password"
    || value === "totp"
    || value === "note"
    || value === "card"
    || value === "ssh"
    || value === "identity"
    || value === "apiKey"
    || value === "wifi"
    || value === "recoveryCode"
    || value === "softwareLicense"
    || value === "databaseCredential"
  );
}

function sanitizeVaultItem(item: Partial<VaultItem>): VaultItem {
  return {
    id: typeof item.id === "number" ? item.id : generateVaultId(),
    type: isVaultType(item.type) ? item.type : "note",
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
    modifiedAt: item.modifiedAt,
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
}

function normalizeVaultData(data?: Partial<VaultData>): VaultData {
  const base = createEmptyVaultData(data);
  return {
    ...base,
    items: base.items.map(sanitizeVaultItem),
  };
}

function getVaultRecordId(id: number) {
  return `item:${id}`;
}

function nowIso() {
  return new Date().toISOString();
}

function applyMutationMetadata(item: VaultItem, timestamp: string): VaultItem {
  return {
    ...item,
    modifiedAt: timestamp,
    updatedAt: item.type === "note" || item.type === "ssh" || item.type === "identity" || item.type === "apiKey" || item.type === "wifi" || item.type === "recoveryCode" || item.type === "softwareLicense" || item.type === "databaseCredential" ? "just now" : item.updatedAt,
  };
}

function mergePendingDelete(entries: VaultDeletedRecord[], nextEntry: VaultDeletedRecord) {
  return [
    nextEntry,
    ...entries.filter((entry) => entry.recordId !== nextEntry.recordId),
  ].slice(0, 512);
}

function removePendingDelete(entries: VaultDeletedRecord[], recordId: string) {
  return entries.filter((entry) => entry.recordId !== recordId);
}

export function useVaultStore(sessionKey: string | null) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [activities, setActivities] = useState<VaultActivity[]>([]);
  const [vaultSyncState, setVaultSyncState] = useState<VaultSyncState>(() => createEmptyVaultData().syncState);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const syncState = useCallback((data: VaultData) => {
    const normalized = normalizeVaultData(data);
    setItems(normalized.items);
    setActivities(normalized.activities);
    setVaultSyncState(normalized.syncState);
    return normalized;
  }, []);

  const refreshVault = useCallback(async () => {
    if (!hasWindow() || !sessionKey) {
      setItems([]);
      setActivities([]);
      setVaultSyncState(createEmptyVaultData().syncState);
      setError(null);
      setIsPending(false);
      return null;
    }

    setIsPending(true);
    try {
      const data = normalizeVaultData(await loadVaultData(window.localStorage, sessionKey));
      syncState(data);
      setError(null);
      return data;
    } catch (caughtError) {
      const nextError = caughtError instanceof Error ? caughtError : new Error("Failed to load encrypted vault.");
      setItems([]);
      setActivities([]);
      setVaultSyncState(createEmptyVaultData().syncState);
      setError(nextError);
      return null;
    } finally {
      setIsPending(false);
    }
  }, [sessionKey, syncState]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const data = await refreshVault();
      if (cancelled || data) return;
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshVault]);

  useEffect(() => {
    if (!hasWindow() || !sessionKey) return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === STORAGE_KEYS.vaultEnvelope.current
        || event.key === STORAGE_KEYS.vaultAuth.current
        || event.key === STORAGE_KEYS.sessionKey.current
      ) {
        void refreshVault();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [refreshVault, sessionKey]);

  const mutateVault = useCallback(async (mutate: (current: VaultData) => VaultData) => {
    if (!hasWindow() || !sessionKey) {
      throw new Error("Vault is locked.");
    }

    const current = normalizeVaultData(await loadVaultData(window.localStorage, sessionKey));
    const next = normalizeVaultData(mutate(current));
    await saveVaultData(window.localStorage, sessionKey, next);
    syncState(next);
    setError(null);
    return next;
  }, [sessionKey, syncState]);

  const createItem = useCallback(async (draft: Omit<VaultItem, "id"> | VaultItem) => {
    const timestamp = nowIso();
    const nextItem = applyMutationMetadata(sanitizeVaultItem({
      ...draft,
      id: typeof draft.id === "number" ? draft.id : generateVaultId(),
    }), timestamp);

    await mutateVault((current) => ({
      ...current,
      items: [...current.items, nextItem],
      syncState: {
        ...current.syncState,
        pendingLocalDeletes: removePendingDelete(current.syncState.pendingLocalDeletes, getVaultRecordId(nextItem.id)),
      },
    }));

    return nextItem;
  }, [mutateVault]);

  const updateItem = useCallback(async (id: number, draft: Partial<VaultItem>) => {
    let found = false;
    const timestamp = nowIso();

    await mutateVault((current) => {
      const nextItems = current.items.map((item) => {
        if (item.id !== id) return item;
        found = true;
        return applyMutationMetadata(sanitizeVaultItem({ ...item, ...draft, id }), timestamp);
      });

      return {
        ...current,
        items: nextItems,
        syncState: {
          ...current.syncState,
          pendingLocalDeletes: removePendingDelete(current.syncState.pendingLocalDeletes, getVaultRecordId(id)),
        },
      };
    });

    if (!found) {
      throw new Error(`Vault item ${id} was not found.`);
    }
  }, [mutateVault]);

  const removeItem = useCallback(async (id: number) => {
    let removed = false;
    const timestamp = nowIso();

    await mutateVault((current) => {
      let deletedRecordId: string | null = null;
      const nextItems = current.items.filter((item) => {
        if (item.id !== id) return true;
        removed = true;
        deletedRecordId = getVaultRecordId(item.id);
        return false;
      });

      return {
        ...current,
        items: nextItems,
        syncState: deletedRecordId
          ? {
            ...current.syncState,
            pendingLocalDeletes: mergePendingDelete(current.syncState.pendingLocalDeletes, {
              recordId: deletedRecordId,
              deletedAt: timestamp,
            }),
          }
          : current.syncState,
      };
    });

    if (!removed) {
      throw new Error(`Vault item ${id} was not found.`);
    }
  }, [mutateVault]);

  const logActivity = useCallback(async (activity: Omit<VaultActivity, "id" | "createdAt">) => {
    const nextActivity = createVaultActivity(activity);
    await mutateVault((current) => ({
      ...current,
      activities: [nextActivity, ...current.activities].slice(0, 100),
    }));
    return nextActivity;
  }, [mutateVault]);

  const replaceVault = useCallback(async (next: Partial<VaultData>) => {
    let normalized: VaultData | null = null;
    await mutateVault((current) => {
      normalized = normalizeVaultData({
        ...current,
        ...next,
        items: next.items ?? current.items,
        activities: next.activities ?? current.activities,
        syncState: next.syncState ?? current.syncState,
        createdAt: next.createdAt ?? current.createdAt,
      });
      return normalized;
    });
    if (!normalized) {
      throw new Error("Failed to replace vault state.");
    }
    return normalized;
  }, [mutateVault]);

  return {
    items,
    activities,
    syncState: vaultSyncState,
    isPending,
    error,
    refreshVault,
    createItem,
    updateItem,
    removeItem,
    logActivity,
    replaceVault,
  };
}

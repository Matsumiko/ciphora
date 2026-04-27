export const APP_NAME = "Ciphora";
export const APP_NAME_UPPER = "CIPHORA";
export const APP_RELEASE_VERSION = "1.3.3";
export const APP_VERSION = `v${APP_RELEASE_VERSION}`;
export const APP_ANDROID_VERSION_CODE = 1003003;
export const APP_HOSTNAME = "app.ciphora.local";
export const APP_PUBLIC_URL = "https://app.ciphora.indevs.in";
export const APP_UPDATE_MANIFEST_URL = `${APP_PUBLIC_URL}/releases/latest.json`;
export const APP_DESCRIPTION = "Ciphora is an encrypted local-first vault for passwords, TOTP codes, secure notes, recovery data, and user-owned sync.";
export const BRAND_MARK_SRC = "/brand/ciphora-mark.svg";
export const BRAND_WORDMARK_SRC = "/brand/ciphora-wordmark.svg";
export const BRAND_WORDMARK_LIGHT_SRC = "/brand/ciphora-wordmark-light.svg";
export const BRAND_OG_SRC = "/brand/ciphora-og.svg";
export const EXPORT_VERSION = "ciphora-backup-v2";
export const EXPORT_FILE_PREFIX = "ciphora-export";

export interface StorageKeySet {
  current: string;
  legacy?: string;
}

export const STORAGE_KEYS = {
  theme: {
    current: "ciphora_theme",
    legacy: "cipher_ledger_theme",
  },
  language: {
    current: "ciphora_language",
  },
  autoLockSeconds: {
    current: "ciphora_auto_lock_seconds",
  },
  autoSyncEnabled: {
    current: "ciphora_auto_sync_enabled_v1",
  },
  pinHash: {
    current: "ciphora_pin_hash",
    legacy: "cipher_ledger_pin_hash",
  },
  pinWrap: {
    current: "ciphora_pin_wrap_v1",
  },
  sessionUnlocked: {
    current: "ciphora_session_unlocked",
  },
  sessionKey: {
    current: "ciphora_session_key_v1",
  },
  vaultAuth: {
    current: "ciphora_vault_auth_v1",
  },
  vaultEnvelope: {
    current: "ciphora_vault_envelope_v1",
  },
  vaultItems: {
    current: "ciphora_vault_items_v1",
    legacy: "cipher_ledger_vault_items_v1",
  },
  activityLog: {
    current: "ciphora_activity_log_v1",
    legacy: "cipher_ledger_activity_log_v1",
  },
  accountDeviceId: {
    current: "ciphora_account_device_id_v1",
  },
  appUpdateLastCheckAt: {
    current: "ciphora_update_last_check_at_v1",
  },
  appUpdateSnoozedUntil: {
    current: "ciphora_update_snoozed_until_v1",
  },
} satisfies Record<string, StorageKeySet>;

export function readStorageValue(storage: Storage, keySet: StorageKeySet): string | null {
  const currentValue = storage.getItem(keySet.current);
  if (currentValue !== null) return currentValue;

  if (!keySet.legacy) return null;

  const legacyValue = storage.getItem(keySet.legacy);
  if (legacyValue !== null) {
    storage.setItem(keySet.current, legacyValue);
  }
  return legacyValue;
}

export function writeStorageValue(storage: Storage, keySet: StorageKeySet, value: string) {
  storage.setItem(keySet.current, value);
  if (keySet.legacy) {
    storage.removeItem(keySet.legacy);
  }
}

export function removeStorageValue(storage: Storage, keySet: StorageKeySet) {
  storage.removeItem(keySet.current);
  if (keySet.legacy) {
    storage.removeItem(keySet.legacy);
  }
}

export function resetCiphoraBrowserStorage(storage: Storage) {
  const keysToRemove = new Set<string>();

  for (const keySet of Object.values(STORAGE_KEYS)) {
    keysToRemove.add(keySet.current);
    if (keySet.legacy) {
      keysToRemove.add(keySet.legacy);
    }
  }

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith("ciphora_") || key.startsWith("cipher_ledger_")) {
      keysToRemove.add(key);
    }
  }

  for (const key of keysToRemove) {
    storage.removeItem(key);
  }
}

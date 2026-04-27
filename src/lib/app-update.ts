import {
  APP_ANDROID_VERSION_CODE,
  APP_RELEASE_VERSION,
  APP_UPDATE_MANIFEST_URL,
  STORAGE_KEYS,
  readStorageValue,
  writeStorageValue,
} from "./app-config";

export interface AndroidReleaseInfo {
  apkUrl: string;
  aabUrl?: string | null;
  sha256Apk?: string | null;
  sha256Aab?: string | null;
}

export interface AppReleaseManifest {
  schema: "ciphora-release-v1";
  channel: "stable";
  version: string;
  versionCode: number;
  tag: string;
  releasedAt: string;
  mandatory?: boolean;
  minimumSupportedVersion?: string;
  title?: string;
  notes?: string[];
  platforms: {
    android?: AndroidReleaseInfo;
  };
}

export interface AppUpdateAvailable {
  manifest: AppReleaseManifest;
  android: AndroidReleaseInfo;
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

type CapacitorRuntime = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
};

function getCapacitorRuntime(): CapacitorRuntime | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
  return candidate && typeof candidate === "object" ? candidate : null;
}

export function isAndroidNativeRuntime() {
  if (typeof window === "undefined") return false;
  const capacitor = getCapacitorRuntime();
  if (!capacitor) return false;

  const platform = typeof capacitor.getPlatform === "function" ? capacitor.getPlatform() : "";
  const native = typeof capacitor.isNativePlatform === "function" ? capacitor.isNativePlatform() : false;

  return platform === "android" && (
    native
    || window.location.protocol === "capacitor:"
    || window.location.hostname === "localhost"
    || window.location.hostname === "tauri.localhost"
  );
}

export function compareSemver(left: string, right: string) {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

function parseSemver(value: string): [number, number, number] {
  const normalized = value.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(normalized);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isValidManifest(input: unknown): input is AppReleaseManifest {
  const value = input as Partial<AppReleaseManifest> | null;
  return Boolean(value)
    && value?.schema === "ciphora-release-v1"
    && value.channel === "stable"
    && typeof value.version === "string"
    && Number.isFinite(value.versionCode)
    && typeof value.tag === "string"
    && typeof value.releasedAt === "string"
    && typeof value.platforms === "object"
    && typeof value.platforms?.android?.apkUrl === "string"
    && value.platforms.android.apkUrl.startsWith("https://");
}

export function shouldSkipAppUpdateCheck(storage: Storage, now = Date.now()) {
  const lastCheck = Number(readStorageValue(storage, STORAGE_KEYS.appUpdateLastCheckAt));
  if (Number.isFinite(lastCheck) && now - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
    return true;
  }

  const snoozedUntil = Number(readStorageValue(storage, STORAGE_KEYS.appUpdateSnoozedUntil));
  return Number.isFinite(snoozedUntil) && snoozedUntil > now;
}

export function markAppUpdateChecked(storage: Storage, now = Date.now()) {
  writeStorageValue(storage, STORAGE_KEYS.appUpdateLastCheckAt, String(now));
}

export function snoozeAppUpdatePrompt(storage: Storage, now = Date.now()) {
  writeStorageValue(storage, STORAGE_KEYS.appUpdateSnoozedUntil, String(now + UPDATE_SNOOZE_MS));
}

export async function fetchLatestAppRelease(signal?: AbortSignal): Promise<AppReleaseManifest> {
  const response = await fetch(APP_UPDATE_MANIFEST_URL, {
    cache: "no-store",
    credentials: "omit",
    signal,
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Update manifest request failed: ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isValidManifest(payload)) {
    throw new Error("Update manifest is invalid.");
  }

  return payload;
}

export function getAvailableAndroidUpdate(manifest: AppReleaseManifest): AppUpdateAvailable | null {
  const android = manifest.platforms.android;
  if (!android) return null;

  if (manifest.versionCode <= APP_ANDROID_VERSION_CODE && compareSemver(manifest.version, APP_RELEASE_VERSION) <= 0) {
    return null;
  }

  return { manifest, android };
}


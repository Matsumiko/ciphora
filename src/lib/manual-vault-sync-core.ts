import { STORAGE_KEYS, readStorageValue, writeStorageValue } from "./app-config";
import type { VaultKnownRemoteRecord } from "./vault-storage";
import type { VaultItem } from "../sections/ItemModal";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const MANUAL_SYNC_RECORD_KIND = "vault_item";
export const MANUAL_SYNC_RECORD_PAYLOAD_VERSION = "ciphora-sync-record-v1";

export interface ManualSyncRemoteRecord {
  recordId: string;
  algorithm: string;
  iv: string;
  ciphertext: string;
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface EncryptedVaultRecordPayload {
  kind: typeof MANUAL_SYNC_RECORD_KIND;
  version: typeof MANUAL_SYNC_RECORD_PAYLOAD_VERSION;
  item: VaultItem;
}

function hasWindow() {
  return typeof window !== "undefined";
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Browser crypto is unavailable.");
  }
  return globalThis.crypto;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function importManualSyncVaultKey(rawKeyBase64: string, usages: KeyUsage[]) {
  return requireCrypto().subtle.importKey(
    "raw",
    base64UrlToBytes(rawKeyBase64),
    "AES-GCM",
    false,
    usages,
  );
}

export async function sha256Base64Url(value: string) {
  const digest = await requireCrypto().subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function normalizeVaultItem(item: VaultItem): VaultItem {
  return {
    id: item.id,
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
    emailAccountName: item.emailAccountName,
    emailAddress: item.emailAddress,
    emailProvider: item.emailProvider,
    emailUsername: item.emailUsername,
    emailPassword: item.emailPassword,
    emailRecoveryEmail: item.emailRecoveryEmail,
    emailRecoveryPhone: item.emailRecoveryPhone,
    emailImapHost: item.emailImapHost,
    emailSmtpHost: item.emailSmtpHost,
    emailNotes: item.emailNotes,
    bankLabel: item.bankLabel,
    bankName: item.bankName,
    bankAccountHolder: item.bankAccountHolder,
    bankAccountNumber: item.bankAccountNumber,
    bankRoutingNumber: item.bankRoutingNumber,
    bankSwift: item.bankSwift,
    bankIban: item.bankIban,
    bankBranch: item.bankBranch,
    bankPin: item.bankPin,
    bankLoginUrl: item.bankLoginUrl,
    bankNotes: item.bankNotes,
    cryptoWalletName: item.cryptoWalletName,
    cryptoNetwork: item.cryptoNetwork,
    cryptoPublicAddress: item.cryptoPublicAddress,
    cryptoSeedPhrase: item.cryptoSeedPhrase,
    cryptoPrivateKey: item.cryptoPrivateKey,
    cryptoDerivationPath: item.cryptoDerivationPath,
    cryptoHardwareWallet: item.cryptoHardwareWallet,
    cryptoNotes: item.cryptoNotes,
    domainName: item.domainName,
    domainRegistrar: item.domainRegistrar,
    domainDnsProvider: item.domainDnsProvider,
    domainNameservers: item.domainNameservers,
    domainExpires: item.domainExpires,
    domainRenewalEmail: item.domainRenewalEmail,
    domainEppCode: item.domainEppCode,
    domainNotes: item.domainNotes,
    serverName: item.serverName,
    serverProvider: item.serverProvider,
    serverHost: item.serverHost,
    serverIp: item.serverIp,
    serverUsername: item.serverUsername,
    serverPassword: item.serverPassword,
    serverPanelUrl: item.serverPanelUrl,
    serverSshReference: item.serverSshReference,
    serverExpires: item.serverExpires,
    serverNotes: item.serverNotes,
  };
}

export function getManualSyncRecordId(item: VaultItem) {
  return `item:${item.id}`;
}

export function getManualSyncRecordIdFromItemId(id: number) {
  return `item:${id}`;
}

export function getManualSyncDeviceId() {
  if (!hasWindow()) {
    return "ciphora-sync-runtime";
  }

  const existing = readStorageValue(window.localStorage, STORAGE_KEYS.accountDeviceId);
  if (existing && /^[A-Za-z0-9_-]{16,96}$/.test(existing)) {
    return existing;
  }

  const next = crypto.randomUUID();
  writeStorageValue(window.localStorage, STORAGE_KEYS.accountDeviceId, next);
  return next;
}

export function parseSyncTimestamp(value?: string | null) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getItemModifiedAt(item: VaultItem, fallback?: string | null) {
  if (typeof item.modifiedAt === "string" && item.modifiedAt.length > 0) {
    return item.modifiedAt;
  }
  if (typeof item.updatedAt === "string" && item.updatedAt.includes("T")) {
    return item.updatedAt;
  }
  return fallback ?? "";
}

export function getItemModifiedMs(item: VaultItem, fallback?: string | null) {
  return parseSyncTimestamp(getItemModifiedAt(item, fallback));
}

export function toKnownRemoteRecord(
  record: Pick<ManualSyncRemoteRecord, "recordId" | "version" | "updatedAt" | "deletedAt" | "contentHash">,
): VaultKnownRemoteRecord {
  return {
    recordId: record.recordId,
    version: record.version,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    contentHash: record.contentHash,
  };
}

export async function encryptVaultItemRecord(rootKeyBase64: string, item: VaultItem) {
  const normalizedItem = normalizeVaultItem(item);
  const payload: EncryptedVaultRecordPayload = {
    kind: MANUAL_SYNC_RECORD_KIND,
    version: MANUAL_SYNC_RECORD_PAYLOAD_VERSION,
    item: normalizedItem,
  };
  const plaintext = JSON.stringify(payload);
  const ivBytes = new Uint8Array(12);
  requireCrypto().getRandomValues(ivBytes);
  const key = await importManualSyncVaultKey(rootKeyBase64, ["encrypt"]);
  const ciphertext = await requireCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
    },
    key,
    textEncoder.encode(plaintext),
  );

  return {
    recordId: getManualSyncRecordId(normalizedItem),
    algorithm: "AES-GCM-256",
    iv: bytesToBase64Url(ivBytes),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    contentHash: await sha256Base64Url(plaintext),
  };
}

export async function decryptVaultItemRecord(rootKeyBase64: string, record: ManualSyncRemoteRecord) {
  const key = await importManualSyncVaultKey(rootKeyBase64, ["decrypt"]);
  const plaintext = await requireCrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(record.iv),
    },
    key,
    base64UrlToBytes(record.ciphertext),
  );
  const parsed = JSON.parse(textDecoder.decode(plaintext)) as Partial<EncryptedVaultRecordPayload>;
  const item = parsed.item;

  if (
    parsed.kind !== MANUAL_SYNC_RECORD_KIND
    || parsed.version !== MANUAL_SYNC_RECORD_PAYLOAD_VERSION
    || !item
    || typeof item !== "object"
    || typeof item.id !== "number"
    || getManualSyncRecordId(item as VaultItem) !== record.recordId
  ) {
    throw new Error(`Stored sync record ${record.recordId} is invalid.`);
  }

  const normalized = normalizeVaultItem(item as VaultItem);
  if (!normalized.modifiedAt) {
    normalized.modifiedAt = record.updatedAt;
  }
  return normalized;
}

export function chooseMergedItem(localItem: VaultItem, remoteItem: VaultItem, remoteRecord: ManualSyncRemoteRecord) {
  const localMs = getItemModifiedMs(localItem);
  const remoteMs = getItemModifiedMs(remoteItem, remoteRecord.updatedAt);

  if (remoteMs > localMs) return { item: remoteItem, winner: "remote" as const };
  if (localMs > remoteMs) return { item: localItem, winner: "local" as const };

  if (!localItem.modifiedAt && remoteItem.modifiedAt) {
    return { item: remoteItem, winner: "remote" as const };
  }

  return { item: localItem, winner: "local" as const };
}

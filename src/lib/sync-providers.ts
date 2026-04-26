export const DIRECT_SYNC_PROVIDER_TYPES = ["external_turso", "external_d1_direct"] as const;

export const BRIDGE_SYNC_PROVIDER_TYPES = [
  "external_d1_bridge",
  "external_tidb_bridge",
  "external_cockroach_bridge",
  "external_aiven_bridge",
  "external_supabase_bridge",
  "external_mongodb_bridge",
  "external_firestore_bridge",
] as const;

export const SYNC_PROVIDER_TYPES = [
  "external_turso",
  "external_d1_bridge",
  "external_d1_direct",
  "external_tidb_bridge",
  "external_cockroach_bridge",
  "external_aiven_bridge",
  "external_supabase_bridge",
  "external_mongodb_bridge",
  "external_firestore_bridge",
] as const;

export type DirectSyncProviderType = (typeof DIRECT_SYNC_PROVIDER_TYPES)[number];
export type BridgeSyncProviderType = (typeof BRIDGE_SYNC_PROVIDER_TYPES)[number];
export type SyncProviderType = (typeof SYNC_PROVIDER_TYPES)[number];

const SYNC_PROVIDER_TYPE_SET = new Set<string>(SYNC_PROVIDER_TYPES);
const BRIDGE_SYNC_PROVIDER_TYPE_SET = new Set<string>(BRIDGE_SYNC_PROVIDER_TYPES);

const PROVIDER_LABELS: Record<SyncProviderType, string> = {
  external_turso: "Turso",
  external_d1_bridge: "D1 Bridge",
  external_d1_direct: "D1 Direct",
  external_tidb_bridge: "TiDB Cloud Bridge",
  external_cockroach_bridge: "CockroachDB Bridge",
  external_aiven_bridge: "Aiven PostgreSQL Bridge",
  external_supabase_bridge: "Supabase Bridge",
  external_mongodb_bridge: "MongoDB Atlas Bridge",
  external_firestore_bridge: "Firebase Firestore Bridge",
};

const PROVIDER_HINTS: Record<SyncProviderType, string> = {
  external_turso: "turso",
  external_d1_bridge: "d1_bridge",
  external_d1_direct: "d1_direct",
  external_tidb_bridge: "tidb_bridge",
  external_cockroach_bridge: "cockroach_bridge",
  external_aiven_bridge: "aiven_postgresql_bridge",
  external_supabase_bridge: "supabase_bridge",
  external_mongodb_bridge: "mongodb_atlas_bridge",
  external_firestore_bridge: "firebase_firestore_bridge",
};

const PROVIDER_SHORT_CODES: Record<SyncProviderType, string> = {
  external_turso: "tr",
  external_d1_bridge: "d1b",
  external_d1_direct: "d1d",
  external_tidb_bridge: "tidb",
  external_cockroach_bridge: "crdb",
  external_aiven_bridge: "aivn",
  external_supabase_bridge: "supa",
  external_mongodb_bridge: "mongo",
  external_firestore_bridge: "fire",
};

export function isKnownSyncProvider(value: string): value is SyncProviderType {
  return SYNC_PROVIDER_TYPE_SET.has(value);
}

export function isBridgeSyncProvider(providerType: SyncProviderType): providerType is BridgeSyncProviderType {
  return BRIDGE_SYNC_PROVIDER_TYPE_SET.has(providerType);
}

export function getSyncProviderDisplayLabel(providerType: SyncProviderType) {
  return PROVIDER_LABELS[providerType];
}

export function getSyncProviderHint(providerType: SyncProviderType) {
  return PROVIDER_HINTS[providerType];
}

export function getSyncProviderShortCode(providerType: SyncProviderType) {
  return PROVIDER_SHORT_CODES[providerType];
}

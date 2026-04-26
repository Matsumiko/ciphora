# Ciphora Sync Conflict Journal And Incremental Sync Design

Date: 2026-04-25

## Current State

Ciphora sync is local-first and one-active-provider. The browser decrypts the active sync profile locally, then talks directly to the selected user-owned provider:

- Turso through `@libsql/client`.
- D1 Bridge through the user-owned Worker template.
- D1 Direct through Cloudflare's D1 REST query API as an advanced browser-side mode.

Already shipped behavior:

- Pull-if-stale-before-push.
- Delta-only writes using stable logical item hashes.
- Known-delete tombstones instead of blind remote deletion.
- `vault_record_versions` pruning to the newest 8 versions per record.
- Account-backed fresh-device restore for Turso, D1 Bridge, and D1 Direct sync profiles.
- Smart auto-sync for the active unlocked tab.
- Additive BYODB schema V2 tables: `sync_journal`, `sync_conflicts`, and `sync_device_cursors`.
- Metadata-only journal writes for Turso push/pull, D1 Bridge push, and D1 Direct push/pull paths.
- Unsafe same-record push conflicts are blocked and surfaced in `/vault/sync` Sync Status Center.
- Explicit conflict-resolution actions are shipped in `/vault/sync`: keep local, keep remote, keep both, and manual edit. Remote records are decrypted only in the browser with the active vault key. Turso and D1 Direct update provider-side resolved metadata directly; D1 Bridge uses the updated bridge template `resolvedConflicts` payload.

## Remaining Gap

The current sync state knows remote records, local pending deletes, unresolved conflict metadata, and resolved conflict decisions. Ciphora now exposes a first-pass resolution ceremony, but stateful provider QA across disposable Turso/D1 Bridge/D1 Direct targets is still needed before treating the flow as fully battle-tested.

`sync_cursors` exists in both BYODB schemas, but it is currently used as a push metadata marker rather than a full incremental transport contract.

## Design Goals

- Preserve the local-first model: local encrypted vault remains the user-facing source of truth until the user explicitly resolves conflicts.
- Store ciphertext and metadata only in BYODB providers. Never store plaintext item fields in Turso, D1, D1 Bridge, D1 Direct, or Ciphora internal DB.
- Keep one active sync provider per account profile.
- Make repeated pushes idempotent and bounded: no duplicate logical records, no unbounded version history, no unbounded journal growth.
- Make conflicts visible and recoverable, not silently overwritten.
- Keep schema changes additive and bridge endpoints backward-compatible.

## BYODB Schema V2

These tables are additive in `schema/turso/user_vault.sql`, `schema/d1/user_vault.sql`, and the D1 Bridge embedded schema.

### `sync_journal`

Tracks sync events as metadata, not plaintext vault content.

```sql
CREATE TABLE IF NOT EXISTS sync_journal (
  event_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  source_device_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete', 'pull', 'conflict', 'resolve')),
  base_version INTEGER,
  result_version INTEGER,
  base_content_hash TEXT,
  result_content_hash TEXT,
  remote_updated_at TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'skipped', 'conflict', 'resolved')),
  conflict_id TEXT,
  metadata_json TEXT
);
```

### `sync_conflicts`

Stores conflict metadata and encrypted snapshot references.

```sql
CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  local_content_hash TEXT NOT NULL,
  remote_content_hash TEXT NOT NULL,
  local_version INTEGER,
  remote_version INTEGER,
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT CHECK (resolution IN ('keep_local', 'keep_remote', 'keep_both', 'manual_edit'))
);
```

### `sync_device_cursors`

Allows per-device incremental pulls without treating one global cursor as truth for all clients.

```sql
CREATE TABLE IF NOT EXISTS sync_device_cursors (
  device_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  last_seen_remote_updated_at TEXT,
  last_seen_journal_created_at TEXT,
  last_seen_journal_event_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, provider_profile_id)
);
```

## Incremental Pull Contract

For Turso:

- Query `vault_records` where `updated_at > last_seen_remote_updated_at`.
- Query `vault_tombstones` where `deleted_at > last_seen_remote_updated_at`.
- Query `sync_journal` where `(created_at, event_id)` is greater than the device cursor.
- Cap each page with `LIMIT`, then continue until the server returns no next cursor.

For D1 Bridge:

- Add `GET /sync/pull?cursor=<encoded>&limit=<n>`.
- Return active records, tombstones, journal events, and `nextCursor`.
- Keep existing `GET /records` for older clients.

For D1 Direct:

- Query the same D1 user-vault schema through Cloudflare's D1 REST query API.
- Keep the same per-device cursor model, but treat browser/API/CORS availability as an operational prerequisite.
- Prefer D1 Bridge when the user needs narrower token isolation or a non-technical setup path.

Cursor values must be opaque JSON encoded and signed or validated by the bridge so malformed cursors cannot cause unbounded queries.

## Conflict Detection

Before pushing a local upsert:

1. Look up the known remote state from local `knownRemoteRecords`.
2. Pull remote changes first if the provider state is stale.
3. If the remote record hash differs from the last known hash and the local record has changed since that base, create a conflict instead of overwriting.
4. Keep the local item unchanged, preserve the remote encrypted record reference, and surface a conflict entry in Settings or a future conflict drawer.

Before pushing a delete:

1. Only tombstone records that are known to exist remotely.
2. If the remote hash changed after the local known base, mark a delete conflict instead of deleting immediately.
3. Let the user choose: delete remote, keep remote, or restore as duplicate.

## Conflict Resolution UX

Initial UI should be conservative:

- Settings Sync Status Center shows unresolved conflict count.
- Item detail can show "local version" and "remote version" metadata without decrypting remote into plaintext unless the user chooses to inspect.
- Resolutions: keep local, keep remote, keep both as duplicate, or manual edit.
- Every resolution creates a `sync_journal` event and sets the `sync_conflicts.resolved_at` field where the active provider supports that metadata write.

## Growth Control

- Keep the existing `vault_record_versions` cap of 8 per record.
- Cap resolved `sync_journal` rows by age and count, for example 90 days or 5,000 rows per provider profile.
- Keep unresolved conflicts until resolved, even if older than the journal retention window.
- Tombstones can be pruned only when all known active device cursors have observed them, or after a conservative TTL for devices that never come back.
- Provider cleanup must be user-visible and never run as hidden destructive maintenance.

## Safe Rollout

1. Add schema V2 as additive migrations for Turso and D1 Bridge. Shipped.
2. Start writing metadata-only journal events during existing sync paths without changing conflict behavior. Shipped for Turso push/pull, D1 Bridge push, and D1 Direct push/pull.
3. Add conflict detection and read-only conflict display. Shipped.
4. Update D1 Bridge template with backward-compatible `/sync/pull`.
5. Switch pull to cursor-based incremental transport while retaining full pull fallback.
6. Add explicit conflict resolution actions. Shipped.
7. Add journal/tombstone pruning after all above paths are verified.

## Residual Risks

- Device clocks can skew `updated_at`; cursor design should prefer `(server_created_at, event_id)` where the provider can generate server time.
- Browser-only sync means no background reconciliation happens when all devices are closed.
- BYODB provider limits vary; pagination and retention caps are mandatory before public launch.
- Multi-provider sync remains out of scope. Provider migration should continue using an explicit empty-target migration flow.
- D1 Direct adds browser-side Cloudflare-token exposure during unlocked sync runtime; keep D1 Bridge as the recommended D1 path for lower operational risk.

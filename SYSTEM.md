# Ciphora System Model

This document defines what Ciphora is, what data it handles, how it treats that
data, and which technologies are responsible for each part of the system.

Status: target system model with backend foundation, account API foundation,
frontend account onboarding, OPAQUE-backed signup/login for new accounts,
challenge-bound login proof for legacy account verifiers, logged-in password change, Recovery Key setup,
encrypted sync profile foundation, provider connection checks, hardened manual Turso
sync, hardened manual D1 Bridge sync, advanced D1 Direct sync, and account-backed Turso/D1 Bridge/D1 Direct restore
implemented. Brevo+Resend-backed email verification and email-token-gated Recovery
Key reset are now also implemented; some items still describe planned
incremental sync behavior that is not implemented yet.

---

## Product Model

Ciphora is a local-first password manager with optional user-owned database
sync.

Supported product modes:

```text
Local Only
  Vault stays encrypted in the browser.

Ciphora Account
  Ciphora manages login, devices, recovery wrappers, and encrypted sync profile.

Sync to My Turso
  User provides a Turso database and token.

Sync to My D1 Bridge
  User deploys a small bridge Worker bound to their D1 database.

Sync to My D1 Direct
  User provides a Cloudflare D1 REST endpoint or account/database descriptor and a scoped Cloudflare API token.
```

Ciphora is not designed to be a managed vault hosting service in v1. It should
not store user vault plaintext or user vault ciphertext in Ciphora-owned vault
storage. The user's own provider stores synced vault ciphertext.

Current implementation status:

- Browser-local encrypted vault is shipped.
- Cloudflare Pages Functions backend foundation is deployed.
- 10 internal D1 databases are provisioned and migrated.
- 1 internal Turso archive database is migrated.
- Backend account API foundation is deployed for signup, login metadata, login,
  session lookup, and logout. New accounts prefer OPAQUE-backed signup/login
  without storing a legacy verifier, while legacy account-password verifier
  records use a signed login challenge plus browser-derived HMAC proof instead
  of accepting only a reusable static verifier.
- Frontend Settings account UI is shipped for signup, login, current-session
  checks, logout, and logged-in account password change after local vault unlock.
- Logged-in account password change is shipped; the browser derives the current
  verifier, derives a new verifier, rewraps the active vault key with the new
  account password, and the backend revokes old password wrappers plus other
  active sessions.
- Settings Recovery Key setup is shipped for logged-in accounts; the browser
  generates the Recovery Key, derives both a recovery wrapper key and a
  recovery verifier locally, encrypts the active vault key client-side, and
  the backend stores only the recovery wrapper ciphertext, the recovery
  verifier hash, and safe metadata.
- Settings encrypted sync profile save/read/disconnect is shipped for logged-in
  accounts; the browser encrypts one Turso, D1 Bridge, or D1 Direct provider profile with
  the active vault key and the backend stores only ciphertext plus provider
  type/label hints, while disconnect can optionally clean up only the provider
  records already known by the current browser before the profile is disabled.
- The active encrypted sync profile can now be decrypted locally back into the
  Settings form on demand so users can rotate endpoint/token values without
  retyping the whole provider config from scratch.
- Settings now also ships a provider migration wizard; an unlocked logged-in
  browser can refresh the current source snapshot, require an empty Turso, D1
  Bridge, or D1 Direct target, copy the encrypted snapshot there, verify item counts, and
  only then switch the active encrypted sync profile.
- Settings provider connection checks are shipped for the sync-profile form; the
  browser tests Turso directly with SQL, tests D1 Bridge through an
  authenticated health endpoint, and tests D1 Direct through Cloudflare's D1
  REST query API without sending plaintext provider credentials to Ciphora.
- Settings manual Turso sync is shipped for unlocked vaults with an active
  Turso sync profile; the browser decrypts the profile locally, bootstraps the
  user-owned Turso schema, keeps provider-aware local sync metadata, pushes
  only logical delta records after refreshing stale remote state, applies safe
  known-delete tombstones, prunes remote version history per record, and
  merge-pulls remote records back into the local vault without hard-replacing
  unseen local items.
- Settings manual D1 Bridge sync is shipped for unlocked vaults with an active
  D1 Bridge sync profile; the browser decrypts the profile locally, applies the
  user-owned D1 schema through the bridge Worker, refreshes stale remote state
  before push, writes only logical delta records, prunes remote version history
  per record through the worker template, and pushes or pulls encrypted vault
  records with the same safer merge/delete semantics used for Turso.
- Settings manual D1 Direct sync is shipped for unlocked vaults with an active
  D1 Direct sync profile; the browser decrypts the profile locally, calls
  Cloudflare's D1 REST query API with the user-owned Cloudflare token,
  bootstraps the same D1 user-vault schema, refreshes stale remote state before
  push, writes only logical delta records, prunes remote version history per
  record, and pushes or pulls encrypted vault records with the same safer
  merge/delete semantics. D1 Direct is advanced; D1 Bridge remains the
  recommended D1 path when browser-side token exposure or CORS policy is a
  concern.
- Settings smart auto-sync is shipped for unlocked active tabs with an active
  sync profile; the browser can auto-pull on app focus, debounce auto-push
  after local drift, expose pause/error state, and let the user disable the
  automation locally at any time.
- Account-backed fresh-device restore is shipped on `/vault/unlock` for active
  Turso, D1 Bridge, and D1 Direct sync profiles; a browser with no local vault can log
  into Ciphora, decrypt the password wrapper locally, pull the encrypted
  provider snapshot, and install a new wrapped local master-password auth
  record without re-entering provider credentials.
- Recovery Key forgot-password reset is now also shipped on `/vault/unlock`; a
  fresh browser first requests an inbox reset link, uses that short-lived email
  token to start a short-lived reset challenge, proves Recovery Key possession
  locally, rotates the account password wrapper plus verifier, and immediately
  regains an account session without revealing the Recovery Key or root key to
  Ciphora.
- Fresh-browser encrypted backup restore is shipped on `/vault/unlock` for
  encrypted Ciphora backup files before local setup.
- Email verification is shipped through Brevo+Resend-backed Pages Functions with D1 daily provider quota caps.
- Incremental conflict-aware BYODB sync is not shipped yet.

---

## System Boundaries

```text
Ciphora-managed
  account identity
  sessions
  encrypted key wrappers
  encrypted sync profile
  operational metadata
  app-side email provider quota counters

User-managed
  user-owned Turso database
  user-owned D1 database
  user-owned sync bridge deployment
  user-owned Cloudflare API token for optional D1 Direct mode
  provider billing and quotas

Browser-managed
  local encrypted vault
  decrypted session state while unlocked
  quick unlock wrapper
  theme and local preferences
```

The most important boundary:

```text
Ciphora account recovery can restore access only if the user still has a valid
recovery path. Ciphora cannot recover vault data without the user's cryptographic
secret.
```

---

## Data Inventory

| Data category | Examples | Stored where | Ciphora can read plaintext? |
| --- | --- | --- | --- |
| Account identity | email, user id, account status | Ciphora D1 | yes, limited to account fields |
| Directory routing | email hash, user id, shard id | Ciphora D1 directory | yes |
| Auth verifier / OPAQUE credential | legacy password verifier/KDF params or OPAQUE registration record | Ciphora D1 identity shard | verifier/OPAQUE record only, not password |
| Session metadata | session id, device id, expiry, revoke state | Ciphora D1 identity shard | yes |
| Device metadata | device label, created date, last seen | Ciphora D1 identity shard | yes |
| Root-key wrappers | root key encrypted by password/recovery key | Ciphora D1 identity shard | no |
| Sync profile | provider type, label hint, encrypted DB URL/token, bridge URL/token, or D1 Direct endpoint/token | Ciphora D1 identity shard | no, ciphertext only |
| Recovery metadata | recovery key wrapper metadata, setup state | Ciphora D1 identity shard | no raw recovery key |
| Short ops events | email reset token, reset challenge, email verification, rate limits | Ciphora D1 ops runtime | yes, operational only |
| Archive events | old audit, delivery history, privacy-safe metrics | Turso internal archive | yes, operational only |
| Vault records | passwords, notes, cards, TOTP secrets | local vault and user DB | no |
| Local settings | theme, auto-lock, quick unlock wrapper | browser storage | server does not receive |

Current account UI note: normal account signup/login in Settings still runs
after the local vault is unlocked. For new accounts, the browser uses OPAQUE
registration/login and derives the password root-key wrapper from the OPAQUE
export key; Ciphora stores the OPAQUE registration record and encrypted wrapper,
not the plaintext account password or vault key. Legacy verifier accounts use
`/api/auth/login/start` to receive a signed short-lived challenge and then send
only a browser-derived HMAC proof to `/api/auth/login`; old static-verifier
records remain compatibility-only until rotated. Fresh-device restore on
`/vault/unlock` reuses the stored password wrapper and encrypted sync profile
to rebuild a local vault without exposing the plaintext account password, vault
key, or provider token to Ciphora. Recovery Key setup follows the same boundary:
the Recovery Key is generated and shown once in the browser, and Ciphora
receives only the encrypted recovery wrapper, a recovery-verifier hash, and a
short non-secret hint. Logged-in account password change and Recovery Key
forgot-password reset now support OPAQUE account mutation ceremonies; legacy
verifier accounts remain compatibility-only until rotated.

---

## Data Ciphora Must Never Collect

Ciphora must not collect or store:

- account password
- master password
- User Root Key
- Recovery Key
- plaintext vault item
- plaintext password credential
- plaintext TOTP secret
- plaintext secure note
- plaintext card number
- plaintext user database token
- plaintext sync bridge token
- plaintext Cloudflare API token for D1 Direct

If a feature requires one of these values, it must run in the browser after the
vault is unlocked.

---

## Encrypted Sync Profile

The encrypted sync profile lets users switch devices without retyping provider
credentials, while still preventing Ciphora from reading those credentials.

Plaintext shape before encryption:

```json
{
  "providerType": "external_turso",
  "labelHint": "Personal Turso",
  "endpoint": "libsql://example.turso.io",
  "accessToken": "[REDACTED_PROVIDER_TOKEN]",
  "savedAt": "2026-04-23T00:00:00.000Z"
}
```

Stored shape in Ciphora D1:

```json
{
  "providerType": "external_turso",
  "providerHint": "turso",
  "labelHint": "Personal Turso",
  "algorithm": "AES-GCM-256",
  "iv": "base64url-iv",
  "encryptedConfig": "ciphertext",
  "status": "active",
  "updatedAt": "2026-04-23T00:00:00.000Z"
}
```

Rules:

- `encryptedConfig` is encrypted client-side.
- `providerType` and `providerHint` may be stored plaintext for UI/routing if needed.
- Raw provider tokens are never sent to Ciphora as plaintext after encryption.
- The current shipped foundation supports one active encrypted sync profile per account.
- The current shipped foundation stores profile ciphertext only; connection
  checks, manual Turso sync, manual D1 Bridge sync, manual D1 Direct sync, and account-backed
  Turso/D1 Bridge/D1 Direct fresh-device restore decrypt the profile locally.
- If the user changes password, the app rewraps the User Root Key.
- If the user rotates provider token, the app updates the encrypted sync profile.

### Current Sync Semantics

- The current shipped foundation supports one active sync provider profile per
  account at a time.
- The browser-local encrypted vault remains the working source of truth during
  normal use; remote providers are used for encrypted replication and restore.
- Manual `push` refreshes stale remote state first, writes only logical item
  deltas, keeps provider version history bounded per record, and only applies
  remote deletes for records the browser already knows from that provider
  history.
- Manual `pull` merges remote active records into the local vault, applies safe
  remote deletes, and preserves local items that have never appeared in the
  current provider snapshot.
- Disconnect is explicit: users can either disable the active encrypted sync
  profile without touching the provider, or clean up only remote records already
  known by the current browser before the profile is disabled and local sync
  metadata is reset.
- Provider migration is also explicit: the browser refreshes the current source
  snapshot, requires an empty Turso, D1 Bridge, or D1 Direct target, verifies target item
  counts after copy, then replaces the single active encrypted sync profile;
  the old source provider remains untouched in this v1 flow.
- Fresh-device restore rebuilds a new local vault from the active provider
  snapshot, then returns to the same local-first operating model.
- Settings now exposes a Sync Status Center derived from local sync metadata so
  the browser can show the active mode, pending local drift, known provider
  snapshot counts, and recent push/pull timestamps without querying Ciphora for
  extra sync state.
- Smart auto-sync is now shipped for the active browser tab only; broader
  background sync, old-source cleanup after migration, and richer conflict
  journal behavior are still follow-up work.

---

## Recovery Model

Ciphora separates account reset from vault recovery.

### Normal Password Change

Requirements:

- user is authenticated
- vault/root key can be unlocked

Result:

- app verifies old password through the stored verifier metadata
- user sets new password
- app creates a new password-based root-key wrapper
- backend revokes old password wrappers and other active sessions
- vault data and sync profile do not need to be re-encrypted

### Forgot Password With Recovery Key

Current shipped requirements:

- user still knows the account email
- Recovery Key was set up or rotated after recovery-verifier support exists
- browser can start a short-lived reset challenge
- user enters Recovery Key and a replacement account password

Current shipped result:

- browser receives either the real recovery wrapper or a fake wrapper, so
  account existence is not exposed directly by the start endpoint
- browser derives the recovery verifier locally from the Recovery Key
- browser decrypts the User Root Key locally through the recovery wrapper
- backend verifies the recovery-verifier hash before rotating account-password
  state
- user sets a new account password
- app uploads a new password-based wrapper
- backend revokes prior account sessions and issues a fresh session
- encrypted sync profile remains recoverable

### Forgot Password Without Recovery Key

If no unlocked device exists and the Recovery Key is lost:

- Ciphora can reset account login identity
- Ciphora cannot recover the User Root Key
- old vault data cannot be decrypted
- old encrypted sync profile cannot be decrypted
- typing the database token again can restore provider connection only if the
  user still has the vault decrypt key

This is an intentional zero-knowledge trade-off.

---

## Vault Data Handling

Vault records are encrypted before they leave the user's device.

Vault item types:

- login/password
- TOTP authenticator secret
- secure note
- card
- future item types

Allowed remote record metadata:

- record id
- vault id
- record type hint if needed
- version number
- updated timestamp
- tombstone state
- ciphertext

Avoid plaintext metadata unless the product explicitly accepts the privacy
trade-off. Server-side full-text search is out of scope for v1 because it would
require exposing searchable metadata.

---

## Local Browser Data

Current runtime uses browser storage for the encrypted local vault.

Current local storage categories:

- encrypted vault auth record
- encrypted vault envelope
- encrypted backup state
- pre-unlock encrypted backup restore
- quick unlock wrapper
- theme
- auto-lock settings
- session key in session storage while unlocked

Current cryptography:

- PBKDF2-SHA-256 for key derivation
- AES-GCM for encrypted vault envelope
- Web Crypto for browser-native cryptographic operations

The current local runtime remains valid as the offline-first base layer even
after account/sync features are added.

---

## Internal Ciphora Databases

### D1 Directory

Purpose:

- resolve account identity to a shard
- avoid scanning all identity shards during login

Data:

- normalized email hash
- user id
- identity shard id
- account status
- created timestamp

### D1 Identity Shards

Purpose:

- store account and recovery control-plane records

Data:

- users
- authentication verifier
- KDF params
- encrypted root-key wrappers
- encrypted sync profiles
- devices
- sessions
- account settings
- recovery metadata

### D1 Ops Runtime

Purpose:

- store short-lived operational state needed for the API to work safely

Data:

- email verification challenges
- password reset email tokens
- password reset challenges
- rate limit counters
- job outbox
- short audit events
- provider health checks

### Turso Archive

Purpose:

- archive data that is useful but not required for the login critical path

Data:

- old audit events
- email delivery history
- privacy-safe usage aggregates
- operational reports

Rule: if Turso archive is unavailable, login and vault unlock should still work.

---

## User-Owned Provider Databases

User-owned databases store encrypted vault sync state.

Canonical tables:

```text
vault_records
vault_record_versions
vault_tombstones
sync_cursors
provider_devices
schema_migrations
```

Provider-specific notes:

- Turso direct mode can connect using a user-provided database URL and token.
- D1 should use a bridge Worker bound to the user's D1 database for the safest
  non-technical path.
- D1 Direct is available as an advanced mode that calls Cloudflare's D1 REST
  query API from the unlocked browser using the user-owned Cloudflare token.
- Current provider-check foundation tests Turso with `SELECT 1`, tests D1
  Bridge against an authenticated JSON health endpoint, and tests D1 Direct
  with `SELECT 1` through Cloudflare's D1 REST query API. The bridge URL may be a
  base URL or an exact health URL.
- The shipped D1 Bridge contract is a narrow Worker surface: `GET /health`,
  `POST /schema/apply`, `GET /records`, and `POST /sync/push`, all protected by
  Bearer auth except preflight.
- Provider schema should be created or migrated by Ciphora's sync setup flow.
- Provider credentials must be rotatable.

---

## API Surface

Planned API groups:

```text
/api/auth/*
  signup, login, logout, refresh, revoke session

/api/account/*
  profile, email change, password change, account delete

/api/recovery/*
  recovery status, recovery setup, reset start, reset finish

/api/devices/*
  list devices, revoke device, rename device

/api/sync-profile/*
  GET/POST/DELETE encrypted sync profile foundation

/api/ops/*
  challenge verification, outbox tasks, health checks
```

BYODB data sync should not require Ciphora API to see plaintext vault data.

---

## Technology Inventory

Current shipped technologies:

| Technology | Role |
| --- | --- |
| React 18 | frontend UI |
| TypeScript | application language |
| Vite | build tool |
| React Router | routed app shell |
| Tailwind CSS | styling |
| Radix UI packages | accessible UI primitives |
| Web Crypto | local encryption, KDF, HMAC/TOTP support |
| Browser `localStorage` | encrypted vault envelope and local settings |
| Browser `sessionStorage` | unlocked session key state |
| Cloudflare Pages | static hosting |
| Cloudflare Pages Functions | auth API and internal health endpoints |
| Cloudflare D1 | internal identity/control-plane databases |
| Turso | internal archive database |
| `@libsql/client/web` | browser-side Turso adapter for provider tests and manual Turso sync |
| Cloudflare Worker template under `templates/d1-bridge/` | user-owned D1 Bridge sync adapter |
| Cloudflare D1 REST API | advanced browser-side D1 Direct adapter |

Planned technologies:

| Technology | Role |
| --- | --- |
| Turso | optional user-owned sync provider |
| User D1 Sync Bridge | user-owned D1 sync adapter |
| Email provider | account verification and recovery challenges |

Explicitly not used as canonical vault storage in v1:

- R2
- KV
- Ciphora-owned managed vault DB

---

## Data Lifecycle

### Signup

- create account identity
- create auth verifier and KDF metadata
- create encrypted root-key wrappers
- show Emergency Kit once
- store no plaintext vault data

### Enable Sync

- user enters provider credentials locally
- app tests provider connection
- app encrypts provider config into sync profile
- Ciphora stores only encrypted sync profile

### Manual BYODB Sync

- user unlocks the local vault and signs into Ciphora
- app decrypts the active provider sync profile locally
- app bootstraps the user-owned provider schema if missing
- push refreshes stale remote state first, encrypts only changed logical vault
  items, updates provider-aware sync metadata, prunes remote version history
  per record, and only applies deletes that this browser can prove it
  previously knew about
- pull decrypts remote active records, merges them into local vault items,
  applies safe remote deletes, and preserves local-only items when the browser
  has not seen a remote delete win yet
- local activity history remains browser-local
- active D1 Bridge and D1 Direct profiles follow the same local decrypt, schema bootstrap,
  stale-refresh-before-push, delta-only write, bounded-version, and merge-safe
  pull model; D1 Bridge goes through the user-owned bridge Worker, while D1
  Direct goes through Cloudflare's D1 REST query API from the browser

### New Device

- user logs into Ciphora
- app receives encrypted sync profile
- app decrypts the stored password wrapper locally to recover the vault root key
- app decrypts sync profile locally
- app connects to user-owned provider
- app pulls encrypted records
- app installs a wrapped local auth record with a new local master password
- app decrypts vault locally

Current shipped build completes this flow for active Turso, D1 Bridge, and D1 Direct sync
profiles.

### Password Change

- app rewraps root key with new password-derived key
- provider config and vault records remain encrypted by root/vault keys
- other active account sessions are revoked; the current session remains active

### Provider Disconnect

- Ciphora deletes encrypted sync profile or marks it disabled
- user-owned provider data is not automatically deleted unless the user chooses
  a provider-side delete flow

### Account Delete

- delete Ciphora identity records
- delete encrypted sync profile
- delete sessions and devices
- queue audit deletion/retention according to policy
- do not assume Ciphora can delete user-owned database contents

---

## Retention Rules

Recommended v1 defaults:

| Data | Retention |
| --- | --- |
| Active sessions | until expiry or revocation |
| Expired sessions | short retention, then delete |
| Email verification challenges | minutes to hours |
| Password reset challenges | minutes to hours |
| Short audit events | 30 to 90 days |
| Turso archive events | longer retention, privacy-safe only |
| Rate limit counters | short TTL-style cleanup |
| Deleted account identity | delete or anonymize after safety window |

Retention must be configurable before production scale.

---

## Security Rules

- Encrypt before upload.
- Decrypt only in the client.
- Redact secrets from logs and session files.
- Never store raw provider tokens server-side.
- Never log vault item data.
- Never log Recovery Key values.
- Keep D1 directory records minimal.
- Index lookup columns to avoid expensive row scans.
- Use short-lived reset and verification challenges.
- Require rate limiting on login, reset, and provider test endpoints.
- Treat email change, password reset, and recovery as high-risk flows.
- Keep operational archive out of the login critical path.

---

## Implementation Notes

- Project documentation remains the source for current shipped commands and runtime facts.
- This document defines target behavior and should be updated when backend work
  begins.
- Backend implementation must also use `BACKEND-SECURITY-CHECKLIST.md`.
- Any schema migration work must include rollback planning before execution.

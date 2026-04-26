# Ciphora BYODB Provider Model

This file records the shipped BYODB provider model and the safety boundary for
future provider-specific bridge templates.

## Shipped Provider Types

| Provider type | User-facing label | Access model | Runtime path |
| --- | --- | --- | --- |
| `external_turso` | Turso | Browser-direct libSQL HTTPS client | `src/lib/turso-vault-sync.ts` |
| `external_d1_bridge` | D1 Bridge | User-owned Ciphora HTTP Bridge | `src/lib/d1-bridge-sync.ts` |
| `external_d1_direct` | D1 Direct | Browser-direct Cloudflare D1 REST query API | `src/lib/d1-direct-sync.ts` |
| `external_tidb_bridge` | TiDB Cloud Bridge | User-owned Ciphora HTTP Bridge | `src/lib/d1-bridge-sync.ts` |
| `external_cockroach_bridge` | CockroachDB Bridge | User-owned Ciphora HTTP Bridge | `src/lib/d1-bridge-sync.ts` |
| `external_aiven_bridge` | Aiven PostgreSQL Bridge | User-owned Ciphora HTTP Bridge | `src/lib/d1-bridge-sync.ts` |
| `external_supabase_bridge` | Supabase Bridge | User-owned Ciphora HTTP Bridge, preferably Supabase Edge Function | `src/lib/d1-bridge-sync.ts` |
| `external_mongodb_bridge` | MongoDB Atlas Bridge | User-owned Ciphora HTTP Bridge | `src/lib/d1-bridge-sync.ts` |
| `external_firestore_bridge` | Firebase Firestore Bridge | User-owned Ciphora HTTP Bridge | `src/lib/d1-bridge-sync.ts` |

Bridge-compatible providers must expose the same Ciphora HTTP Bridge contract as
the D1 Bridge template:

- `GET /health`
- `POST /schema/apply`
- `GET /records`
- `POST /sync/push`

The browser stores only the encrypted sync profile in Ciphora's account control
plane. Plaintext provider endpoint/token values are decrypted only inside the
unlocked browser tab. Vault items remain encrypted before they leave the browser.

## Starter Bridge Templates

`templates/d1-bridge/` remains the Cloudflare D1 Worker template.

`templates/http-bridge-node/` is a standalone Node HTTP Bridge starter for the
new provider families:

| Provider | Template mode |
| --- | --- |
| CockroachDB Basic | `CIPHORA_BRIDGE_PROVIDER=postgres` |
| Aiven PostgreSQL | `CIPHORA_BRIDGE_PROVIDER=postgres` |
| Supabase Postgres / pooler | `CIPHORA_BRIDGE_PROVIDER=postgres` |
| TiDB Cloud / MySQL-compatible endpoint | `CIPHORA_BRIDGE_PROVIDER=mysql` or `tidb` |
| MongoDB Atlas M0 | `CIPHORA_BRIDGE_PROVIDER=mongodb` |
| Firebase Firestore | `CIPHORA_BRIDGE_PROVIDER=firestore` |

The Node template is intentionally outside the main app bundle. It keeps raw
database/service credentials inside the user-owned bridge host and exposes only
the Ciphora bridge URL/token to the browser.

## Why These Providers Are Bridge-First

TiDB Cloud Data Service is HTTPS-based, but its API-key access uses HTTP Digest
and Data Apps/endpoints rather than the same libSQL-style database API Turso
provides. A direct TiDB driver needs a dedicated implementation and quota/error
model, so the safe shipped path is a user-owned bridge first.

CockroachDB Cloud and Aiven PostgreSQL expose PostgreSQL connection strings or
connection parameters. Those are database-driver/TCP style credentials and
should not be pasted into a browser-side Ciphora profile.

Supabase can run Edge Functions and stores function secrets server-side. Supabase
also documents that service-role/secret keys must not be used in the browser and
that browser access should rely on Row Level Security. For Ciphora sync, the
safer Supabase path is an Edge Function bridge that keeps elevated credentials
inside Supabase.

MongoDB Atlas M0 should be treated as bridge-first because the old Atlas App
Services Data API / HTTPS endpoint path is deprecated/end-of-life territory. A
user-owned bridge should talk to Atlas with a driver or maintained API layer.

Firebase Firestore can be browser-direct when Firebase Auth and Security Rules
are carefully designed, but Ciphora's account model is separate from Firebase
Auth. Until a proper auth/rules integration exists, Firestore should be bridged.

## Source References

- TiDB Cloud Data Service: https://docs.pingcap.com/tidbcloud/data-service-get-started/
- TiDB Cloud API authentication: https://docs.pingcap.com/api/tidb-cloud-api-overview/
- TiDB Cloud standard connection: https://docs.pingcap.com/tidbcloud/connect-via-standard-connection/
- CockroachDB connection model: https://www.cockroachlabs.com/docs/stable/connect-to-the-database
- Aiven PostgreSQL connection URI: https://aiven.io/docs/products/postgresql/howto/connect-psql
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase API key safety: https://supabase.com/docs/guides/api/api-keys
- Supabase Row Level Security: https://supabase.com/docs/guides/auth/auth-deep-dive/auth-row-level-security
- MongoDB Node.js driver connection model: https://www.mongodb.com/docs/drivers/node/current/connect/
- MongoDB App Services deprecation state: https://www.mongodb.com/docs/atlas/app-services/release-notes/backend/
- MongoDB Data API deprecated reference: https://www.mongodb.com/docs/api/doc/atlas-app-services-admin-api-v3/group/endpoint-data-api
- Firebase Security Rules overview: https://firebase.google.com/docs/rules/get-started
- Cloud Firestore Security Rules: https://firebase.google.com/docs/firestore/security/get-started
- Cloud Firestore server client libraries: https://firebase.google.com/docs/firestore/quickstart

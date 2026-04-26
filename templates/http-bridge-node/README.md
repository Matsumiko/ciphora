# Ciphora HTTP Bridge Node Template

This template runs a user-owned Ciphora HTTP Bridge for providers that should
not be accessed directly from the browser.

It implements the same contract as `templates/d1-bridge`:

- `GET /health`
- `POST /schema/apply`
- `GET /records`
- `POST /sync/push`

Every route requires:

```http
Authorization: Bearer <CIPHORA_BRIDGE_TOKEN>
```

The bridge stores only encrypted vault records and sync metadata. It never sees
vault plaintext because Ciphora encrypts records in the browser before sync.

## Provider Modes

| Provider | Bridge mode | Main env vars |
| --- | --- | --- |
| CockroachDB Basic | `postgres` | `DATABASE_URL` |
| Aiven PostgreSQL Free Tier | `postgres` | `DATABASE_URL` |
| Supabase Postgres / pooler | `postgres` | `DATABASE_URL` |
| TiDB Cloud / MySQL-compatible endpoint | `mysql` or `tidb` | `DATABASE_URL` |
| MongoDB Atlas M0 | `mongodb` | `MONGODB_URI`, `MONGODB_DATABASE` |
| Firebase Firestore | `firestore` | `FIRESTORE_PROJECT_ID`, `FIRESTORE_SERVICE_ACCOUNT_JSON` |

Supabase users can either run this Node bridge against their Supabase Postgres
connection/pooler or port this contract into a Supabase Edge Function. Do not
put Supabase service-role keys into Ciphora's sync profile form.

## Setup

1. Copy `.env.example` to `.env` and fill only the provider you use.
2. Install dependencies:

```bash
npm install
```

3. Start locally:

```bash
npm start
```

4. Apply schema once:

```bash
curl -X POST http://localhost:8977/schema/apply \
  -H "Authorization: Bearer $CIPHORA_BRIDGE_TOKEN"
```

5. Test health:

```bash
curl http://localhost:8977/health \
  -H "Authorization: Bearer $CIPHORA_BRIDGE_TOKEN"
```

6. In Ciphora `/vault/sync`, choose the matching Bridge provider and use:

- endpoint: your deployed bridge base URL
- token: `CIPHORA_BRIDGE_TOKEN`

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `CIPHORA_BRIDGE_PROVIDER` | yes | `postgres`, `mysql`, `tidb`, `mongodb`, or `firestore` |
| `CIPHORA_BRIDGE_PROVIDER_TYPE` | recommended | Reported Ciphora provider type, for example `external_aiven_bridge` |
| `CIPHORA_BRIDGE_TOKEN` | yes | Long random Bearer token used by Ciphora browser requests |
| `CIPHORA_ALLOWED_ORIGINS` | recommended | Comma-separated browser origins allowed by CORS |
| `CIPHORA_BRIDGE_PORT` | no | Local port, default `8977` |
| `CIPHORA_MAX_BODY_BYTES` | no | Max request body size, default `2500000` |
| `DATABASE_URL` | postgres/mysql/tidb | Provider database connection string |
| `MONGODB_URI` | mongodb | MongoDB Atlas connection URI |
| `MONGODB_DATABASE` | mongodb | Database name for Ciphora sync collections |
| `FIRESTORE_PROJECT_ID` | firestore | Firebase/GCP project ID |
| `FIRESTORE_DATABASE_ID` | firestore | Firestore database ID, default is provider default |
| `FIRESTORE_SERVICE_ACCOUNT_JSON` | firestore | Service account JSON for server-side Firestore access |

## Deployment Notes

Use a Node-capable host such as Cloud Run, Fly.io, Render, Railway, a VPS, or a
container platform. This template uses provider drivers that open outbound
database connections, so it is not the same deployment model as the Cloudflare
D1 Worker template.

For Cloudflare-only users, `templates/d1-bridge` remains the simplest managed
Worker path.

## Security Notes

- Keep raw database URLs, database passwords, MongoDB URIs, Firestore service
  accounts, and Supabase service-role keys inside the bridge host only.
- The Ciphora app should receive only the bridge URL and bridge Bearer token.
- Use a long random `CIPHORA_BRIDGE_TOKEN`; rotate it if it is exposed.
- Restrict `CIPHORA_ALLOWED_ORIGINS` to your Ciphora origins.
- Put the bridge behind HTTPS in production.
- Do not enable broad provider firewall/network rules unless required by the
  chosen host.

## Current Limits

- This is a starter template, not a managed Ciphora cloud service.
- Live provider smoke is not included because it requires user-owned disposable
  external credentials.
- Firestore writes are sequential to stay simple and transparent; heavy vaults
  may need batching and quota tuning.
- MongoDB uses transactions; make sure your Atlas deployment supports them.

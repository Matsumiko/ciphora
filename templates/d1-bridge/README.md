# Ciphora D1 Bridge Template

This Worker template lets a Ciphora user sync encrypted vault records to their
own Cloudflare D1 database instead of using Turso.

The bridge is user-owned:

- Ciphora does not host this Worker.
- Ciphora does not own this D1 database.
- The browser still encrypts vault records before upload.
- The Worker only stores ciphertext plus minimal sync metadata.

## Routes

- `GET /health`
- `POST /schema/apply`
- `GET /records`
- `POST /sync/push`

All routes require:

- `Authorization: Bearer <CIPHORA_BRIDGE_TOKEN>`

## Setup

1. Create a D1 database in the user's Cloudflare account.
2. Replace `database_name` and `database_id` in [wrangler.toml](./wrangler.toml).
3. Set the bridge token:

```bash
npx wrangler secret put CIPHORA_BRIDGE_TOKEN
```

4. Optionally set extra allowed origins if the user needs more than the default Ciphora/local-dev origins:

```bash
npx wrangler secret put CIPHORA_ALLOWED_ORIGINS
```

Or edit the plain variable in `wrangler.toml` if the values are non-secret.

5. Deploy:

```bash
npx wrangler deploy
```

6. In Ciphora Settings, save a D1 Bridge sync profile using:

- endpoint: the Worker base URL, for example `https://my-ciphora-bridge.example.workers.dev`
- token: the same `CIPHORA_BRIDGE_TOKEN`

## Notes

- Run `POST /schema/apply` once after deploy, or let Ciphora do it during the first manual sync.
- The canonical SQL shape is documented in [schema/d1/user_vault.sql](../../schema/d1/user_vault.sql).
- Schema V2 adds `sync_journal`, `sync_conflicts`, and `sync_device_cursors` as additive metadata tables.
- `POST /sync/push` accepts optional `journalEvents`, `conflicts`, and `resolvedConflicts` entries and stores metadata only; vault item plaintext, provider tokens, cookies, and decrypted fields must never be sent to the bridge.
- This template currently supports manual push/pull, account-backed fresh-device D1 restore, metadata-only conflict persistence, and explicit conflict-resolution metadata updates. Cursor-based `/sync/pull` and background reconciliation are separate follow-up work.

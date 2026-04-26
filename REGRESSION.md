# Ciphora Regression Smoke

This repo ships a no-secret smoke runner for the surfaces that usually regress first:
auth route safety, OPAQUE endpoint availability, Recovery Key email-token reset gate,
BYODB provider reachability, mobile layout, and light-mode rendering.

## Command

```bash
npm run regression:smoke -- --base-url https://app.ciphora.indevs.in
```

The default run is safe for production-like targets:

- Reads public app routes and `/api/health`.
- Confirms unauthenticated account/recovery endpoints reject without a session.
- Calls `/api/auth/login/start` with a random `.invalid` email to verify fake login metadata and anti-enumeration behavior.
- Calls `/api/auth/opaque/register/start` with a random `.invalid` email to verify the OPAQUE server setup and protocol response without creating an account.
- Loads the browser OPAQUE client chunk in headless Chrome and verifies it can produce a registration request under the deployed CSP.
- Creates only a disposable local encrypted vault inside a temporary Chrome profile for browser layout checks.
- Does not write provider vault data.
- Does not store or print Turso, D1 Bridge, or Cloudflare tokens.

## Optional Checks

Run the Recovery Key reset-start email-token gate smoke only when stateful QA writes are acceptable:

```bash
npm run regression:smoke -- --base-url https://app.ciphora.indevs.in --include-recovery-write
```

Run OPAQUE stateful checks only when short-lived challenge rows or disposable account rows are acceptable:

```bash
npm run regression:smoke -- --base-url https://app.ciphora.indevs.in --include-opaque-login-write
npm run regression:smoke -- --base-url https://app.ciphora.indevs.in --include-opaque-account-write
npm run regression:smoke -- --base-url https://app.ciphora.indevs.in --include-legacy-upgrade-write
```

The full disposable account check signs up a QA account, logs in, rotates the
OPAQUE account password, verifies the old password is rejected, sets up Recovery
Key state, requests the generic email-reset endpoint, and verifies
`/api/recovery/reset/start` refuses to issue a ceremony challenge without the
real inbox token. It prints only the generated QA user id/shard id needed for
manual cleanup; it does not print passwords, cookies, email tokens, or protocol
secrets.

The legacy upgrade check signs up a disposable challenge-bound verifier account,
upgrades it to OPAQUE through account-password change, verifies the old password
is rejected by OPAQUE login, and verifies the new OPAQUE password can log in. It
also prints only the generated QA user id/shard id needed for manual cleanup.

Provider pings are opt-in because user-owned BYODB credentials are secrets:

```bash
$env:CIPHORA_REGRESSION_TURSO_URL="libsql://..."
$env:CIPHORA_REGRESSION_TURSO_TOKEN="..."
$env:CIPHORA_REGRESSION_D1_BRIDGE_URL="https://..."
$env:CIPHORA_REGRESSION_D1_BRIDGE_TOKEN="..."
npm run regression:smoke -- --base-url https://app.ciphora.indevs.in
```

Chrome is auto-detected on common Windows/macOS/Linux paths. If needed:

```bash
npm run regression:smoke -- --browser-path "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

## Current Coverage

- Auth/API: SPA routes, health, unauthenticated session/recovery rejection, login-start fake metadata, OPAQUE registration-start protocol smoke.
- Recovery: status endpoint rejection by default, reset-start email-token gate when explicitly enabled.
- OPAQUE: registration-start protocol smoke by default, fake login challenge explicitly enabled, disposable signup/login/password-rotation/Recovery-Key-setup/email-reset-gate explicitly enabled, and disposable legacy-verifier-to-OPAQUE upgrade explicitly enabled.
- Turso sync: read-only connection ping when env credentials are supplied.
- D1 Bridge sync: authenticated `/health` ping when env credentials are supplied.
- Browser/mobile/light mode: headless Chrome renders landing, loads the OPAQUE WASM-backed client chunk, unlock, disposable vault setup, mobile generator, mobile settings, and desktop dashboard while checking runtime errors and horizontal overflow.

## Not Covered Yet

- A full forgot-password Recovery Key reset ceremony against disposable internal DB rows plus a captured real inbox token.
- Full Turso/D1 Bridge encrypted push/pull/delete reconciliation against disposable provider databases.
- Visual screenshot diffing.
- External security scanning or formal OWASP ASVS certification.

Those deeper checks should be added as separate opt-in suites because they create persistent test records or require dedicated disposable provider databases.

# Ciphora OPAQUE/PAKE Research And Audit Prep

Date: 2026-04-25

## Status

Ciphora now has an OPAQUE-backed account signup/login foundation, OPAQUE account password rotation, OPAQUE Recovery Key reset, and a logged-in legacy verifier-to-OPAQUE upgrade during account-password change. The interim challenge-bound account-login proof remains as a legacy fallback for existing verifier records. This is still not independently audited and must not be marketed as Bitwarden-level or formally OWASP/crypto certified.

Email verification and email-token-gated Recovery Key reset are now implemented through Brevo+Resend-backed Pages Functions. The OPAQUE account mutation ceremonies are implemented internally, but they still require external cryptographic review before any Bitwarden-level or independent-audit claim.

## Primary-Source Findings

- RFC 9807 is the current OPAQUE reference. It was published in July 2025 by IRTF CFRG as "The OPAQUE Augmented Password-Authenticated Key Exchange (aPAKE) Protocol." It defines a client-server aPAKE where the password is not disclosed to the server, including during registration, and the design targets pre-computation resistance after server credential-file compromise.
- OPAQUE is composed from an OPRF, a key-recovery envelope, and an authenticated key exchange. The online flow uses KE1, KE2, and KE3 messages; the client receives a session secret plus a client-only export key after peer authentication.
- RFC 9807 recommends explicit application configuration choices: OPRF suite, KDF, MAC, hash, key-stretching function, group, and context. It calls out Argon2id as a KSF option and recommends context data to prevent cross-protocol or downgrade attacks.
- RFC 9807 leaves client/server identity transport to the application. For Ciphora, that means the identity bytes must be fixed and audited, not inferred loosely from display email strings.
- RFC 9497 is the relevant OPRF source. It defines OPRF/VOPRF/POPRF modes, ciphersuite identifiers, context-string construction, and test vectors that any selected implementation must pass.
- RFC 9807 notes a limitation that there is no security analysis for the described OPAQUE protocol in multi-server-key or batching settings. Ciphora should avoid batching and keep one active server setup key per OPAQUE configuration until reviewed.

## Implementation Candidates

### `facebook/opaque-ke`

- Rust implementation based on RFC 9807.
- The project README states current installation as `opaque-ke = "4.1.0-pre.2"` and Rust 1.87+.
- It reports a 2021 NCC Group audit on an older release and says fixes were incorporated into release `v1.2.0`.
- Fit for Ciphora: strongest candidate for protocol core, but direct Worker/browser integration would require WASM or a server-side Rust/WASM boundary and fresh review against the exact version used.

### `serenity-kit/opaque`

- JavaScript/WASM package based on `opaque-ke`.
- It supports browser-facing use and documents Argon2id key stretching profiles.
- It warns that RFC-recommended Argon2 memory can be too heavy in browser environments and provides a memory-constrained default that is faster but less secure.
- Fit for Ciphora: practical frontend candidate, but bundle size, WASM CSP, browser memory, mobile performance, and exact parameter choices need testing before adoption.

### `cloudflare/opaque-ts`

- TypeScript library, but the repository README points to OPAQUE draft v07 and the latest visible release is from 2022.
- Fit for Ciphora: not suitable as a final candidate without proof it has been updated to RFC 9807 and reviewed.

## Ciphora Target Model

The shipped foundation now matches the first OPAQUE-backed Ciphora account ceremony:

- Registration stores an OPAQUE registration record/server-side credential material, not a reusable password verifier.
- Login runs OPAQUE KE1/KE2/KE3 and issues the existing HttpOnly Ciphora session only after the server verifies KE3.
- The browser uses the OPAQUE client export key to derive a local account root-key unwrap key. Ciphora still never receives the plaintext account password, vault root key, Recovery Key, provider token, or decrypted vault data.
- Existing challenge-bound verifier records remain a legacy compatibility path. Recovery Key reset and logged-in account-password change can now replace the account credential with an OPAQUE registration record when the browser supplies OPAQUE material.
- Server setup keys currently use one `opaque_config_id`; full rotation must become additive so new registrations can use a new config while existing records continue with their stored config until upgraded.
- Login errors must remain anti-enumeration safe and rate limited. OPAQUE does not remove the need for account/IP throttling or abuse controls.

## Proposed API Shape

Add these endpoints as a separate versioned auth surface instead of mutating the current endpoints in place:

- `POST /api/auth/opaque/register/start`
- `POST /api/auth/opaque/register/finish`
- `POST /api/auth/opaque/login/start`
- `POST /api/auth/opaque/login/finish`
- `POST /api/account/password/opaque/start`
- `POST /api/account/password/opaque/finish`
- `POST /api/account/password/opaque/upgrade/start`
- `POST /api/account/password/opaque/upgrade/finish`

The OPAQUE auth, password-rotation, and legacy-upgrade endpoints are shipped. Keep current account/session endpoints while legacy accounts still exist.

## Schema Additions

Additive D1 identity-shard fields/tables are safer than reshaping existing verifier rows:

- `opaque_server_configs`: `config_id`, suite identifiers, server public key, encrypted private setup material reference or secret-binding metadata, status, created_at, retired_at.
- `opaque_credentials`: `user_id`, `config_id`, credential_identifier_hash, registration_record, client_identity_hash, server_identity, created_at, rotated_at.
- `auth_verifiers.verifier_mode`: keep existing modes and add `opaque_rfc9807` only after implementation is ready.

Do not store plaintext setup private keys in D1. Worker secret storage, encrypted secret blobs, or Cloudflare secret binding strategy needs a separate operations decision.

## External Audit Package

Prepare these artifacts before review:

- Threat model: local-first encrypted vault, Ciphora internal DB, BYODB Turso/D1 Bridge, recovery, and session cookies.
- OPAQUE design note: suite choices, identity bytes, context string, KSF parameters, server key storage/rotation, and migration path from legacy verifier records.
- Endpoint inventory: current auth/recovery/sync endpoints plus proposed OPAQUE endpoints.
- Database schema and migrations for directory, identity shards, ops runtime, and BYODB schemas.
- Browser crypto inventory: local vault key derivation, account wrapper, Recovery Key wrapper, sync profile encryption, provider sync record encryption.
- Regression evidence: typecheck, build, browser/API smoke, provider ping, and future OPAQUE test-vector pass.
- Explicit non-goals: no third-party assurance claim before signed audit results.

## Rollout Plan

1. Select implementation candidate after prototype benchmarks in Chrome desktop, Chrome mobile emulation, and Cloudflare Pages Functions/Workers runtime.
2. Build an isolated OPAQUE proof of concept with RFC test vectors and no Ciphora production DB writes.
3. Add OPAQUE schema and endpoints behind a feature flag.
4. Continue using account-password change and Recovery Key reset as the shipped active-user migration paths from challenge-bound verifier to OPAQUE.
5. Run external cryptographic review before making public security parity claims.
6. Keep legacy verifier login until a measured migration window is complete.

## References

- RFC 9807: https://www.rfc-editor.org/rfc/rfc9807.html
- RFC 9497: https://www.rfc-editor.org/rfc/rfc9497
- `facebook/opaque-ke`: https://github.com/facebook/opaque-ke
- `serenity-kit/opaque`: https://github.com/serenity-kit/opaque
- `cloudflare/opaque-ts`: https://github.com/cloudflare/opaque-ts

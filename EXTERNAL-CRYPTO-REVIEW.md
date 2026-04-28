# Ciphora External Cryptographic Review Packet

Date: 2026-04-28
Status: audit-readiness package, not an external audit result

## Purpose

This packet is the canonical scope and evidence index for an independent cryptographic and application-security review of Ciphora.

It is intended to help an external reviewer evaluate whether Ciphora's local-first vault encryption, OPAQUE account authentication, Recovery Key reset, and BYODB sync model are designed and implemented safely enough for public security claims.

## Claims Policy

Until an independent reviewer signs off and required fixes are completed, Ciphora must not be marketed as:

- Bitwarden-level or Bitwarden-equivalent security.
- OWASP ASVS complete or OWASP certified.
- Independently audited.
- Formally cryptographically verified.
- Bank-grade, military-grade, or otherwise certified beyond the evidence available in this repository.

Allowed wording before review:

- "Local-first encrypted vault."
- "OPAQUE-backed account authentication is implemented and pending external cryptographic review."
- "Internal security review and regression tests are maintained, but they are not a substitute for an independent audit."

## External Standards And Primary References

- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- RFC 9807 OPAQUE: https://www.rfc-editor.org/rfc/rfc9807.html
- RFC 9497 OPRF: https://www.rfc-editor.org/rfc/rfc9497.html

OWASP ASVS should be used as a verification framework, not as a certification claim unless a qualified review explicitly confirms the applicable level and scope.

## Review Goals

The reviewer should answer:

- Does the Ciphora OPAQUE implementation follow the intent of RFC 9807 closely enough for browser plus Cloudflare Pages Functions deployment?
- Are account passwords, vault root keys, Recovery Keys, provider tokens, and decrypted vault items kept out of Ciphora server plaintext state in normal operation?
- Are the local vault, account wrapper, Recovery Key wrapper, sync profile wrapper, and BYODB record encryption boundaries coherent?
- Are legacy verifier fallback paths acceptably isolated and migration-safe while older accounts still exist?
- Are session, reset, rate-limit, anti-enumeration, and audit-log controls strong enough for the current threat model?
- Are sync conflict, tombstone, version-history, and provider-token handling rules safe under retry, duplicate, stale, and multi-device conditions?
- Which security claims can be made publicly after fixes, and which claims remain unsupported?

## In Scope

### Cryptography And Key Handling

- Browser-local vault encryption and backup encryption.
- Master-password-derived local unlock material.
- Quick PIN vault-key wrapping.
- Account root-key password wrappers.
- OPAQUE export-key-derived root-key wrapper.
- Recovery Key generation, one-time display, verifier, and root-key wrapper.
- Sync profile encryption for user-owned provider credentials.
- BYODB vault record encryption for Turso, D1 Bridge, D1 Direct, and HTTP Bridge-compatible providers.
- TOTP secret storage and live-code generation.

### Authentication And Recovery

- OPAQUE signup, login, password rotation, Recovery Key reset, and logged-in legacy-to-OPAQUE upgrade ceremonies.
- Legacy challenge-bound verifier fallback while old accounts still exist.
- Email-token-gated Recovery Key reset.
- Session issuance, revocation, cookie attributes, and device/session management.
- Anti-enumeration behavior and fake challenge paths.
- Rate limiting, attempt limits, and short-lived challenge storage.

### BYODB Sync

- One-active-provider sync profile model.
- Turso direct sync.
- D1 Bridge sync.
- D1 Direct sync.
- HTTP Bridge-compatible providers.
- Pull-if-stale-before-push.
- Delta-only writes.
- Known-delete tombstones.
- Conflict journal and conflict-resolution actions.
- Bounded `vault_record_versions` retention.
- Fresh-device restore from encrypted sync profile.

### Platform Runtime

- Cloudflare Pages Functions API.
- Browser Web Crypto usage.
- PWA runtime.
- Tauri desktop runtime.
- Capacitor Android runtime.
- CSP and security headers, including OPAQUE WASM requirements.

## Out Of Scope Unless Separately Contracted

- Legal/privacy review of public policy text.
- Brand or UX review.
- Provider dashboard account security for user-owned Turso, Cloudflare, Supabase, MongoDB, Firebase, TiDB, CockroachDB, or Aiven accounts.
- Native app store submission review.
- Formal SOC 2, ISO 27001, PCI, HIPAA, or regulatory compliance certification.
- Cloudflare/Turso account-level operational controls outside the repository and deployment configuration provided to the reviewer.

## Current Cryptographic Inventory

| Surface | Current model | Key review questions |
| --- | --- | --- |
| Local vault | Web Crypto AES-GCM, random IV per envelope, PBKDF2-SHA-256 local derivation for legacy/local unlock | Are KDF parameters acceptable for desktop/mobile browsers, and what is the safest Argon2id/WASM migration path? |
| Quick PIN | PBKDF2-SHA-256-derived PIN wrap key plus AES-GCM root-key wrapper | Is the quick-unlock model appropriately scoped as convenience-only, and is local-device compromise risk communicated? |
| OPAQUE account auth | `@serenity-kit/opaque`, config id `opaque-rfc9807-serenity-v1`, export-key HKDF-SHA-256 wrapper derivation, AES-GCM root-key wrapper | Are suite choices, identities, context, export-key use, fake challenges, and setup-key storage correct? |
| Legacy verifier fallback | Challenge-bound HMAC proof for legacy records | Is the fallback sufficiently constrained, and what deprecation/migration window is required? |
| Recovery Key | Browser-generated key, shown once, stores encrypted wrapper plus verifier metadata | Are reset/start/finish challenges, token gates, wrappers, and anti-enumeration behavior safe? |
| Sync profile | Provider config encrypted in browser before Ciphora stores profile ciphertext | Does metadata leakage remain acceptable, and are profile rotation/disconnect rules safe? |
| BYODB records | Per-record AES-GCM ciphertext with content hash, version, tombstone, and journal metadata | Are content hashes safe metadata, and do sync retries/conflicts avoid overwrite/data-loss bugs? |
| TOTP | RFC 6238-compatible HMAC code generation from locally encrypted secrets | Are secret validation, storage, display, and clipboard behaviors acceptable? |

## Evidence Inventory

### Design And Security Docs

- `ARCHITECTURE.md` - target and shipped architecture.
- `SYSTEM.md` - data handling and technology overview.
- `SECURITY-AUDIT.md` - internal ASVS-style implementation audit and residual risks.
- `OPAQUE-PAKE-RESEARCH.md` - OPAQUE/PAKE research and implementation notes.
- `SYNC-CONFLICT-JOURNAL.md` - BYODB journal and incremental sync design.
- `BYODB-PROVIDERS.md` - user-owned database provider model.
- `BACKEND-SECURITY-CHECKLIST.md` - per-feature security review checklist.
- `REGRESSION.md` - current regression coverage and explicit exclusions.

### Crypto/Auth Code

- `src/lib/vault-storage.ts` - local vault encryption, wrappers, quick PIN, backups, sync metadata.
- `src/lib/account-client.ts` - browser account auth/recovery client flows.
- `functions/_shared/opaque.ts` - OPAQUE server utility and wrapper derivation validation.
- `functions/_shared/auth.ts` - sessions, verifiers, wrappers, rate limits, challenge helpers.
- `functions/_shared/crypto.ts` - backend HMAC/AES-GCM helper primitives.
- `functions/api/auth/opaque/*` - OPAQUE signup/login endpoints.
- `functions/api/account/password/opaque/*` - OPAQUE password rotation and legacy upgrade endpoints.
- `functions/api/recovery/*` - Recovery Key and email-token reset endpoints.
- `functions/api/auth/*` - session, legacy login, logout, and signup endpoints.
- `functions/api/account/devices.ts` - device/session management endpoint.

### Sync Code

- `src/lib/manual-vault-sync-core.ts` - shared sync orchestration.
- `src/lib/turso-vault-sync.ts` - direct Turso encrypted record sync.
- `src/lib/d1-bridge-sync.ts` - HTTP Bridge/D1 Bridge sync.
- `src/lib/d1-direct-sync.ts` - direct Cloudflare D1 REST sync.
- `src/lib/sync-conflict-resolution.ts` - local conflict resolution.
- `src/lib/sync-status.ts` - local status/pending drift computation.
- `functions/api/sync-profile.ts` - encrypted sync profile storage.
- `templates/d1-bridge/` - user-owned D1 Bridge worker template.
- `templates/http-bridge-node/` - user-owned HTTP Bridge template.

### Schemas And Headers

- `schema/d1/*.sql` - Ciphora internal directory, identity shards, ops runtime, email quota, OPAQUE, device/session schemas.
- `schema/turso/*.sql` - archive and user-vault schemas.
- `schema/d1/user_vault.sql` - BYODB D1 user vault schema.
- `schema/turso/user_vault.sql` - BYODB Turso user vault schema.
- `public/_headers` - Cloudflare Pages security headers.
- `public/_redirects` - SPA routing fallback.

### Verification Scripts

- `scripts/regression-smoke.mjs` - browser/API/stateful smoke runner.
- `scripts/cleanup-regression-accounts.mjs` - disposable account cleanup.

## Required Reviewer Deliverables

The engagement should produce:

- Threat model review with trust boundaries and attacker assumptions.
- Cryptographic design review for OPAQUE, wrappers, Recovery Key, local vault encryption, and sync encryption.
- Source review findings with severity, exploit scenario, affected files, and remediation guidance.
- Verification notes for exact commit hash, deployed preview URL, test commands, and scope limitations.
- Required fixes before any public independent-audit or OWASP-style assurance claim.
- Optional retest/fix-review report after remediation.
- Approved public wording for post-review security claims.

## High-Priority Review Questions

### OPAQUE

- Are OPAQUE client/server identities fixed and bound correctly?
- Is the application context string sufficient to prevent cross-protocol or downgrade confusion?
- Is the OPAQUE export key used only for the intended root-key wrapper derivation?
- Are fake login/start paths anti-enumeration safe in content, timing, and rate-limit behavior?
- Does the server setup secret storage and rotation plan avoid invalidating existing credentials or weakening future records?
- Are credential epochs and revoked fingerprints sufficient to prevent stale challenge completion after password rotation?
- Is the memory-constrained browser key-stretching profile acceptable, and what stronger profile should new vaults prefer?

### Local Vault And Recovery

- Are AES-GCM IVs generated with enough uniqueness and randomness across all encrypted envelopes?
- Are wrapper metadata, salts, hints, and hashes safe to store and expose?
- Does Recovery Key reset correctly prove possession without exposing the key or root key?
- Is one-time Recovery Key display sufficient, and are recovery failure states safe?
- Is quick PIN wording and implementation clear that it is a local convenience wrapper, not a replacement for the master/account password?

### Sync

- Can stale multi-device updates overwrite newer remote data?
- Are known-delete tombstones safe against deleting unknown remote records?
- Can push retries or version journal writes grow unbounded?
- Are content hashes acceptable metadata, or should they be keyed/obfuscated?
- Is D1 Direct token handling acceptable for an advanced user-owned provider mode?
- Is the HTTP Bridge contract sufficiently authenticated and replay resistant for user-owned deployments?

### Browser/API Surface

- Do all public and session endpoints enforce method, origin, input size, and payload validation?
- Are cookies, CSP, CORS, and native-origin allowances correctly scoped?
- Are errors generic enough for auth/recovery without hiding actionable user recovery states?
- Is audit logging sufficient for sensitive events without exposing raw IPs, user agents, tokens, or provider credentials?

## Pre-Audit Checklist

Before sending the repository to a reviewer:

- [ ] Provide a clean private commit hash and matching sanitized public commit hash if applicable.
- [ ] Provide a deployed preview URL for that exact commit.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd run typecheck:functions`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `npm.cmd audit --audit-level=moderate`.
- [ ] Run browser/API regression smoke against preview or production.
- [ ] Run opt-in stateful OPAQUE account smoke with disposable cleanup.
- [ ] Provide disposable test accounts only; never provide real user data.
- [ ] Provide disposable BYODB provider credentials only; never provide owner production provider tokens.
- [ ] Confirm local secret/env files, keystores, vault exports, and runtime session files are excluded from the review export unless transferred through a secure channel on purpose.
- [ ] Identify the exact secrets/bindings that exist in production without disclosing values.
- [ ] Identify known residual risks accepted for the review scope.

## Candidate External Reviewers

These are candidate organizations to contact, not endorsements and not evidence that an engagement exists:

- Trail of Bits - software assurance with application security and cryptography expertise: https://www.trailofbits.com/services/software-assurance/
- Cure53 - security assessments, web/API penetration tests, and cryptography audits: https://cure53.de/
- Least Authority - security consulting with source-code audits and cryptographic expertise: https://leastauthority.com/security-consulting/
- NCC Group Cryptography Services - cryptography and encryption assessment services: https://www.nccgroup.com/us/technical-assurance/cryptography-encryption/cryptography-services/
- Latacora - security engineering and application security consulting: https://latacora.com/

Selection criteria:

- Demonstrated cryptography review experience, not only automated pentesting.
- Willingness to review TypeScript, Web Crypto, Cloudflare Pages Functions, browser WASM, and local-first encrypted sync.
- Willingness to review OPAQUE protocol integration and not only generic web app controls.
- Ability to provide a public-safe report summary or approved public wording.
- Optional fix-review phase after remediation.

## Request Template

Subject: Request for cryptographic and appsec review - Ciphora local-first password manager

Hello,

Ciphora is a local-first password manager with browser-side vault encryption, OPAQUE-backed account authentication, Recovery Key reset, and optional user-owned database sync. We are preparing for an independent cryptographic and application-security review before making stronger public security claims.

Requested scope:

- OPAQUE signup/login/password-rotation/recovery-reset ceremonies.
- Local vault encryption, root-key wrappers, Recovery Key wrapper, and sync profile encryption.
- BYODB encrypted sync model for Turso, D1 Bridge, D1 Direct, and HTTP Bridge-compatible providers.
- Cloudflare Pages Functions auth/session/recovery endpoints and browser runtime constraints.

Requested deliverables:

- Threat model and cryptographic design review.
- Source review findings with severity and remediation guidance.
- Explicit sign-off boundaries and allowed public wording after fixes.
- Optional retest/fix-review phase.

We can provide:

- Private repository access or a sanitized source export.
- Architecture and system docs.
- Regression commands and disposable test accounts.
- Deployed preview URL for the exact commit under review.

Please share availability, estimated timeline, required access model, and budget range.

Thank you.

## Public Sign-Off Gate

Ciphora can only update public security claims after all of these are true:

- An external reviewer has delivered a signed report or equivalent written assessment.
- Critical/high findings are fixed or explicitly accepted with documented rationale.
- Fix-review is completed for findings that affect cryptographic or auth correctness.
- Public wording has been approved against the review scope.
- The reviewed commit or release range is clearly identified.

Until then, the correct status is: internal implementation review complete for selected areas, independent cryptographic review pending.

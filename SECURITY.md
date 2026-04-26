# Security Policy

## Reporting a Vulnerability

Please report suspected security issues to `support@ciphora.indevs.in`.

Do not include plaintext vault data, recovery keys, private keys, account passwords, provider tokens, or other production secrets in a report. If a proof of concept needs sensitive material, use disposable test data.

## Current Assurance Level

Ciphora includes internal security hardening for local vault encryption, account authentication, recovery flows, sync-profile handling, and BYODB sync conflict handling. The project has not completed an independent third-party cryptographic audit or formal OWASP ASVS certification.

Security-sensitive claims should stay precise:

- Acceptable: "local-first encrypted vault", "OPAQUE-backed account login foundation", "BYODB sync support".
- Not acceptable without external review: "Bitwarden-equivalent security", "OWASP certified", "independently audited".

## Supported Versions

The latest tagged release receives priority for security fixes. Older experimental builds may not receive backports.

## Secret Handling

Do not commit:

- `.env` or `.env.*` files containing real values.
- Cloudflare, Turso, Brevo, Resend, GitHub, Android signing, or database tokens.
- Android keystores or signing passwords.
- Browser exports, vault backups, debug payloads, or regression test credentials.

The repository `.gitignore` is configured to keep common local secret files and build outputs out of Git, but contributors are still responsible for reviewing staged changes before pushing.

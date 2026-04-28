# Changelog

## Unreleased

- Added `EXTERNAL-CRYPTO-REVIEW.md` as the public-safe external cryptographic review readiness packet and linked it from security/OPAQUE documentation.
- Fixed auto-sync pending delete handling so local-only/orphan deletes do not keep provider sync stuck in a repeated pending state.
- Auto-sync now pauses when unresolved BYODB conflicts need user review instead of retrying conflict pushes repeatedly.
- Auto-sync now reads encrypted vault snapshots without triggering the global loading screen, pulls on unlocked app open/focus, and dedupes automatic push attempts for unchanged pending local state.

## v1.3.3

- Added Android APK update checking for manually installed release builds.
- Added a production release manifest at `/releases/latest.json` with no-store/CORS headers.
- Added an in-app Android update prompt that opens the release-signed APK download while keeping Android install confirmation.

## v1.3.2

- Added first-class vault item types for Email Account, Bank Account, Crypto Wallet / Seed, Domain / DNS, and Server / Hosting Account.
- Added Library filters/sections, Generator detail panels, Dashboard counts, encrypted sync retention, and browser regression coverage for the new item types.
- Added local Security Audit heuristics for bank PIN storage, crypto seed/private key handling, domain expiry, and privileged server usernames.

## v1.3.1

- Published release-signed Android APK/AAB assets for the stable `in.indevs.ciphora` Android application ID.
- Added downloadable GitHub Release artifacts for Web/PWA, Android, Windows, Linux, and SHA-256 checksums.
- Added Ciphora PWA, Tauri desktop, and Capacitor Android packaging foundations.
- Added expanded vault item types including SSH keys, identities, API keys, Wi-Fi entries, recovery codes, software licenses, and database credentials.
- Added account-backed recovery, device/session management, email verification, and BYODB sync profile foundations.
- Added hardened Turso, D1 Bridge, D1 Direct, and HTTP Bridge-compatible BYODB sync paths with safer delta writes and conflict metadata.

## Notes

- Android users who installed an older debug-signed APK may need one uninstall before moving to the release-signed update track.
- Windows and Linux desktop bundles are currently unsigned.
- Independent cryptographic review remains pending.

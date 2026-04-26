# Changelog

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

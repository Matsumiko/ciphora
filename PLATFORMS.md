# Ciphora Platform Packaging

This document tracks how the same Ciphora web runtime is packaged across web, PWA, desktop, and Android.

## Architecture

| Layer | Runtime | Source of UI | Backend/API |
| --- | --- | --- | --- |
| Web App | Cloudflare Pages | Vite `dist/` | Same-origin Pages Functions |
| PWA | Cloudflare Pages + browser install | Vite `dist/` + web manifest + service worker | Same-origin Pages Functions |
| Desktop | Tauri v2 WebView | Bundled Vite `dist/` | Production API through native-origin CORS allowlist |
| Android | Capacitor v8 WebView | Bundled Vite `dist/` copied by `cap sync android` | Production API through native-origin CORS allowlist |
| iOS | Safari PWA | Cloudflare Pages | Same-origin Pages Functions |

## Web App

Primary target remains Cloudflare Pages.

```bash
npm run build
npx wrangler pages deploy dist --project-name ciphora --branch main
```

For a fork or self-hosted deployment, copy `wrangler.example.toml` to
`wrangler.toml` and replace the placeholder D1 resources with your own
Cloudflare account resources before deploying Pages Functions.

## GitHub Release Downloads

Release assets are produced by `.github/workflows/release.yml`.

Triggers:

- Push a tag matching `v*`, for example `v1.3.0`.
- Or run **Release Builds** manually from GitHub Actions and provide a tag.

Example:

```bash
git tag v1.3.0
git push origin v1.3.0
```

The workflow builds and attaches these downloadable assets to the GitHub Release:

- `ciphora_<version>_web_dist.zip` - static Cloudflare Pages/PWA build output
- `ciphora_<version>_android.apk` - release-signed Android APK for manual install/update
- `ciphora_<version>_android.aab` - release-signed Android App Bundle for Play Store/internal testing tracks
- `ciphora_<version>_windows_x64.exe` - Windows NSIS installer
- `ciphora_<version>_windows_x64.msi` - Windows MSI installer
- `ciphora_<version>_linux_x64.AppImage` - Linux AppImage
- `ciphora_<version>_linux_x64.deb` - Debian/Ubuntu package
- `ciphora_<version>_linux_x64.rpm` - Fedora/RHEL package
- `SHA256SUMS.txt` - checksums for all uploaded assets

Important release-state rules:

- Android update installs require a stable `applicationId` and signing certificate. Ciphora uses `in.indevs.ciphora` plus the configured release signing key for release assets.
- Older debug-signed APK installs cannot be updated in-place by the release-signed APK unless they used the same signing certificate. Those users need a one-time uninstall before joining the release track.
- Android signing material is stored outside Git. GitHub Actions expects `CIPHORA_ANDROID_KEYSTORE_BASE64`, `CIPHORA_ANDROID_KEYSTORE_PASSWORD`, and `CIPHORA_ANDROID_KEY_PASSWORD`; the runner auto-detects the PKCS12 signing alias.
- Windows and Linux desktop bundles are currently unsigned, so OS warning dialogs are expected until platform signing is configured.
- GitHub Releases automatically add source-code ZIP/TAR archives in addition to Ciphora's uploaded assets.

## PWA

Files:

- `public/manifest.webmanifest`
- `public/sw.js`
- `public/pwa/192x192.png`
- `public/pwa/512x512.png`
- `src/pwa.ts`

The service worker is conservative:

- It only registers in production over `http:` or `https:`.
- It never intercepts non-GET requests.
- It bypasses `/api/`, `/cdn-cgi/`, and internal Cloudflare/runtime paths.
- It uses network-first navigation so security/runtime updates are not held behind stale cache.
- It only stale-while-revalidates static assets, brand assets, PWA icons, and the manifest.

## Desktop: Tauri

Files:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- `src-tauri/icons/`

Commands:

```bash
npm run desktop:dev
npm run desktop:build
npm run desktop:build:windows
npm run desktop:build:linux
```

Requirements:

- Rust/Cargo.
- Windows: Microsoft WebView2 runtime and Windows build tooling.
- Linux: WebKitGTK/Tauri Linux dependencies, plus `rpm` if building `.rpm`.

Security posture:

- Default Tauri capability grants no native filesystem, shell, dialog, or OS permissions.
- CSP is scoped to self-hosted app assets and HTTPS/WSS provider connections.
- Native API access is restricted by backend origin allowlist, not a wildcard CORS policy.

## Android: Capacitor

Files:

- `capacitor.config.ts`
- `android/`

Commands:

```bash
npm run mobile:sync
npm run mobile:android
npm run mobile:android:debug
npm run mobile:android:apk
npm run mobile:android:aab
```

Requirements:

- JDK 21.
- Android SDK / Android Studio.
- Release signing environment or Gradle properties for APK/AAB release builds.

Security posture:

- Android backup is disabled in `AndroidManifest.xml` because Ciphora stores encrypted local vault state in app storage.
- Keystores are ignored by Git and must be stored in secret storage. GitHub Release builds decode the release keystore from repository secrets at runtime.
- Generated copied web assets under `android/app/src/main/assets/public` are ignored; run `npm run mobile:sync` before native builds.

Release signing variables:

- `CIPHORA_ANDROID_KEYSTORE_FILE` - local path to the `.p12`/keystore file.
- `CIPHORA_ANDROID_KEYSTORE_PASSWORD` - keystore password.
- `CIPHORA_ANDROID_KEY_ALIAS` - signing key alias.
- `CIPHORA_ANDROID_KEY_PASSWORD` - signing key password.
- `CIPHORA_ANDROID_KEYSTORE_TYPE` - optional, defaults to `pkcs12`.
- `CIPHORA_ANDROID_VERSION_NAME` and `CIPHORA_ANDROID_VERSION_CODE` - optional overrides; GitHub Releases derive both from the `v*` tag.

## Native API Origin Model

The web app uses same-origin `/api/...` calls. Bundled native shells run under native WebView origins, so `src/lib/account-client.ts` resolves account API calls to `https://app.ciphora.indevs.in` when it detects Tauri or Capacitor packaged origins.

Backend Functions allow only these native origins for credentialed CORS:

- `capacitor://localhost`
- `https://localhost`
- `ionic://localhost`
- `http://tauri.localhost`
- `https://tauri.localhost`
- `tauri://localhost`

For normal browser sessions, Ciphora keeps same-origin behavior and `SameSite=Lax` cookies. For native-origin account sessions, the backend sets `SameSite=None; Secure` so the bundled app can retain its session cookie in the WebView cookie jar.

## iOS

Native iOS is intentionally deferred. Use the PWA route:

1. Open `https://app.ciphora.indevs.in` in Safari.
2. Use Share -> Add to Home Screen.

Native iOS requires macOS, Xcode, and an Apple Developer account before Capacitor iOS can be treated as a real deliverable.

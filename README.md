# Ciphora

Ciphora is a local-first encrypted vault for passwords, TOTP authenticators, secure notes, recovery codes, software licenses, database credentials, and user-owned sync.

The web app is designed to run on Cloudflare Pages. Vault content is encrypted in the browser before backup or sync. Ciphora account services are used for login, recovery gates, email verification, device/session metadata, and encrypted sync-profile storage; they are not designed to receive plaintext vault items, master passwords, recovery keys, or BYODB provider tokens.

## Features

- Local encrypted vault with browser-side encryption.
- Password, TOTP, secure note, card, SSH key, identity, API key, Wi-Fi, recovery code, software license, and database credential item types.
- Optional BYODB sync profiles for Turso, D1 Bridge, D1 Direct, and Ciphora-compatible HTTP Bridge providers.
- OPAQUE-backed account login foundation with recovery-key and email-gated recovery flows.
- Installable PWA, Tauri desktop scaffold, and Capacitor Android scaffold.
- GitHub Release automation for web, Android, Windows, and Linux artifacts.

## App Targets

| Target | Platform | Status | Output |
| --- | --- | --- | --- |
| Web App | Cloudflare Pages | Primary app runtime | Browser desktop/mobile |
| PWA | Cloudflare Pages | Installable from supported browsers | Add to Home Screen / desktop install |
| Desktop | Tauri v2 | Windows and Linux scaffold | `.exe` / `.msi` / `.AppImage` / `.deb` / `.rpm` |
| Android | Capacitor v8 | Release-signed workflow-ready | APK / AAB |
| iOS | PWA | Native iOS deferred | Safari Add to Home Screen |

## Development

```bash
npm install
npm run typecheck
npm run typecheck:functions
npm run build
```

Run locally:

```bash
npm run dev
```

## Packaging

PWA/web:

```bash
npm run build
```

Android:

```bash
npm run mobile:sync
npm run mobile:android:debug
npm run mobile:android:apk
npm run mobile:android:aab
```

Desktop:

```bash
npm run desktop:build:windows
npm run desktop:build:linux
```

Native builds require the appropriate local toolchains. Android release builds require signing configuration through environment variables or GitHub repository secrets.

## Releases

The `Release Builds` workflow publishes downloadable builds when a `v*` tag is pushed:

```bash
git tag v1.3.1
git push origin v1.3.1
```

Release assets include:

- `ciphora_<version>_web_dist.zip`
- `ciphora_<version>_android.apk`
- `ciphora_<version>_android.aab`
- `ciphora_<version>_windows_x64.exe`
- `ciphora_<version>_windows_x64.msi`
- `ciphora_<version>_linux_x64.AppImage`
- `ciphora_<version>_linux_x64.deb`
- `ciphora_<version>_linux_x64.rpm`
- `SHA256SUMS.txt`

Android release assets are signed by GitHub Actions using repository secrets. Do not commit keystores, passwords, tokens, or local `.env` files.

## Cloudflare Pages

This public repository ships a placeholder `wrangler.example.toml`. Copy it to `wrangler.toml` and replace the database IDs, names, and environment variables with your own Cloudflare resources before deploying.

```bash
cp wrangler.example.toml wrangler.toml
npm run build
npx wrangler pages deploy dist --project-name ciphora --branch main
```

## Security Status

Ciphora is under active development. The current implementation includes browser-side encryption, OPAQUE-backed account authentication, recovery-key ceremonies, and BYODB sync hardening, but it has not completed an independent cryptographic audit or formal OWASP ASVS certification. Do not market forks or downstream builds as independently audited unless that review has actually happened.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT. See [LICENSE](LICENSE).

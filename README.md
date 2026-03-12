# OpenClaw Desktop Installer (GUI)

[中文说明](./README-zh.md)

OpenClaw Desktop Installer is a **graphical OpenClaw installer** and launcher built with Tauri.  
It is designed for everyday users who want to install and use OpenClaw with a simple GUI, without terminal-heavy setup.

Keywords: OpenClaw installer, OpenClaw GUI, OpenClaw desktop app, OpenClaw for Windows, OpenClaw for macOS, OpenClaw for Linux.

## Engineering Rule (TypeScript First)

- New logic must be written in TypeScript (`.ts` / `.tsx`).
- Existing JavaScript logic should be migrated to TypeScript whenever touched.
- Keep JavaScript only for third-party/vendor code that is not maintained by this repo.

## Why this project

- Graphical installation and first-run setup
- Simple onboarding for non-technical users
- Cross-platform desktop packages
- Smaller footprint than typical Electron wrappers

## Main features

- GUI setup wizard for first launch
- Easy configuration for:
  - Provider
  - Model
  - API Key
  - Base URL (for custom provider)
  - Skills directories (optional)
- Bundled OpenClaw kernel in the installer
- Optional one-click kernel update via npm
- One-click launch into OpenClaw Web dashboard
- Works on Windows, macOS, and Linux

## Supported platforms

- Windows: `MSI` / `NSIS`
- macOS: `DMG`
- Linux: `AppImage` / `deb` / `rpm`

Build artifacts are generated under:

```text
desktop/src-tauri/target/release/bundle/
```

## End-user flow

1. Install the app package for your OS.
2. Open the app and complete the setup wizard.
3. Fill required fields (`Provider`, `Model`, `API Key`).
4. (Optional) Set `Base URL` and `Skills`.
5. Click **Start Using** to enter OpenClaw Web.

## OpenClaw kernel behavior

The app supports multiple kernel sources with fallback:

1. Custom command from Advanced settings
2. Managed kernel installed by user update
3. Bundled kernel shipped in installer
4. `resources/bin/openclaw` (if provided)
5. System `openclaw` from PATH

## Build from source

Prerequisites:

- Node.js 20+
- Rust toolchain

Install and run:

```bash
npm install
npm run dev
```

## Package commands

```bash
# default build for current OS
npm run dist

# platform-specific
npm run dist:win
npm run dist:mac
npm run dist:linux
```

CI-focused commands:

```bash
npm run dist:win:ci
npm run dist:linux:ci
npm run dist:linux:appimage
```

## Configuration file locations

- macOS: `~/Library/Application Support/dev.openclawapp.desktop/openclaw.config.json`
- Linux: `~/.config/dev.openclawapp.desktop/openclaw.config.json`
- Windows: `%APPDATA%/dev.openclawapp.desktop/openclaw.config.json`

### Communication channel config (Desktop Agent host)

The Desktop "Communication Channels" module reads these fields from `openclaw.config.json`:

```json
{
  "channelServerBaseUrl": "http://192.168.1.20:38089",
  "channelDeviceId": "pc_agent_001"
}
```

Notes:

- `channelServerBaseUrl` must be a reachable `http/https` URL for both desktop and mobile devices.
- `channelDeviceId` is the fixed identity of the desktop Agent host.
- These fields are intentionally not editable in the desktop channel UI.

## CI/CD

GitHub Actions builds installers on push and pull request.  
Tag pushes (`v*`) can publish release assets automatically.

Workflow file:

```text
.github/workflows/build.yml
```

### macOS signing and notarization in GitHub Actions

To distribute a macOS app without Gatekeeper damage warnings, configure these repository secrets:

- `APPLE_CERTIFICATE_P12`: Base64-encoded Developer ID Application certificate (`.p12`)
- `APPLE_CERTIFICATE_PASSWORD`: Password of the `.p12` file
- `APPLE_SIGN_IDENTITY`: Signing identity, for example `Developer ID Application: Your Name (TEAMID)`
- `APPLE_KEYCHAIN_PASSWORD` (optional): Temporary keychain password in CI
- `APPLE_ID`: Apple ID email for notarization
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password for the Apple ID
- `APPLE_TEAM_ID`: Apple Developer Team ID

Behavior:

- If cert secrets are provided, CI signs `.app` and `.dmg` with Developer ID.
- If notarization secrets are also provided, CI submits and staples the `.dmg`.
- If secrets are missing, CI falls back to ad-hoc signing for internal testing.

### Windows code signing in GitHub Actions

To reduce Microsoft Defender SmartScreen warnings, configure these repository secrets:

- `WINDOWS_CERTIFICATE_PFX`: Base64-encoded code-signing certificate (`.pfx`)
- `WINDOWS_CERTIFICATE_PASSWORD`: Password of the `.pfx` file
- `WINDOWS_TIMESTAMP_URL` (optional): RFC3161 timestamp URL (default: `http://timestamp.digicert.com`)

Behavior:

- If Windows signing secrets are set, CI signs generated `.msi` installers.
- If secrets are missing, CI still builds but skips Windows signing.

Note:

- SmartScreen reputation is not only about "signed or not". New OV certificates may still show warnings initially.
- EV certificates usually establish reputation faster for public distribution.

## License

MIT. See [LICENSE](./LICENSE).

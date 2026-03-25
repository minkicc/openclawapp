# OpenClaw Desktop Installer (GUI)

[中文说明](./README-zh.md)

OpenClaw Desktop Installer is a **graphical OpenClaw installer** and launcher built with Tauri.
It is designed for everyday users who want to install and use OpenClaw with a simple GUI, without terminal-heavy setup.

Keywords: OpenClaw installer, OpenClaw GUI, OpenClaw desktop app, OpenClaw for Windows, OpenClaw for macOS, OpenClaw for Linux.

## Why this project

- Graphical installation and first-run setup
- Simple onboarding for non-technical users
- Cross-platform desktop packages
- Smaller footprint than typical Electron wrappers
- Standalone desktop host for the remote pairing channel

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
- Pairing state machine skeleton for remote-control workflow (`src/pairing/state-machine.js`)
- Pairing API and controller skeleton (`src/pairing/api-client.js`, `src/pairing/controller.js`)
- `v2` desktop peer host built on reusable SDK packages
- Works on Windows, macOS, and Linux

## SDK boundaries

- `@openclaw/pair-sdk`: discovery / auth / pairing / signaling / peer-auth transport
- `@openclaw/message-sdk`: OpenClaw business message modules used on the peer channel

## Workspace peers

- `../server`: pairing / signaling control plane and protocol landing page
- `../mobile`: official React Native mobile client consuming the same SDKs
- `../packages/pair-sdk`: reusable control-plane + peer-auth transport SDK
- `../packages/message-sdk`: OpenClaw app-message SDK layered on top of the pair transport

## Supported platforms

- Windows: `MSI` / `NSIS`
- macOS: `DMG`
- Linux: `AppImage` / `deb` / `rpm`

Build artifacts are generated under:

```text
src-tauri/target/release/bundle/
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
# from repository root
npm run dev
npm run dist:mac

# or run directly in desktop directory
npm --prefix desktop run dev
npm --prefix desktop run dist:mac
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

## macOS DMG appearance

`npm run dist:mac` now produces a styled drag-to-install `DMG` window with:

- a generated background image
- fixed `OpenClaw` / `Applications` icon positions
- a consistent Finder window size

You can fine-tune the layout with environment variables before building:

```bash
DMG_WINDOW_WIDTH=760 \
DMG_WINDOW_HEIGHT=500 \
DMG_APP_ICON_X=210 \
DMG_APPS_ICON_X=550 \
npm run dist:mac
```

Supported overrides:

- `DMG_PRODUCT_NAME`
- `DMG_VOLUME_NAME`
- `DMG_WINDOW_WIDTH`
- `DMG_WINDOW_HEIGHT`
- `DMG_ICON_SIZE`
- `DMG_TEXT_SIZE`
- `DMG_APP_ICON_X`
- `DMG_APP_ICON_Y`
- `DMG_APPS_ICON_X`
- `DMG_APPS_ICON_Y`

## Configuration file locations

- macOS: `~/Library/Application Support/dev.openclawapp.desktop/openclaw.config.json`
- Linux: `~/.config/dev.openclawapp.desktop/openclaw.config.json`
- Windows: `%APPDATA%/dev.openclawapp.desktop/openclaw.config.json`

## CI/CD

GitHub Actions builds installers on push and pull request.
Tag pushes (`v*`) can publish release assets automatically.

Workflow file:

```text
../.github/workflows/build.yml
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

To reduce Microsoft Defender SmartScreen warnings, you can configure either SSL.com eSigner secrets or a local `.pfx` certificate in GitHub Actions.

Recommended for cloud signing with SSL.com eSigner:

- `ES_USERNAME`: SSL.com account username
- `ES_PASSWORD`: SSL.com account password
- `ES_CREDENTIAL_ID`: eSigner credential ID for the code-signing certificate
- `ES_TOTP_SECRET`: OAuth TOTP secret for automated signing

Fallback option for local PFX-based signing:

- `WINDOWS_CERTIFICATE_PFX`: Base64-encoded code-signing certificate (`.pfx`)
- `WINDOWS_CERTIFICATE_PASSWORD`: Password of the `.pfx` file
- `WINDOWS_TIMESTAMP_URL` (optional): RFC3161 timestamp URL (default: `http://timestamp.digicert.com`)

Behavior:

- Windows installer signing runs only for tag pushes matching `v*`.
- If the eSigner secrets are set, CI signs the generated `.msi` with `SSLcom/esigner-codesign`.
- If the eSigner secrets are missing but PFX secrets are set, CI falls back to `signtool.exe`.
- If neither set is configured, Windows builds still succeed but installer signing is skipped.

Note:

- SmartScreen reputation is not only about "signed or not". New OV certificates may still show warnings initially.
- EV certificates usually establish reputation faster for public distribution.

## License

MIT. See [LICENSE](../LICENSE).

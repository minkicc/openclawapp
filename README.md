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

## CI/CD

GitHub Actions builds installers on push and pull request.  
Tag pushes (`v*`) can publish release assets automatically.

Workflow file:

```text
.github/workflows/build.yml
```

## License

MIT. See [LICENSE](./LICENSE).

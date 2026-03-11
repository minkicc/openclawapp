# OpenClaw App Monorepo

This repository is organized into three application domains:

- `desktop`: OpenClaw desktop installer and launcher (Tauri)
- `mobile`: OpenClaw mobile client (scaffold)
- `server`: OpenClaw server side (scaffold)

Shared or cross-domain modules live under:

- `packages/protocol`: shared message schemas and protocol contracts
- `packages/sdk-client`: shared client SDK layer

## Desktop App

The current production-ready app is desktop.

- English docs: `desktop/README.md`
- Chinese docs: `desktop/README-zh.md`

Quick start:

```bash
cd desktop
npm install
npm run dev
```

## Repository Layout

```text
openclawapp/
  desktop/
  mobile/
  server/
  packages/
    protocol/
    sdk-client/
  docs/
  .github/
```

## License

MIT. See `LICENSE`.

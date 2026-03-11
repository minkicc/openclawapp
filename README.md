# OpenClaw App Monorepo

This repository is organized into three application domains:

- `apps/desktop`: OpenClaw desktop installer and launcher (Tauri)
- `apps/mobile`: OpenClaw mobile client (scaffold)
- `apps/server`: OpenClaw server side (scaffold)

Shared or cross-domain modules live under:

- `packages/protocol`: shared message schemas and protocol contracts
- `packages/sdk-client`: shared client SDK layer

## Desktop App

The current production-ready app is desktop.

- English docs: `apps/desktop/README.md`
- Chinese docs: `apps/desktop/README-zh.md`

Quick start:

```bash
cd apps/desktop
npm install
npm run dev
```

## Repository Layout

```text
openclawapp/
  apps/
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

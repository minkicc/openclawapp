# OpenClaw Mobile MVP (Web)

This is a minimal mobile-side web page for integration testing:

- Parse QR payload JSON
- Claim pair session (`POST /pair/claim`)
- Connect mobile channel (`/ws/mobile`)
- Send `task.create` to PC

## Run

From repository root:

```bash
npm run mobile:dev
```

Build:

```bash
npm run mobile:build
```

## Notes

- This is not a production mobile app yet.
- It is intended for fast protocol and flow validation.
- If server enables `OPENCLAW_SERVER_TOKEN`, fill the optional token input for both claim and websocket.
- Mobile logic entry is `src/main.ts` (TypeScript-first rule).

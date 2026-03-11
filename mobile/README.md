# OpenClaw Mobile MVP (Web)

This is a minimal mobile-side web page for integration testing.

## Current scope

- Parse QR payload JSON
- Claim pair session (`POST /v1/pair/claim`)
- Claim pair session by code (`POST /v1/pair/claim-by-code`)
- Receive signaling via SSE (`GET /v1/signal/stream`)
- Send relay signaling (`POST /v1/signal/send`)

## Project structure

- `package.json`
- `src/`
- `src/pairing/state-machine.js` (pairing flow state machine skeleton)
- `src/pairing/api-client.js`, `src/pairing/controller.js` (pairing API + controller skeleton)

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
- Mobile logic entry is `src/main.ts` (TypeScript-first rule).
- WebSocket endpoints are reserved in current scaffold stage; use SSE + HTTP signaling first.

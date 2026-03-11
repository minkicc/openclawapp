# OpenClaw Server (MVP)

Minimal pairing and signaling server for desktop/mobile integration.

Current implementation is an in-memory MVP for protocol and flow validation.

## Endpoints

- `GET /healthz`
- `POST /v1/devices/register`
- `POST /v1/devices/heartbeat`
- `GET /v1/devices/:deviceId/status`
- `POST /v1/pair/sessions`
- `POST /v1/pair/claim`
- `POST /v1/pair/claim-by-code`
- `POST /v1/pair/revoke`
- `GET /v1/pair/bindings`
- `POST /v1/signal/send`
- `GET /v1/signal/inbox`
- `GET /v1/signal/stream` (SSE)

Reserved placeholders (`501`):

- `GET /ws/desktop`
- `GET /ws/mobile`

Use `/v1/signal/stream` + `/v1/signal/send` as the relay channel during this stage.

## Run

From repository root:

```bash
npm --prefix server run dev
```

Or:

```bash
cd server
npm run start
```

## Environment variables

- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `8787`)

## Notes

- No external runtime dependencies (Node built-ins only).
- Data is in-memory and will reset on restart.
- This MVP is intended for integration scaffolding, not production hardening.
- API contract draft lives in `openapi/openapi.yaml`.

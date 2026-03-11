# OpenClaw Server (MVP)

Minimal pairing and signaling server for desktop/mobile integration.

Current implementation is a Go MVP with optional Redis snapshot persistence.

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
go run .
```

## Integration Test (Redis Online)

Run end-to-end Redis integration checks (restart recovery + cross-instance pub/sub + inbox consistency):

```bash
npm --prefix server run test:integration:redis
```

## Environment variables

- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `8787`)
- `STORE_BACKEND` (default: `memory`, optional: `redis`)
- `REDIS_URL` (default: `redis://127.0.0.1:6379`, used when `STORE_BACKEND=redis`)
- `REDIS_KEY_PREFIX` (default: `openclaw:server`)

### Persistence choice

- Recommended for current pairing/signaling workload: `Redis`
- Why: low-latency read/write + native TTL pattern for short-lived session data
- Redis mode stores native keys/hashes/queues and uses Pub/Sub for cross-instance realtime relay
- Keep `MySQL` for later long-term history/audit reporting, not first-stage signaling hot path

## Notes

- Server runtime is Go (`go1.24+`).
- Default data mode is in-memory and resets on restart.
- When `STORE_BACKEND=redis`, state is restored/saved from Redis snapshot.
- This MVP is intended for integration scaffolding, not production hardening.
- API contract draft lives in `openapi/openapi.yaml`.

# Remote Pairing MVP API

Current implementation is the Go server at `server/main.go`.

## API Source of Truth

- HTTP behavior: `server/main.go`
- API contract draft: `server/openapi/openapi.yaml`

## Runtime

- Default: in-memory store
- Optional Redis mode:
  - `STORE_BACKEND=redis`
  - `REDIS_URL=redis://127.0.0.1:6379`
  - `REDIS_KEY_PREFIX=openclaw:server`

Redis mode uses native hashes/keys/queues and pub/sub for cross-instance signal relay.

## Endpoints (MVP)

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

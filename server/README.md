# OpenClaw Server (MVP)

Minimal pairing and signaling server for desktop/mobile integration.

Current implementation is a Go MVP with optional Redis snapshot persistence.

`v2` is also available as the new identity-key-based pairing flow. See `../docs/remote-pairing-v2.md`.

The server now also exposes a small protocol landing page:

- `GET /` — protocol overview and SDK entry page
- `GET /protocol` — same landing page, stable explicit route

## Workspace peers

- `../desktop`: desktop host app built on the shared pairing/message SDKs
- `../mobile`: official React Native mobile client
- `../packages/pair-sdk`: reusable discovery / pairing / signaling / peer-auth SDK
- `../packages/message-sdk`: OpenClaw business message SDK on top of the pair transport
- `../server-worker`: Cloudflare Worker + Durable Object deployment for the `v2` control plane

## Endpoints

- `GET /healthz`
- `GET /`
- `GET /protocol`
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

## v2 endpoints

- `POST /v2/auth/challenge`
- `POST /v2/auth/login`
- `POST /v2/presence/announce`
- `POST /v2/presence/heartbeat`
- `POST /v2/presence/query`
- `POST /v2/pair/sessions`
- `POST /v2/pair/claims`
- `POST /v2/pair/approvals`
- `GET /v2/ice-servers`
- `POST /v2/signal/send`
- `GET /v2/signal/stream` (SSE)

Reserved placeholders (`501`):

- `GET /ws/desktop`
- `GET /ws/mobile`

Use `/v1/signal/stream` + `/v1/signal/send` as the relay channel during this stage.

## Run

From repository root:

```bash
npm run server:dev
```

Or:

```bash
cd server
go run .
```

Then open [http://127.0.0.1:8787/](http://127.0.0.1:8787/) to view the protocol introduction page.

## Compatibility test

Run the protocol compatibility test from repository root:

```bash
npm run test:compat:pair-v2
```

## SDKs

The reusable client SDKs live in the workspace root:

- `../packages/pair-sdk`: business-agnostic discovery / pairing / signaling / peer-auth SDK
- `../packages/message-sdk`: OpenClaw business message SDK built on top of `pair-sdk`

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
- `V2_ICE_SERVERS_JSON` (optional): JSON array returned by `GET /v2/ice-servers`
- `V2_ICE_TTL_SECONDS` (default: `600`): client cache TTL for `/v2/ice-servers`

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
- `v2` state is currently in-memory first. Redis-backed cross-instance signal fanout still works through the shared signal queue path.

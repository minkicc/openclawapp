# OpenClaw Server (MVP)

Minimal pairing and message-routing server for desktop/mobile long-lived connection.

## Endpoints

- `GET /health`
- `POST /pair/create`
- `POST /pair/claim`
- `GET /pair/status?session_id=...`
- `POST /pair/revoke`
- `WS /ws/pc?device_id=...`
- `WS /ws/mobile?user_id=...`

## Run

```bash
cd server
npm run start
```

## Run with Docker

From repository root:

```bash
docker compose up -d openclaw-server
```

Check health:

```bash
curl http://127.0.0.1:38089/health
```

Stop:

```bash
docker compose down
```

## Environment Variables

- `HOST` default `0.0.0.0`
- `PORT` default `38089`
- `PUBLIC_BASE_URL` default `http://127.0.0.1:$PORT`
- `PAIR_TTL_SECONDS` default `120`
- `STORE_PATH` optional; if set, persist sessions/bindings to JSON file
- `OPENCLAW_SERVER_TOKEN` optional shared token for HTTP/WS auth

## Optional Auth

If `OPENCLAW_SERVER_TOKEN` is configured:

- HTTP requests must include `Authorization: Bearer <token>`
- WebSocket upgrade must include:
  - query: `?token=<token>` (recommended for current MVP), or
  - header: `Authorization: Bearer <token>`

## Notes

- No external dependencies are required.
- Storage can be in-memory (default) or persisted to file via `STORE_PATH`.
- This MVP is for protocol and flow validation, not production hardening.
- Docker files:
  - `server/Dockerfile`
  - `docker-compose.yml` (repo root)

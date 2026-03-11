# Remote Pairing MVP API

This document matches the implementation in `server/src/index.ts`.

## HTTP

If `OPENCLAW_SERVER_TOKEN` is configured, all HTTP routes except `/health` require:

```http
Authorization: Bearer <token>
```

## `GET /health`

Response:

```json
{
  "ok": true,
  "service": "openclaw-server-mvp",
  "time": "2026-03-11T03:00:00.000Z",
  "stats": {}
}
```

## `POST /pair/create`

Request body:

```json
{
  "device_id": "pc_demo_1",
  "device_name": "KC MacBook",
  "ttl_seconds": 120
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "session_id": "uuid",
    "pair_code": "hex",
    "device_id": "pc_demo_1",
    "status": "pending",
    "expires_at": "2026-03-11T03:02:00.000Z",
    "qr_payload": {
      "kind": "openclaw.pair",
      "version": "v1",
      "base_url": "http://127.0.0.1:38089",
      "session_id": "uuid",
      "pair_code": "hex",
      "expires_at": "..."
    }
  }
}
```

## `POST /pair/claim`

Request body:

```json
{
  "session_id": "uuid",
  "pair_code": "hex",
  "user_id": "user_demo_1"
}
```

Success response:

```json
{
  "ok": true,
  "data": {
    "session_id": "uuid",
    "status": "claimed",
    "device_id": "pc_demo_1",
    "user_id": "user_demo_1"
  }
}
```

Error mapping:

- `404` session not found
- `410` expired/revoked
- `409` already claimed
- `401` invalid pair code

## `GET /pair/status?session_id=...`

Response:

```json
{
  "ok": true,
  "data": {
    "session_id": "uuid",
    "status": "pending|claimed|expired|revoked",
    "device_id": "pc_demo_1",
    "user_id": "user_demo_1",
    "ttl_remaining_seconds": 87
  }
}
```

## `POST /pair/revoke`

Request body:

```json
{
  "device_id": "pc_demo_1",
  "user_id": "user_demo_1"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "device_id": "pc_demo_1",
    "revoked_at": "2026-03-11T03:10:00.000Z"
  }
}
```

## WebSocket

- PC: `ws://host:port/ws/pc?device_id=pc_demo_1`
- Mobile: `ws://host:port/ws/mobile?user_id=user_demo_1`

If `OPENCLAW_SERVER_TOKEN` is configured, add `token` query:

- PC: `ws://host:port/ws/pc?device_id=pc_demo_1&token=...`
- Mobile: `ws://host:port/ws/mobile?user_id=user_demo_1&token=...`

Each frame is a JSON envelope:

```json
{
  "message_id": "uuid",
  "type": "task.create",
  "payload": {},
  "session_id": null,
  "task_id": null,
  "device_id": null,
  "user_id": null,
  "target_device_id": "pc_demo_1",
  "target_user_id": null,
  "timestamp": "2026-03-11T03:00:00.000Z"
}
```

## Supported message types

- `pair.ready`
- `pair.claimed`
- `pair.revoked`
- `task.create`
- `task.accepted`
- `task.progress`
- `task.result`
- `task.error`
- `ack`
- `heartbeat`

## Routing rules (MVP)

- Mobile -> PC:
  - must include `target_device_id` (or `device_id`)
  - server verifies target device is bound to this mobile user
  - if valid, forwards to bound PC sockets
- PC -> Mobile:
  - server derives bound user from `device_id` (socket context)
  - forwards to that user sockets
- Non-`ack` messages get an `ack` response from server with `delivered_count`

## Sequence (pair + task)

1. PC opens `/ws/pc?device_id=...`
2. PC calls `POST /pair/create`
3. Mobile scans QR payload
4. Mobile calls `POST /pair/claim`
5. Server emits `pair.claimed` to PC and mobile
6. Mobile sends `task.create` via websocket
7. PC sends `task.progress` / `task.result`

## Limitations in this MVP

- State persistence depends on `STORE_PATH`:
  - unset: in-memory only
  - set: persisted JSON snapshot
- No persistent auth provider yet
- No offline durable queue yet

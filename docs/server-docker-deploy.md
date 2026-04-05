# Server Docker Deployment

This repository now includes a production-oriented Docker deployment for `chnnl.net`.

## Included services

- `openclaw-server`: Go pairing/signaling server
- `redis`: persistence + cross-instance signaling backend
- `caddy`: reverse proxy with automatic Let's Encrypt certificates
- `trojan-go`: internal WebSocket proxy behind Caddy on `https://chnnl.net/wss-cgi/`

## Files

- `/Users/zhangruiqiang/dev/setupclaw/server-deploy/docker-compose.yml`
- `/Users/zhangruiqiang/dev/setupclaw/server-deploy/Caddyfile`
- `/Users/zhangruiqiang/dev/setupclaw/server-deploy/.env.example`
- `/Users/zhangruiqiang/dev/setupclaw/server/Dockerfile` (used when building the image locally before export)

## Prerequisites

1. Point the DNS for `chnnl.net` to your server public IP.
2. Point `www.chnnl.net` to the same IP if you want the redirect to work.
3. Open inbound ports `80` and `443`.
4. Install Docker Engine and Docker Compose plugin on the host.

## Deploy

```bash
cp .env.example .env
docker compose up -d
```

Then check:

```bash
docker compose ps
docker compose logs -f caddy
docker compose logs -f openclaw-server
docker compose logs -f trojan-go
```

## Notes

- Caddy will request and renew Let's Encrypt certificates automatically.
- The site serves both `https://chnnl.net` and `https://www.chnnl.net`, with `www` redirected to the apex domain.
- The Go server is only exposed to the internal Docker network on port `8787`; public traffic enters through Caddy on `80/443`.
- `trojan-go` is only exposed to the internal Docker network on port `8443`; public Trojan/WebSocket traffic must enter through Caddy on `443` and path `/wss-cgi/`.
- `trojan-go` password is configured only in `server-deploy/trojan.json`.
- Redis data is persisted in the named volume `redis_data`.
- Caddy certificate state is persisted in `caddy_data` and `caddy_config`.
- This deployment intentionally does not include TURN. The default `.env.example` ships a STUN-only `OPENCLAW_SERVER_V2_ICE_SERVERS_JSON` so clients will try direct WebRTC first and can fall back to server relay at the app layer.
- If you customize `OPENCLAW_SERVER_V2_ICE_SERVERS_JSON`, keep it STUN-only unless you explicitly plan to reintroduce TURN.

## Trojan Client Shape

When using the current Caddy-fronted setup, clients should connect with:

- server: `chnnl.net`
- port: `443`
- TLS: enabled
- transport: `ws`
- websocket path: `/wss-cgi/`
- host / SNI: `chnnl.net`
- password: the real Trojan password configured in `server-deploy/trojan.json`

Do not connect directly to `8443` in this setup. That port is now internal-only.

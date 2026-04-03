# Server Docker Deployment

This repository now includes a production-oriented Docker deployment for `chnnl.net`.

## Included services

- `openclaw-server`: Go pairing/signaling server
- `redis`: persistence + cross-instance signaling backend
- `caddy`: reverse proxy with automatic Let's Encrypt certificates
- `trojan-go`: separate TLS proxy on port `8443`, reusing the `chnnl.net` certificate issued by Caddy

## Files

- `/Users/zhangruiqiang/dev/setupclaw/docker-compose.yml`
- `/Users/zhangruiqiang/dev/setupclaw/Caddyfile`
- `/Users/zhangruiqiang/dev/setupclaw/.env.example`
- `/Users/zhangruiqiang/dev/setupclaw/server/Dockerfile`

## Prerequisites

1. Point the DNS for `chnnl.net` to your server public IP.
2. Point `www.chnnl.net` to the same IP if you want the redirect to work.
3. Open inbound ports `80`, `443`, and `8443`.
4. Install Docker Engine and Docker Compose plugin on the host.

## Deploy

```bash
cp .env.example .env
docker compose build
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
- `trojan-go` listens on `8443` by default and waits until Caddy has already issued the `chnnl.net` certificate.
- Redis data is persisted in the named volume `redis_data`.
- Caddy certificate state is persisted in `caddy_data` and `caddy_config`.
- If you need custom ICE servers, set `OPENCLAW_SERVER_V2_ICE_SERVERS_JSON` in `.env` to a JSON array string before `docker compose up -d`.

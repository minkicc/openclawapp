# OpenClaw Server Worker

Cloudflare Worker + Durable Object deployment for the OpenClaw `v2` pairing control plane.

Recommended production domain for this repo:

- `https://chnnl.net`
- `https://www.chnnl.net`

## What it serves

- `GET /`
- `GET /protocol`
- `GET /healthz`
- `GET /assets/protocol.css`
- `POST /v2/auth/challenge`
- `POST /v2/auth/login`
- `GET /v2/ice-servers`
- `POST /v2/presence/announce`
- `POST /v2/presence/heartbeat`
- `POST /v2/presence/query`
- `POST /v2/pair/sessions`
- `POST /v2/pair/claims`
- `POST /v2/pair/approvals`
- `POST /v2/pair/revoke`
- `GET /v2/bindings`
- `POST /v2/signal/send`
- `GET /v2/signal/stream`

`/v1/*` is intentionally not implemented here. Keep the Go server for legacy routes if needed.

## Run locally

```bash
npm install
cp server-worker/.dev.vars.example server-worker/.dev.vars
npm --prefix server-worker run dev
```

Wrangler local dev will read `server-worker/.dev.vars` automatically.

## Deploy

```bash
npm --prefix server-worker run deploy
```

Required secrets/environment in CI or local shell:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Optional Worker vars:

- `V2_ICE_SERVERS_JSON`
- `V2_ICE_TTL_SECONDS`

Recommended Cloudflare API token permissions:

- `Account` → `Workers Scripts:Edit`
- `Account` → `Workers Routes:Edit`
- `Zone` → `Workers Routes:Edit`
- `Zone` → `Zone Settings:Read`
- `Zone` → `Zone:Read`

## Domain routing

`wrangler.toml` is preconfigured for:

- `chnnl.net/*`
- `www.chnnl.net/*`

Before deploy, make sure:

1. `chnnl.net` has been added into your Cloudflare account.
2. Your registrar NS has been switched to Cloudflare.
3. The zone status in Cloudflare is `Active`.
4. DNS records for apex / `www` are proxied by Cloudflare.

After deploy, verify:

```bash
curl https://chnnl.net/healthz
curl https://chnnl.net/protocol
```

## GitHub Actions deployment

Workflow:

- `.github/workflows/deploy-worker.yml`

Repository secrets required:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Deployment triggers:

- push to `main` / `master` with changes under `server-worker/**`
- manual run from GitHub Actions `workflow_dispatch`

## Desktop / mobile configuration

Once the Worker is online, point both clients to:

```text
https://chnnl.net
```

For desktop config, set:

```json
{
  "channelServerBaseUrl": "https://chnnl.net"
}
```

## DMG release upload

The Cloudflare Worker deploy is separate from desktop release publishing.

The existing GitHub Actions workflow already uploads `.dmg` files to GitHub Releases on tag push:

- workflow: `.github/workflows/build.yml`
- release trigger: Git tag matching `v*`

Typical flow:

```bash
git push origin main
git tag v0.1.0
git push origin v0.1.0
```

If macOS signing / notarization secrets are configured, the uploaded DMG will be signed and notarized automatically.

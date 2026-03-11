# server

服务端目录（当前为 API + 路由骨架）。

当前内容：

- `openapi/openapi.yaml`: 配对与通信 API 草案
- `src/index.mjs`: HTTP 入口
- `src/router.mjs`: 路由分发（占位实现）
- `src/handlers/not-implemented.mjs`: 统一 501 返回

本地启动：

```bash
npm --prefix server run dev
```

当前可用：

- `GET /healthz`（200）

当前占位（返回 501）：

- `POST /v1/devices/register`
- `POST /v1/devices/heartbeat`
- `GET /v1/devices/:deviceId/status`
- `POST /v1/pair/sessions`
- `POST /v1/pair/claim`
- `POST /v1/pair/claim-by-code`
- `POST /v1/pair/revoke`
- `GET /v1/pair/bindings`

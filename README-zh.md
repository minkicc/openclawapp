# OpenClaw App Monorepo

仓库已按三端职责重组：

- `apps/desktop`：OpenClaw 桌面安装器与启动器（Tauri）
- `apps/mobile`：OpenClaw 移动端（骨架）
- `apps/server`：OpenClaw 服务端（骨架）

跨端共享模块位于：

- `packages/protocol`：共享协议与消息结构
- `packages/sdk-client`：共享客户端 SDK 层

## 桌面端说明

当前可直接使用的是桌面端：

- 英文文档：`apps/desktop/README.md`
- 中文文档：`apps/desktop/README-zh.md`

快速启动：

```bash
cd apps/desktop
npm install
npm run dev
```

## 目录结构

```text
openclawapp/
  apps/
    desktop/
    mobile/
    server/
  packages/
    protocol/
    sdk-client/
  docs/
  .github/
```

## 开源协议

MIT，见 `LICENSE`。

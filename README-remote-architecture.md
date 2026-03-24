# OpenClaw 扫码长连方案 README（草案）

## 1. 目标

本文档定义当前目标架构，覆盖三端协作：

- OpenClaw PC 端（桌面执行端）
- OpenClaw 移动端（远程控制端）
- OpenClaw 服务端（配对、鉴权、消息路由）

核心要求：

- 扫码一次后，建立长期远程关系。
- 移动端可持续与 PC 对话，并给 PC 派发任务（跨网络可用）。

## 2. 当前仓库现状

当前仓库本质上是 Tauri 桌面安装器/启动器，主要能力是本地配置和启动本地 OpenClaw Gateway。

现状要点：

- Gateway 主要是本地回环地址（`127.0.0.1`）使用。
- 桌面 UI 目前聚焦配置、内核安装/更新、进入本地 Dashboard。
- 本仓库还没有独立的移动端代码和独立服务端路由实现。

## 3. 角色划分

### 3.1 PC 端

- 运行 OpenClaw 执行环境并执行任务。
- 与服务端保持常驻出站长连接（WebSocket）。
- 首次配对时展示二维码。
- 接收任务并回传进度/结果。

### 3.2 移动端

- 扫码认领并绑定 PC 设备。
- 与绑定 PC 建立会话并发送任务。
- 接收任务进度和结果回执。

### 3.3 服务端

- 签发短时配对会话（pair session）。
- 校验移动端身份并绑定 `user_id <-> device_id`。
- 维护在线状态并执行双向消息路由。
- 存储长期绑定关系与可选离线消息队列。

## 4. 配对与长连接流程

1. PC 启动后连接 `wss://server/ws/pc`（携带设备凭证）。
2. PC 请求 `POST /pair/create`，服务端返回短时 `pair_session`。
3. PC 渲染二维码（只放一次性配对信息，不放长期密钥）。
4. 移动端扫码后调用 `POST /pair/claim`（携带用户登录态）。
5. 服务端完成绑定并通过 websocket 事件通知 PC。
6. 绑定完成后，移动端和 PC 通过服务端保持长期通信。
7. 该二维码会话过期后不可复用。

## 5. 通信与可靠性基线

- 统一消息封装字段：`message_id`、`session_id`、`device_id`、`user_id`、`type`、`payload`、`timestamp`。
- 任务状态流转：`task.create -> task.accepted -> task.progress -> task.result/error`。
- 每条业务消息都要求 ACK。
- 基于 `message_id`/`task_id` 做幂等处理。
- 客户端断线自动重连并使用退避策略重试。
- 服务端可对离线 PC 临时缓存待投递消息。

## 6. 安全基线

- 二维码内容短时、一次性。
- access token 短期有效，refresh/device credential 支持轮换。
- 可选二次确认（PC 显示 6 位码，移动端确认）防止误绑定。
- 仅允许 `https`/`wss`。
- 解绑/吊销设备后立即失效。

## 7. 当前项目目录结构划分

当前仓库可按职责划分为：

```text
openclawapp/
  desktop/            # 桌面端（前端 + Tauri 后端）
  resources/               # 打包资源（kernel/bin/skills）
  scripts/                 # 构建与打包脚本
  desktop/dist/       # 桌面前端构建产物（生成目录）
  vendor/                  # vendored 依赖（wry patch）
  .github/                 # CI 与仓库模板配置
```

说明：

- `desktop` 是当前桌面端主要业务代码目录。
- `mobile`、`server` 已有 MVP 代码。

## 8. 按当前方案扩展后的目录建议

如果后续三端都放在同一仓库，建议目录：

```text
openclawapp/
  desktop/                 # 桌面端（Tauri）
  mobile/                  # 官方移动端应用（React Native）
  server/                  # 服务端 API + WS 网关
  packages/
    protocol/              # 三端共享协议、事件、Schema
    sdk-client/            # 通用 ws/http 客户端 SDK
  resources/               # 桌面打包资源
  scripts/                 # monorepo 脚本
  docs/                    # 架构与接口文档
```

如果你希望职责更清晰，也可以采用多仓：

- `openclaw-desktop`
- `openclaw-mobile`
- `openclaw-server`
- （可选）`openclaw-protocol`

## 9. 下一步建议

先冻结协议和接口，再进入开发：

- 配对接口：`/pair/create`、`/pair/claim`、`/pair/revoke`
- 长连接入口：`/ws/pc`、`/ws/mobile`
- 事件协议与 ACK 规则
- 鉴权模型（用户 token + 设备凭证）

协议冻结后，优先做桌面端配对中心，再做服务端路由，最后接移动端交互。

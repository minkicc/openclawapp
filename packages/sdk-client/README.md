# sdk-client

通用客户端 SDK 目录（HTTP/WS 连接、鉴权、重连、ACK）。

当前骨架：

- `src/ack-tracker.mjs`: ACK 超时跟踪器
- `src/channel.mjs`: 通道抽象（P2P / Relay）
- `src/index.mjs`: 导出入口

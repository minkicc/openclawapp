# packages

共享模块目录。

- `protocol`: 三端共享协议/事件定义
- `pair-sdk`: 发现 / 配对 / 信令 / WebRTC 通道 / app dispatcher 通用 SDK
- `message-sdk`: OpenClaw 业务消息 SDK（当前含 chat module）
- `protocol`: 历史通用消息封装包，后续可继续收敛或退役
- `sdk-client`: 通用客户端 SDK（ACK/通道抽象骨架）

协议兼容性测试可在仓库根目录运行：

```bash
npm run test:compat:pair-v2
```

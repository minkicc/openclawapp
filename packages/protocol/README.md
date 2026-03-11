# protocol

三端共享协议定义目录（事件类型、消息封装、Schema）。

当前提供：

- `schemas/envelope.schema.json`: 统一消息包结构
- `schemas/payload-*.schema.json`: 常见 payload Schema（chat/task/signal）
- `examples/envelope-task-create.json`: 任务创建消息示例
- `src/index.mjs`: schema 注册表导出

校验：

```bash
npm --prefix packages/protocol run check
```

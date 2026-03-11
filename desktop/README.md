# desktop

桌面端应用目录（已完成迁移）。

工程规则：
- 新增/修改逻辑默认使用 TypeScript，避免新增 JavaScript 逻辑文件。

主要内容：

- `index.html` + `src/`: 桌面前端
- `src-tauri/`: Tauri/Rust 后端
- `scripts/`: 桌面打包与内核准备脚本

运行方式：

```bash
# 从仓库根目录
npm run dev
npm run dist:mac

# 或直接在 desktop 目录
npm --prefix desktop run dev
npm --prefix desktop run dist:mac
```

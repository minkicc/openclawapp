# OpenClaw 桌面安装器（图形化）

[English README](./README.md)

OpenClaw 桌面安装器是一个基于 Tauri 的 **OpenClaw 图形化安装与启动工具**。  
目标是让普通用户也能快速安装和使用 OpenClaw，尽量减少命令行操作门槛。

关键词：OpenClaw 安装器、OpenClaw 图形界面、OpenClaw 桌面版、Windows 安装 OpenClaw、Mac 安装 OpenClaw、Linux 安装 OpenClaw。

## 项目定位

- 图形化安装与首次配置
- 面向大众用户，操作简单
- 支持三大桌面系统
- 相比 Electron 包体更友好

## 主要特性

- 首次启动进入配置向导
- 可视化配置以下关键项：
  - Provider
  - Model
  - API Key
  - Base URL（Custom Provider 场景）
  - Skills 目录（可选）
- 安装包内置 OpenClaw 内核
- 可选一键更新内核（npm）
- 一键进入 OpenClaw Web Dashboard
- 支持 Windows / macOS / Linux

## 支持的安装包格式

- Windows：`MSI` / `NSIS`
- macOS：`DMG`
- Linux：`AppImage` / `deb` / `rpm`

产物目录：

```text
src-tauri/target/release/bundle/
```

## 普通用户使用流程

1. 下载并安装对应系统的安装包
2. 启动应用，进入首次配置向导
3. 填写必填项（`Provider`、`Model`、`API Key`）
4. 按需填写 `Base URL`、`Skills`
5. 点击 **开始使用**，进入 OpenClaw Web

## 内核选择顺序

应用会按以下优先级选择 OpenClaw 内核：

1. 高级设置中的自定义命令
2. 用户手动更新后的 managed kernel
3. 安装包内置 bundled kernel
4. `resources/bin/openclaw`（若存在）
5. 系统 PATH 中的 `openclaw`

## 本地开发

前置条件：

- Node.js 20+
- Rust 工具链

启动开发环境：

```bash
npm install
npm run dev
```

## 打包命令

```bash
# 当前平台默认打包
npm run dist

# 分平台打包
npm run dist:win
npm run dist:mac
npm run dist:linux
```

CI 场景命令：

```bash
npm run dist:win:ci
npm run dist:linux:ci
npm run dist:linux:appimage
```

## 配置文件路径

- macOS：`~/Library/Application Support/dev.openclawapp.desktop/openclaw.config.json`
- Linux：`~/.config/dev.openclawapp.desktop/openclaw.config.json`
- Windows：`%APPDATA%/dev.openclawapp.desktop/openclaw.config.json`

## CI/CD

GitHub Actions 会在 Push / PR 自动构建安装包。  
推送版本标签（`v*`）后可自动发布 Release 产物。

工作流文件：

```text
.github/workflows/build.yml
```

## 开源协议

MIT，见 [LICENSE](./LICENSE)。

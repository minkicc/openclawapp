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
cd apps/desktop
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
../../.github/workflows/build.yml
```

### GitHub Actions 的 macOS 签名与公证

为了避免用户在 macOS 上看到“已损坏、无法打开”的 Gatekeeper 提示，需要在仓库 Secrets 中配置：

- `APPLE_CERTIFICATE_P12`：Developer ID Application 证书（`.p12`）的 Base64 内容
- `APPLE_CERTIFICATE_PASSWORD`：`.p12` 文件密码
- `APPLE_SIGN_IDENTITY`：签名身份，例如 `Developer ID Application: Your Name (TEAMID)`
- `APPLE_KEYCHAIN_PASSWORD`（可选）：CI 临时 keychain 密码
- `APPLE_ID`：用于公证的 Apple ID 邮箱
- `APPLE_APP_SPECIFIC_PASSWORD`：该 Apple ID 的 app-specific password
- `APPLE_TEAM_ID`：Apple Developer Team ID

行为说明：

- 提供证书类 secrets 后，会对 `.app` 和 `.dmg` 做 Developer ID 签名。
- 再提供公证类 secrets 后，会自动提交 notarization 并 staple 到 `.dmg`。
- 未提供 secrets 时，会回退到 ad-hoc 签名（适合内部测试，不适合公开分发）。

### GitHub Actions 的 Windows 安装包签名

为了减少 Microsoft Defender SmartScreen 的“未知应用”拦截，建议在仓库 Secrets 中配置：

- `WINDOWS_CERTIFICATE_PFX`：代码签名证书（`.pfx`）的 Base64 内容
- `WINDOWS_CERTIFICATE_PASSWORD`：`.pfx` 文件密码
- `WINDOWS_TIMESTAMP_URL`（可选）：RFC3161 时间戳服务地址（默认 `http://timestamp.digicert.com`）

行为说明：

- 配置后，CI 会自动对生成的 `.msi` 安装包签名。
- 未配置时，Windows 构建仍可完成，但会跳过签名。

注意：

- SmartScreen 是否放行不仅取决于是否签名，还和证书信誉有关。
- 新的 OV 证书前期仍可能告警；公开分发建议使用 EV 证书，信誉建立更快。

## 开源协议

MIT，见 [LICENSE](../../LICENSE)。

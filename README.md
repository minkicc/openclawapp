# OpenClaw Desktop (Tauri)

这个仓库把 OpenClaw 打包为体积更小的原生桌面应用（Tauri），满足你的目标：

1. 安装过程图形化（Windows Installer / macOS DMG / Linux AppImage+deb+rpm）
2. 安装后首次启动图形化配置 `Model API Key`、`Base URL`、`skills`
3. 配置完成后进入正常 App 主界面
4. 支持 Windows / macOS / Linux

官方站点：[openclawapp.dev](https://openclawapp.dev)

## 为什么改 Tauri

相比 Electron，Tauri 安装包体积通常更小，启动资源开销也更低，适合 OpenClaw 这种“配置 + 命令运行/集成”型桌面工具。

## 项目结构

```text
.
├── index.html                # 前端入口
├── src
│   ├── app.js                # 配置向导/主界面逻辑
│   └── styles.css
├── src-tauri
│   ├── src/main.rs           # Rust 后端命令：配置读写、skills 导入、doctor 检查
│   └── tauri.conf.json       # 打包与窗口配置
├── resources
│   ├── bin                   # 可放 openclaw 可执行文件
│   └── skills                # 内置默认 skills
└── .github/workflows/build.yml
```

## 本地开发

```bash
npm install
npm run dev
```

## 打包安装包

```bash
# 当前平台默认打包
npm run dist

# 分平台
npm run dist:win
npm run dist:mac
npm run dist:linux
```

产物目录：`src-tauri/target/release/bundle/`

> macOS 说明：`npm run dist:mac` 使用自定义 DMG 流程（先构建 `.app` 再封装 `.dmg`），规避部分机器上 `hdiutil` 对卷名 `OpenClaw` 的权限冲突。  
> 如需回退到 Tauri 默认 DMG 打包，可用：`npm run dist:mac:tauri`

## 首次启动配置（重点）

首次启动会进入向导，配置项如下：

- Provider
- Model API Key（必填）
- Base URL（可选）
- Skills 目录（可选）
- 可选：Model、OpenClaw 命令

并支持：

- 一键导入内置 `resources/skills`
- 安装包内置 OpenClaw 内核（构建时预置 `openclaw + node`，用户端无需 npm）
- 一键安装/更新 OpenClaw 内核（可选，`npm i openclaw@latest` 到应用私有目录）
- 点击“开始使用 OpenClaw”后自动进入 OpenClaw Web 界面（Dashboard）
- 后续随时重新配置
- 一键 `doctor` 检查 `openclaw --version`

`doctor` 会按 Provider 自动注入常见环境变量：

- OpenAI: `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- Anthropic: `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
- 同时保留 `OPENCLAW_API_KEY` / `OPENCLAW_BASE_URL` 兼容扩展场景

## OpenClaw 命令字段的用途

- 这是**命令覆盖**：默认情况下，应用会优先使用“应用私有目录内核”（通过 npm 安装），其次才是系统 PATH 里的 `openclaw`。
- 你在界面里填写该字段后，会强制改用这个命令路径（适合高级用户自定义）。

默认命令优先级：

1. 自定义命令（你手动填写）
2. 用户手动更新后的私有内核（managed kernel）
3. 安装包内置内核（bundled kernel）
4. `resources/bin/openclaw`（如存在）
5. 系统 PATH `openclaw`

## 内置内核构建

构建前会自动执行：

```bash
npm run prepare:kernel
```

该步骤会在 `resources/kernel/` 预置：

- `openclaw@latest`
- `node@22`

可用环境变量：

- `OPENCLAW_KERNEL_REFRESH=1`：强制重新下载内置内核
- `OPENCLAW_KERNEL_SPEC=openclaw@2026.3.8`：固定 OpenClaw 版本
- `OPENCLAW_NODE_SPEC=node@22.22.1`：固定 Node 版本

## OpenClaw 命令接入方式

1. 默认：使用安装包内置内核（`resources/kernel`）。
2. 可选：把平台对应的 OpenClaw 原生可执行文件放到 `resources/bin/`。
3. 可选：让用户自行安装 OpenClaw 到系统 PATH，并在配置中指定命令。

## 配置文件位置

- macOS: `~/Library/Application Support/dev.openclawapp.desktop/openclaw.config.json`
- Linux: `~/.config/dev.openclawapp.desktop/openclaw.config.json`
- Windows: `%APPDATA%/dev.openclawapp.desktop/openclaw.config.json`

> 具体路径由 Tauri 的 `app_config_dir` 决定，界面里也可直接看到绝对路径。

## 图标

图标资源位于 `src-tauri/icons/`，会用于 macOS/Windows/Linux 的安装包与应用图标。

## 开源协议

MIT（见仓库根目录 `LICENSE`）。

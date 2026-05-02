# Stelle

Stelle 是一个模块化、事件驱动的数字生命运行时，面向 Discord、直播弹幕、Live2D 舞台输出、本地设备动作和长期记忆等交互场景。

这份 README 只回答两个问题：如何配置，如何启动。代码结构、项目规范、测试规范和记忆生成规则放在 `docs/`。

## 快速开始

需要 Node.js 20 或更新版本。

```powershell
npm install
copy .env.example .env
```

编辑 `.env`，至少配置一个可用模型密钥：

- `DASHSCOPE_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

如果需要 Discord 或直播平台能力，再配置对应变量：

- `DISCORD_TOKEN`
- `BILIBILI_ROOM_ID`
- `TWITCH_CHANNEL`
- `YOUTUBE_LIVE_CHAT_ID`
- `TIKTOK_USERNAME`

密钥只放在 `.env`，不要写进 `config.yaml` 或提交到仓库。

## 配置

Stelle 的配置由两层组成：

- `config.yaml`：非密钥运行时配置，例如模型选择、renderer 端口、debug/control 开关、策略参数。
- `.env`：本地密钥和环境变量，例如模型 API key、Discord token、直播平台房间配置。

常用运行变量：

- `STELLE_PRIMARY_MODEL`、`STELLE_SECONDARY_MODEL`
- `LIVE_RENDERER_HOST`、`LIVE_RENDERER_PORT`
- `STELLE_DEBUG_ENABLED`、`STELLE_DEBUG_TOKEN`
- `STELLE_CONTROL_TOKEN`

## 构建

```powershell
npm run build
```

构建会先打包 `assets/renderer/client/` 的 Live2D renderer，再编译 TypeScript runtime 到 `dist/`。

## 启动

```powershell
npm run start:runtime
npm run start:discord
npm run start:live
```

- `start:runtime`：完整运行时，包含 renderer、live services、inner cursor；如果存在 `DISCORD_TOKEN`，也会连接 Discord。
- `start:discord`：Discord-only。
- `start:live`：直播 renderer 与 live services，不连接 Discord。

开发模式：

```powershell
npm run dev
npm run dev:live
npm run dev:discord
```

TTS 服务：

```powershell
npm run start:kokoro
```

## 直播与控制页

默认 renderer 地址：

```text
http://127.0.0.1:8787/live
```

控制页：

```text
http://127.0.0.1:8787/control
```

Debug 页需要在 `config.yaml` 或环境变量中开启：

```text
http://127.0.0.1:8787/debug?token=YOUR_DEBUG_TOKEN
```

不要把 debug/control 路由暴露到公网。

## 常用检查

```powershell
npm run format:check
npx tsc --noEmit
npm test
```

涉及 Prompt、路由策略、记忆行为、直播 moderation 或舞台输出规划时，再运行：

```powershell
npm run test:eval
```

## 文档导航

- [项目结构](docs/STRUCTURE.md)：说明每个目录和核心模块的职责。
- [项目规范](docs/PROJECT_CONVENTIONS.md)：编码、格式、模块边界、工具和安全约束。
- [测试规范](docs/TESTING.md)：确定性测试、eval、验证范围和常见失败。
- [记忆生成规范](docs/MEMORY_GENERATION.md)：recent、checkpoint、long-term、proposal 与检索抗偏规则。
- [架构约束](docs/ARCHITECTURE.md)：事件边界、package 生命周期、DataPlane、debug、backpressure 和输出仲裁规则。
- [代码地图](docs/CODEBASE_GUIDE.md)：修改代码时的入口、业务流和常见扩展点。
- [运维手册](docs/OPERATIONS.md)：更细的启动、控制页和 debug 路由说明。
- [Topic Script 格式](docs/TOPIC_SCRIPT_FORMAT.md)：直播节目脚本格式。
- [Topic Script Runbook](docs/TOPIC_SCRIPT_RUNBOOK.md)：脚本生成、审核、加载和直播操作流程。

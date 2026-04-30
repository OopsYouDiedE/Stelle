# Stelle

Stelle 是一个轻量级、高度拟人化的数字生命运行时，面向 Discord、直播间弹幕、Live2D 舞台输出和本地设备动作等多种交互场景。

当前代码采用 V2 模块化架构：`StelleApplication` 负责生命周期，`StelleContainer` 装配共享服务，Cursor 负责领域决策，Actuator/Arbiter 统一仲裁所有对外输出和设备动作，模块注册器把 Core、Discord、Live、Actuator 等领域接入运行时。

## 文档导航

- [架构约束](docs/ARCHITECTURE.md)：模块边界、事件总线、Cursor 分层、Actuator 输出路径。
- [代码地图](docs/CODEBASE_GUIDE.md)：入口文件、目录职责、常见业务流和扩展清单。
- [运维手册](docs/OPERATIONS.md)：安装、构建、启动模式、配置、调试路由。
- [测试指南](docs/TESTING.md)：确定性测试、LLM eval、常见失败定位。
- [Topic Script 格式](docs/TOPIC_SCRIPT_FORMAT.md)：直播节目脚本的数据格式。
- [Topic Script Runbook](docs/TOPIC_SCRIPT_RUNBOOK.md)：脚本生成、审核、加载和直播操作流程。

## 核心模型

- Cursor 负责感知领域上下文、做行为决策、产生意图。
- EventBus 是跨模块通信边界，模块之间避免直接互调。
- Stage Output Arbiter 负责字幕、TTS、动作、表情等直播舞台资源仲裁。
- Device Action Arbiter 负责浏览器、桌面输入、ADB 等设备动作的权限与冲突控制。
- Tool Registry 负责工具权限、输入校验和副作用审计。
- Memory Store 负责最近记忆、长期记忆和反思日志。

## 目录结构

```text
.
├── assets/renderer/        # Live2D 渲染器、模型、样例事件和本地 Cubism 运行时
├── data/topic_scripts/     # 直播 Topic Script 草稿、审核稿和编译产物
├── docs/                   # 架构、运维、测试和直播脚本文档
├── evals/                  # 依赖真实模型的能力评估
├── memory/                 # 本地长期记忆与直播观众画像
├── scripts/                # 启动、弹幕桥接、预检、日志导出、TTS 等脚本
├── src/
│   ├── start.ts            # 统一 CLI 启动入口
│   ├── core/               # Application、Container、Scheduler、模块注册器
│   ├── cursor/             # Inner/Discord/Live 等决策 Cursor 与模块清单
│   ├── actuator/           # Stage Output 与 Device Action 仲裁器
│   ├── stage/              # 舞台输出策略、预算、队列和 renderer 调用层
│   ├── device/             # 设备动作策略、渲染器和驱动
│   ├── live/               # 直播 adapters/controller/infra 分层
│   ├── memory/             # LLM 客户端与 MemoryStore
│   ├── tools/              # 工具注册、安全策略和默认工具
│   └── utils/              # EventBus、事件 Schema、Discord/Live 底层适配
├── test/                   # 确定性单元测试与集成测试
├── config.yaml             # 非密钥运行时配置
└── package.json
```

## 环境准备

需要 Node.js 20 或更新版本。

```powershell
npm install
```

复制 `.env.example` 到 `.env`，按需配置密钥：

- `DISCORD_TOKEN`
- `DASHSCOPE_API_KEY`、`GEMINI_API_KEY` 或 `OPENAI_API_KEY`
- 直播平台变量，例如 `BILIBILI_ROOM_ID`、`TWITCH_CHANNEL`、`YOUTUBE_LIVE_CHAT_ID`、`TIKTOK_USERNAME`

密钥只放在 `.env`，不要提交到仓库。

## 构建与启动

```powershell
npm run build
```

常用启动方式：

```powershell
npm run start:runtime      # 完整运行时，包含 renderer/live/inner，存在 DISCORD_TOKEN 时连接 Discord
npm run start:discord      # Discord-only
npm run start:live         # 直播 renderer 与 live services
npm run dev                # runtime watch 模式
npm run dev:live           # live watch 模式
npm run start:kokoro       # Kokoro TTS Python 服务
```

直播相关辅助命令：

```powershell
npm run live:preflight
npm run live:bilibili
npm run live:export-logs
npm run live:episode-summary
```

Live renderer 默认地址为 `http://127.0.0.1:8787/live`，控制页为 `http://127.0.0.1:8787/control`。端口和 token 见 `config.yaml`、`.env` 和 [运维手册](docs/OPERATIONS.md)。

## 测试与评估

确定性测试不应发起真实 LLM 网络请求：

```powershell
npm test
npx tsc --noEmit
```

涉及 Prompt、路由策略、记忆、直播场控或舞台输出规划时，再运行真实模型评估：

```powershell
npm run test:eval
```

更多定位建议见 [测试指南](docs/TESTING.md)。

## 开发约束

- 核心逻辑位于 `src/`。
- 跨模块通信优先使用 `StelleEventBus` 和 `src/utils/event_schema.ts`。
- Cursor 不直接调用其他 Cursor 的方法。
- 所有真实对外输出都经过对应 Arbiter。
- 工具调用经过 `ToolRegistry`，不要绕过权限与审计层。
- TypeScript ESM import 使用 `.js` 后缀。
- Prompt 当前内嵌在对应 Cursor/服务实现中，改动后需要补充测试或 eval。

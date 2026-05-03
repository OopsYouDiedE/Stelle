# Stelle 开发者指南 (Developer Guide)

本文档是 Stelle 系统的核心使用与开发入口，涵盖了安装、运行模式、运维配置以及完整的测试和评估规范。

如果你需要修改系统架构或底层代码，请参考 [ARCHITECTURE.md](ARCHITECTURE.md)。涉及认知机制的，请参阅 [MEMORY.md](MEMORY.md)；涉及节目编排的，请参阅 [TOPIC_SCRIPT.md](TOPIC_SCRIPT.md)。

---

## 1. 安装与构建 (Install & Build)

环境要求：**Node.js 20 or newer**

```powershell
npm install
npm run build
```

执行 build 会使用 Vite 编译渲染端页面，并使用 TypeScript 编译运行时代码到 `dist/` 目录。

---

## 2. 运行模式 (Start Modes)

```powershell
npm run start:runtime
npm run start:discord
npm run start:live
```

- `runtime`: 包含 renderer, live services, inner cursor，并且当配置了 `DISCORD_TOKEN` 时包含 Discord 接入。
- `discord`: 仅启动 Discord 运行时。
- `live`: 仅启动 renderer 和 live services（无 Discord 连接）。

开发模式（带有热重载）：使用 `package.json` 中的 `dev:*` 脚本（如 `npm run dev`）。

> [!NOTE]
> Kokoro 本地 TTS 是可选的。`start:live` 和 `start:runtime` 会探测配置的 Python 环境。如果没有 `.venv` 或 `KOKORO_PYTHON`，主程序将直接启动，字幕和 Debug 依然可用，仅仅是缺少本地语音合成。

---

## 3. 配置与端口 (Configuration & Endpoints)

所有配置从 `config.yaml` 加上环境变量加载。密钥等敏感信息必须写在 `.env` 中，**禁止提交**。

### 核心环境变量

- `DISCORD_TOKEN`
- `DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, 或 `OPENAI_API_KEY`
- `STELLE_PRIMARY_MODEL`, `STELLE_SECONDARY_MODEL`
- `LIVE_RENDERER_HOST`, `LIVE_RENDERER_PORT`
- `STELLE_DEBUG_ENABLED`, `STELLE_DEBUG_TOKEN`
- `STELLE_CONTROL_TOKEN`
- 直播平台相关：`BILIBILI_ROOM_ID`, `TWITCH_CHANNEL`, `YOUTUBE_LIVE_CHAT_ID`, `TIKTOK_USERNAME`

### 渲染与控制页

在 Live 模式下，本地服务默认地址为：

- Renderer (舞台渲染)：`http://127.0.0.1:8787/live`
- Control (控制页)：`http://127.0.0.1:8787/control`
- Debug (调试大盘)：`http://127.0.0.1:8787/debug`（仅在 `debug.enabled=true` 时开放）

> [!WARNING]
> Debug 路由（如 `/_debug/api/live/control`）若未配置 token 会极其危险，**切勿将其暴露到公网**。

---

## 4. 测试约定 (Testing Conventions)

Stelle 有明确的测试分层：`test/` 守护代码结构和逻辑，`evals/` 守护 AI 行为质量。

### 提交前必跑 (Required Checks)

```powershell
npx tsc --noEmit
npm test
```

`npm test` 运行**确定性**的 Vitest 测试，不依赖真实的 LLM 或公网环境。如果有重大的架构文件调整，请先执行 `npm run build`。

### 焦点测试 (Focused Tests)

你可以使用预设的 NPM Scripts 跑特定领域的测试，缩短反馈循环：

```powershell
npm run test:arch       # 架构边界
npm run test:core       # 核心原语
npm run test:cap        # 所有能力域
npm run test:win        # 平台接入和渲染层
npm run test:integration # 跨模块集成
npm run test:coverage   # 测试覆盖率检查
```

_注：`test/debug/`、`test/capabilities/perception/`、`test/capabilities/model/` 目录当前有意留空或仅作为集成测试覆盖范围，后续会按需补充细粒度测试。_

### 模型评估 (Eval Checks)

当修改了 Prompt、记忆策略、意图分类、话题剧本流等**影响 LLM 行为**的代码时，需要运行评估脚本（调用真实 LLM）：

```powershell
npm run test:eval
npm run test:eval:inner  # 仅测试内核和内省相关
npm run test:eval:topic  # 仅测试话题和文案生成
npm run test:eval:live   # 仅测试直播弹幕和审核
```

Eval 报告会生成在 `evals/logs/` 目录中。

#### Eval 数据集对照表

所有语料集维护在 `evals/materials/curated/` 下：

| Dataset (.jsonl)                  | 目标 Eval                                              | 测试类型     |
| --------------------------------- | ------------------------------------------------------ | ------------ |
| `inner_synthesis.smoke`           | `inner_synthesis.eval.ts`                              | 合成用例     |
| `live_danmaku.smoke`              | `live_danmaku.eval.ts`                                 | 合成用例     |
| `memory_use.smoke`                | `memory_use.eval.ts`                                   | 合成用例     |
| `social_router.smoke`             | `social_router.eval.ts`                                | 合成用例     |
| `tool_planning.smoke`             | `tool_planning.eval.ts`                                | 合成用例     |
| `runtime_capability_planning.llm` | `runtime_capabilities` / `runtime_capability_planning` | 真实线上切片 |
| `stage_output_planning.llm`       | `stage_output_planning.eval.ts`                        | 真实线上切片 |
| `topic_script_*.llm`              | `topic_script_*.eval.ts`                               | 真实线上切片 |

_(自带 payload 无需 external dataset 的：`persona_drift.eval.ts`，`llm_stress.eval.ts`)_

### 常见测试失败原因 (Common Failures)

1. **Type failures**: 移动文件后 import 路径仍指向旧边界。
2. **Architecture failures**: 能力层（Capability）引入了具体的窗口/运行时（Window/Runtime），或者 Core 层引入了实现层代码。
3. **Event failures**: 事件的 envelope 不符合 `src/core/event/event_schema.ts` 规范。
4. **Tool/Action failures**: 绕过了权限系统（ToolRegistry）、设备动作仲裁器（DeviceActionArbiter）或舞台仲裁器（StageOutputArbiter）。
5. **Memory failures**: 搜索评分可能过度依赖单一关键词，导致单关键词 query 被完全过滤。

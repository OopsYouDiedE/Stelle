# Stelle (V2 Architecture)

Stelle 是一个轻量级、高度拟人化的数字生命运行时。

> **重要开发规范**：关于 V2 架构的硬性规则、模块化 Cursor 分层规范 (Gateway/Router/Executor/Responder)、工具安全及记忆分层契约，请务必阅读 [**`docs/ARCHITECTURE.md`**](docs/ARCHITECTURE.md)。

Stelle 围绕 `Inner Ego (InnerCursor) + Interaction Cursors + Stage Output Arbiter + Tool Registry + Memory Store` 组织。

- Cursor 负责感知领域上下文、做行为决策、产生意图。
- Stage Output Arbiter 负责仲裁直播舞台的有限输出资源。
- Tool Registry 负责工具权限、输入校验和副作用审计。
- Memory Store 负责最近记忆、长期记忆和反思日志。
...

在最新演进的 V2 架构中，我们全面移除了早期的强耦合代码，拥抱了 **事件总线 (EventBus)** 和 **应用容器化 (Application Container)**，并使用 **Express + Socket.io** 彻底重构了内部的通信协议。

## 项目愿景

Stelle 不仅仅是一个复杂的软件平台，而是一个“在场的生命”。其行为逻辑遵循以下原则：
- **反思压力阀**：潜意识反思（Inner Ego）由事件的“影响力 (Impact)”和“显著性 (Salience)”驱动，而非简单的计数。
- **动态静音**：在 Discord 中，静音不再是死板的时间锁，而是可以被语境、情绪或直接呼唤打破的阈值锁。
- **氛围感知**：在直播 (Live) 模式下，系统能够感知直播间的“热度”和“氛围 (Vibe)”，在冷场时主动发起话题。

## 核心架构演进 (V2)

1. **统一通信协议 (Express + Socket.io)**: 
   - 彻底废弃了原生的 `node:http` 和单向的 SSE (`Server-Sent Events`)。
   - 后端路由与静态资源现在由 **Express** 托管。
   - 前后端实时通信切换为 **Socket.io**，提供低延迟的双向舞台控制（动作、表情、背景、语音等下发机制完全统一）。
   - 引入 `http-proxy-middleware` 将 Kokoro TTS 微服务无缝集成至同一端口。

2. **事件驱动与高度解耦 (Event Bus)**:
   - 废弃了各 Cursor 之间硬编码的 `dispatch` 函数调用链。
   - 引入全局 `StelleEventBus` (基于 EventEmitter)，所有模块仅通过订阅/发布标准化的 `StelleEvent` (如 `live.request`, `core.tick`, `cursor.reflection`) 来通信，实现极低的耦合度。

3. **直播舞台输出仲裁 (Stage Output Arbiter)**:
   - Cursor 不再拥有直播舞台输出权，只产生 `OutputIntent`。
   - `StageOutputArbiter` 负责字幕、TTS、动作、表情和观众注意力预算的仲裁。
   - `StageOutputRenderer` 是唯一真实调用 live 输出工具的层。

4. **应用容器化生命周期 (StelleApplication)**:
   - 新增 `src/core/application.ts` 容器类和 `src/core/scheduler.ts` 独立调度器。
   - 彻底梳理并接管了原先庞大的入口初始化逻辑，统一管理配置加载、数据库/内存生命周期、Discord Client 以及 Live 前端。

## 目录结构

```text
.
├── assets/             # 静态资源
│   ├── renderer/       # 前端 Live2D 渲染器 (Vite/TS/Socket.io)
│   └── models/         # Live2D 模型文件 (Mao)
├── evals/              # 依赖大模型 (LLM) 的能力评估测试体系
│   ├── capabilities/   # 人格合成、场控干预等专项评估脚本
│   └── logs/           # 人类易读的 Markdown 评估报告输出目录
├── memory/             # 长期记忆与本地持久化 (Markdown/JSONL)
├── scripts/            # 启动脚本与 Kokoro TTS Python 服务
├── src/
│   ├── start.ts        # 统一启动入口 (极简)
│   ├── core/           # 核心架构: Application 生命周期与 Scheduler 时钟调度
│   ├── stage/          # 直播舞台输出仲裁与渲染
│   │   ├── output_arbiter.ts  # 直播输出资源仲裁
│   │   ├── output_renderer.ts # 唯一真实调用 live 输出工具的层
│   │   ├── output_policy.ts   # lane 优先级、打断、冷却规则
│   │   ├── output_budget.ts   # 字幕/TTS/注意力预算
│   │   └── output_types.ts    # OutputIntent / OutputDecision 类型
│   ├── tool.ts         # 工具注册表 (Tool Registry)
│   ├── cursor/         # 行为决策引擎 (Cursors)
│   │   ├── types.ts    # 共享 StelleEvent 协议定义
│   │   ├── inner/
│   │   │   └── cursor.ts    # 潜意识核心 (Inner Ego) 与认知升华
│   │   ├── discord/
│   │   │   └── cursor.ts    # Discord 交互逻辑与软静音管理
│   │   └── live/
│   │       └── cursor.ts    # 直播交互、队列管理与氛围评估
│   └── utils/          # 底层支撑工具 (LLM, Memory, Renderer 等)
├── test/               # 确定性单元测试与集成测试 (不发写真实网络请求)
├── config.yaml         # 项目配置
└── package.json
```

## 运行方式

### 1. 环境准备
确保已安装 Node.js (>=20) 并配置好 `.env`（需要配置 `GEMINI_API_KEY` 或 `DASHSCOPE_API_KEY` 以及 `DISCORD_TOKEN`，参考 `.env.example`）。

### 2. 安装与构建
```bash
npm install
npm run build
```

### 3. 启动服务
Stelle 支持多种启动模式，通常建议运行完整运行时：

- **完整模式**: `npm run start` (生产) 或 `npm run dev` (开发)
- **只运行 Discord**: `npm run start:discord`
- **只运行直播渲染**: `npm run start:live`
- **TTS 服务 (Python)**: `npm run start:kokoro`
- **B 站正式直播前检查**: `npm run live:preflight`
- **B 站弹幕桥接**: `npm run live:bilibili`

正式直播流程见 [`docs/BILIBILI_LIVE_RUNBOOK.md`](docs/BILIBILI_LIVE_RUNBOOK.md)。

## 测试与评估体系 (Testing & Evals)

为了有效应对大模型（LLM）带来的随机性和测试脆弱性，我们建立了两套界限分明的测试体系：

### 1. 核心逻辑测试 (Test)
用于验证确定性逻辑和基础架构，**不发起真实的网络 LLM 请求**，全 Mock 环境。使用此套件进行 CI/CD 的快速验证。

```bash
npm run test          # 运行所有确定性测试 (Vitest)
npm run test:coverage # 生成覆盖率报告
```

### 2. 模型能力评估 (Evals)
大模型的效果无法用简单的相等断言来判断对错。我们专门在 `evals/` 目录下设计了一套能力评估系统，该系统会调用真实的 API Keys。

**评估场景包括：**
- `infra/llm_stress`: 多模型网络压力和错误重试机制测试。
- `capabilities/ego_synthesis`: 模拟混乱的高频聊天弹幕，测试 Inner Ego 是否能提取稳定的“世界观(Convictions)”和情绪。
- `capabilities/moderation`: 场控模拟，在 "静默" 观察模式下，测试 LLM 能否精确判断何时需要“打破沉默”下场干预弹幕节奏。

```bash
npm run test:eval     # 运行真实的 LLM 评估场景
```

运行 `test:eval` 后，除了控制台输出外，会自动向 `evals/logs/` 写入 Markdown 格式的人类友好 **评估报告（Eval Report）**，方便开发者对大模型当前“智商”进行直观的审阅。

## 开发规范
- **代码位置**：所有核心逻辑必须位于 `src/` 目录下。
- **Prompt 管理**：当前 Prompt 内嵌于各 Cursor 实现类中（如 `DISCORD_PERSONA`, `LIVE_PERSONA`），以保持行为与定义的紧密耦合。
- **安全性**：严禁在代码或提交中包含 API Key，统一使用 `dotenv`。

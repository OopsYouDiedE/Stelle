# Stelle Codebase Guide

这份文档面向要修改代码的人：先帮你判断该看哪里，再给出常见业务流的实际落点。目录职责总览见 [`STRUCTURE.md`](STRUCTURE.md)，更严格的架构规则见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## First Files To Read

- `src/start.ts`：CLI 入口，选择 `runtime`、`discord` 或 `live` 启动模式。
- `src/core/application.ts`：运行时生命周期，启动 renderer、初始化 cursors、注册 modules、连接 Discord。
- `src/core/container.ts`：共享服务装配点，创建 LLM、Memory、EventBus、ToolRegistry、Stage/Device arbiters。
- `src/core/modules/*.ts`：领域模块注册点，把 Core、Discord、Live、Actuator 接入应用生命周期。
- `src/utils/event_schema.ts`：跨模块事件协议。新增事件先在这里定义，再让生产者和消费者对齐。
- `src/cursor/types.ts`：Cursor 上下文、快照和通用接口。

## Directory Responsibilities

| Path                   | Responsibility                                                          |
| ---------------------- | ----------------------------------------------------------------------- |
| `src/core/`            | 应用生命周期、依赖容器、调度器、debug/control glue code。               |
| `src/cursor/`          | 决策层。Cursor 读取事件和上下文，产出回复、舞台输出或设备动作意图。     |
| `src/actuator/`        | 仲裁层。统一处理输出/动作的接受、排队、拒绝、审计事件。                 |
| `src/stage/`           | 直播舞台输出策略、预算、队列和最终 renderer/tool 调用。                 |
| `src/device/`          | 设备动作类型、allowlist、策略、驱动和动作渲染。                         |
| `src/live/adapters/`   | 平台接入和直播事件归一化，例如 Bilibili、Twitch、YouTube、TikTok。      |
| `src/live/controller/` | 直播业务控制层：场控、健康检查、事件日志、观众关系、Topic Script。      |
| `src/live/infra/`      | 低层基础设施，目前主要是 renderer server。                              |
| `src/memory/`          | LLM 客户端与本地记忆存储。                                              |
| `src/tools/`           | 工具注册、输入校验、安全策略和默认工具 provider。                       |
| `src/utils/`           | EventBus、事件 Schema、Discord/Live 底层运行时、JSON/text/TTS helpers。 |
| `test/`                | 不依赖真实网络的确定性测试。                                            |
| `evals/`               | 依赖真实模型的能力评估。                                                |

## Runtime Startup Flow

1. `src/start.ts` 解析启动模式并创建 `StelleApplication`。
2. `StelleApplication` 读取配置，调用 `StelleContainer.createServices()` 创建共享服务。
3. `runtime` 或 `live` 模式启动 `LiveRendererServer`，并把 renderer bridge 注入 `LiveRuntime` 与 `SceneObserver`。
4. `selectCursorModules()` 根据模式选择 Cursor manifest，并使用 `CursorContext` 创建实例。
5. `CoreModule`、`ActuatorModule`、`DiscordModule`、`LiveModule` 注册事件监听与领域服务。
6. 模块 `start()` 后，`StelleScheduler` 开始 tick，运行时写入 `RuntimeState`。

## Live Event Flow

直播平台事件从 `src/live/adapters/` 进入：

1. platform adapter 产生原始平台事件。
2. ingress helpers 去重、聚合并发布 `live.event.*` 或 `live.danmaku.received`。
3. `LiveStageDirector`、`LiveCursor`、健康检查、事件日志等服务订阅事件。
4. 需要输出时，业务层提交 `live.output.proposal` 或直接向 `StageOutputArbiter` 提交 `OutputIntent`。
5. `StageOutputArbiter` 根据 lane、priority、TTL、interrupt、预算和队列状态决定接受、排队或丢弃。
6. `StageOutputRenderer` 通过 `ToolRegistry` 调用字幕、TTS、动作、表情或 Discord reply 工具。

## Cursor Pattern

新 Cursor 或重构 Cursor 时，优先沿用 Gateway -> Router -> Executor -> Responder：

- Gateway：把外部事件或平台回调转成领域输入。
- Router：选择策略、判断是否回应、决定交给哪个 executor。
- Executor：调用 LLM、Memory、Tools 或 Arbiter，生成可执行结果。
- Responder：把结果转为领域输出、事件或 snapshot 更新。

共享生命周期放在 `BaseStatefulCursor`，策略覆盖通过 `PolicyOverlayStore` 从 `cursor.directive` 事件进入。

## Adding A Feature

### New Event

1. 在 `src/utils/event_schema.ts` 添加 schema 和类型。
2. 让生产者使用 `eventBus.publish()` 发布完整 metadata。
3. 让消费者通过 EventBus 订阅，不直接调用生产者。
4. 添加最小单元测试，覆盖 payload 形状和关键分支。

### New Tool

1. 在 `src/tools/providers/` 或现有 provider 中实现工具。
2. 在 `createDefaultToolRegistry()` 接入，补齐权限 tier、输入 schema 和副作用说明。
3. 调用方通过 `ToolRegistry` 使用工具，不直接 import provider 实现。
4. 添加 `test/infra` 或对应领域测试。

### New Live Platform Adapter

1. 在 `src/live/adapters/` 添加 adapter 和类型映射。
2. 归一化为 `LiveEventReceivedSchema` 支持的事件。
3. 接入 `LivePlatformManager`。
4. 添加平台状态、错误和 dry-run 测试。

### New Output Or Device Action

1. 先确认是否属于 stage output 还是 device action。
2. 在对应 types/policy/allowlist 中声明能力边界。
3. 所有执行路径经过 `StageOutputArbiter` 或 `DeviceActionArbiter`。
4. renderer/driver 只做执行，不做高层决策。

## Compatibility Notes

- 仓库仍保留少量兼容 re-export，例如 `src/tool.ts`。移动文件时先检查测试里的旧 import。
- TypeScript ESM import 需要写 `.js` 后缀，即使源文件是 `.ts`。
- 文档或测试里提到旧路径时，优先映射到当前分层：
  - `src/live/platforms/*` -> `src/live/adapters/*`
  - `src/live/ops/*` -> `src/live/controller/*`
  - `src/live/program/*` -> `src/live/controller/*`
  - `src/stage/output_arbiter.ts` -> `src/actuator/output_arbiter.ts`
  - `src/device/action_arbiter.ts` -> `src/actuator/action_arbiter.ts`

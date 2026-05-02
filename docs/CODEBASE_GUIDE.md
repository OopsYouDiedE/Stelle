# Stelle Codebase Guide

这份文档面向要修改代码的人：先帮你判断该看哪里，再给出常见业务流的实际落点。目录职责总览见 [`STRUCTURE.md`](STRUCTURE.md)，更严格的架构规则见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## First Files To Read

- `src/start.ts`：CLI 入口，选择 `runtime`、`discord` 或 `live` 启动模式。
- `src/runtime/host.ts`：RuntimeHost，按模式选择并启动 `ComponentPackage`。
- `src/core/protocol/*.ts`：Core contract，包括 package、event、intent、execution、DataPlane refs。
- `src/core/runtime/*.ts`：Component registry/loader、DataPlane、Resource/Stream registry。
- `src/core/event/event_schema.ts`：只校验事件 envelope；payload schema 由 package 自己拥有。
- `src/capabilities/cognition/runtime_kernel/*`：感知事件到 Intent 的 pipeline。

## Directory Responsibilities

| Path                | Responsibility                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| `src/core/`         | 通用协议、Component registry/loader、DataPlane、watchdog、安全原语。         |
| `src/runtime/`      | RuntimeHost、模式选择、bootstrap service 注册。                              |
| `src/capabilities/` | 可复用能力实现：cognition、expression、memory、program、perception、action。 |
| `src/windows/`      | 场景/平台组合层：live、discord、browser、desktop input、renderer bridge。    |
| `src/debug/`        | Debug server shell、auth、命令风险规则和 DebugProvider contract。            |
| `src/tools/`        | 工具注册、输入校验、安全策略和默认工具 provider。                            |
| `src/utils/`        | EventBus、事件 Schema、Discord/Live 底层运行时、JSON/text/TTS helpers。      |
| `test/`             | 不依赖真实网络的确定性测试。                                                 |
| `evals/`            | 依赖真实模型的能力评估。                                                     |

## Runtime Startup Flow

1. `src/start.ts` 解析启动模式并创建 `RuntimeHost`。
2. `RuntimeHost` 读取配置，创建 EventBus、Registry、ComponentLoader、DataPlane 和 DebugServer。
3. Host 注册 bootstrap services，例如 Discord/Live runtime、LLM、Memory、ToolRegistry、SceneObserver。
4. Host 按模式选择 packages，并依次 `load()` / `start()`。
5. Window packages 只负责平台接入和事件转换；Capability packages 负责 cognition、program、expression、action。

## Live Event Flow

直播平台事件从 `src/windows/live/adapters/` 进入：

1. platform adapter 产生原始平台事件。
2. Window 去重、归一化为 `PerceptualEvent`，发布 `perceptual.event`。
3. `RuntimeKernel` 订阅 `perceptual.event`，发布 `cognition.intent`。
4. `StageOutputCapability` 订阅 `cognition.intent` / `program.output.proposal`，提交给内部 arbiter。
5. `StageOutputArbiter` 根据 lane、priority、TTL、interrupt、预算和队列状态决定接受、排队或丢弃。
6. `StageWindowOutputRenderer` 把已接受输出映射到 stage renderer server。

## Package Pattern

新增或重构功能时，优先按 Package -> Service Contract -> Event/Intent Flow 划边界：

- Package：声明 `id/kind/requires/provides/register/start/stop`。
- Service contract：跨包同步读或狭窄服务调用只依赖公开接口。
- Event/Intent flow：写状态、副作用和跨域行为通过 EventBus、Intent 或 ExecutionCommand 表达。
- DebugProvider：调试面只暴露 metadata、snapshot 和 risk-tagged commands。

## Adding A Feature

### New Event

1. 事件 envelope 使用 `type/source/id/timestamp/payload/metadata`。
2. payload 类型放在拥有该事件的 package 中。
3. 让消费者通过 EventBus 订阅，不直接调用生产者。
4. 添加最小单元测试，覆盖 payload 收窄和关键分支。

### New Tool

1. 在 `src/tools/providers/` 或现有 provider 中实现工具。
2. 在 `createDefaultToolRegistry()` 接入，补齐权限 tier、输入 schema 和副作用说明。
3. 调用方通过 `ToolRegistry` 使用工具，不直接 import provider 实现。
4. 添加 `test/infra` 或对应领域测试。

### New Live Platform Adapter

1. 在 `src/windows/live/adapters/` 添加 adapter 和类型映射。
2. 归一化为 `PerceptualEvent`。
3. 接入 `LivePlatformManager`。
4. 添加平台状态、错误和 dry-run 测试。

### New Output Or Device Action

1. 先确认是否属于 stage output 还是 device action。
2. 在对应 types/policy/allowlist 中声明能力边界。
3. 跨包路径通过 `cognition.intent`、`program.output.proposal` 或 action service contract 进入 capability。
4. renderer/driver 只做执行，不做高层决策。

## Migration Notes

- 不再保留旧 `src/cursor`、`src/live`、`src/stage`、`src/device`、`src/memory`、`src/scene` 源码壳；import 直接指向真实归属。
- TypeScript ESM import 需要写 `.js` 后缀，即使源文件是 `.ts`。
- 旧 live adapter 归属 `src/windows/live/adapters/*`。
- 旧 stage output 归属 `src/capabilities/expression/stage_output/*`。
- 旧 device action 归属 `src/capabilities/action/device_action/*` 及具体 driver capability。

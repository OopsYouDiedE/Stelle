# Stelle Codebase Guide

这份文档面向要修改代码的人：先帮你判断该看哪里，再给出常见业务流的实际落点。

## First Files To Read

- `src/start.ts`：CLI 入口，选择 `runtime`、`discord` 或 `live` 启动模式。
- `src/runtime/host.ts`：`RuntimeHost`，按模式选择并启动 `ComponentPackage`。
- `src/core/protocol/*.ts`：Core contract，包括 package、event、intent、execution、DataPlane refs。
- `src/core/runtime/*.ts`：Component registry/loader、DataPlane、Resource/Stream registry。
- `src/core/event/event_schema.ts`：只校验事件 envelope；payload schema 由 package 自己拥有。
- `src/capabilities/cognition/runtime_kernel/*`：感知事件到 Intent 的 pipeline。

## Directory Responsibilities

| Path                | Responsibility                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `src/core/`         | 通用协议、EventBus、config helpers、Component registry/loader、DataPlane、watchdog、安全原语。 |
| `src/runtime/`      | RuntimeHost、模式选择、bootstrap service 注册。                                                |
| `src/capabilities/` | 可复用能力实现：cognition、expression、memory、program、perception、action、tooling。          |
| `src/windows/`      | 场景/平台组合层：live、discord、browser、desktop input、renderer bridge。                      |
| `src/debug/`        | Debug server shell、auth、命令风险规则。                                                       |
| `src/shared/`       | 通用 JSON/text/live config schema helpers。                                                    |
| `test/`             | 不依赖真实网络的确定性测试。                                                                   |
| `evals/`            | 依赖真实模型的能力评估。                                                                       |

## Runtime Startup Flow

1. `src/start.ts` 解析启动模式并创建 `RuntimeHost`。
2. `RuntimeHost` 读取 package-owned config，创建 EventBus、Registry、ComponentLoader、DataPlane 和 DebugServer。
3. Host 注册 bootstrap services，例如 Discord/Live runtime、LLM、Memory、ToolRegistry、SceneObserver。
4. Host 按模式选择 packages，并依次 `load()` / `start()`。
5. Window packages 负责平台接入和事件转换；Capability packages 负责 cognition、program、expression、action。

## Live Event Flow

直播平台事件从 `src/windows/live/adapters/` 进入：

1. Platform adapter 产生原始平台事件。
2. Live window 去重、归一化为 `PerceptualEvent`，发布 `perceptual.event`。
3. `RuntimeKernel` 订阅 `perceptual.event`，发布 `cognition.intent`。
4. `StageOutputCapability` 订阅 `cognition.intent` / `program.output.proposal`，提交给内部 arbiter。
5. `StageOutputArbiter` 根据 lane、priority、TTL、interrupt、预算和队列状态决定接受、排队或丢弃。
6. `StageOutputRenderer` 把已接受输出映射到 stage renderer server。

## Adding A Tool

1. 将工具实现放在拥有该领域的 package 中；通用工具放在 `src/capabilities/tooling/`。
2. 在该 package 的 `register()` 中把工具注册到 `tools.registry`。
3. 补齐 authority、input schema 和 side effect metadata。
4. 添加 `test/capabilities/tooling` 或对应 owner 的测试。

## Adding A Live Platform Adapter

1. 在 `src/windows/live/adapters/` 添加 adapter 和类型映射。
2. 归一化为 `NormalizedLiveEvent` / `PerceptualEvent`。
3. 接入 `LivePlatformManager`。
4. 添加平台状态、错误和 dry-run 测试。

## Boundary Notes

- TypeScript ESM import 需要写 `.js` 后缀，即使源文件是 `.ts`。
- Live adapter 归属 `src/windows/live/adapters/*`。
- Stage output 归属 `src/capabilities/expression/stage_output/*`。
- Device action 归属 `src/capabilities/action/device_action/*` 及具体 driver capability。

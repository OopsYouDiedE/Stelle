# Stelle Structure

这份文档说明当前代码结构和每个部分的职责。严格架构边界见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## Runtime Source

| Path                | Role                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/start.ts`      | CLI 入口，选择 `runtime`、`discord`、`live` 模式。                                                         |
| `src/index.ts`      | 公开 API 出口。                                                                                            |
| `src/core/`         | 通用协议、EventBus/EventSchema、config helpers、Component registry/loader、DataPlane、watchdog、安全原语。 |
| `src/runtime/`      | `RuntimeHost`、模式选择和 bootstrap service 注册。                                                         |
| `src/capabilities/` | 可复用能力：cognition、expression、memory、reflection、program、perception、action、tooling。              |
| `src/windows/`      | 平台/场景组合层：live、discord、browser、desktop input、stage bridge 和 adapters。                         |
| `src/debug/`        | Debug server shell、认证和命令风险规则。                                                                   |
| `src/shared/`       | 与具体 package 无关的 JSON、text、live config schema helpers。                                             |

旧的 `src/utils/`、`src/tools/`、`src/config/`、`src/tool.ts`、`src/runtime_state.ts` 和
`src/runtime/application.ts` 已移除。新代码应直接 import 拥有该实现的 package。

## Tooling

Tool registry 基础设施位于 `src/capabilities/tooling/`：

- `tool_registry.ts`：注册、执行、审计和权限检查。
- `types.ts`：工具定义、权限、上下文、结果和 side effect schema。
- `security.ts`：公网 URL/SSRF 防护。
- `core_tools.ts`：时间、计算、文件系统、命令执行。
- `search_tools.ts`：公共网页搜索和读取。
- `workspace.ts`：workspace path 和原子写入 helper。

领域工具由 owner package 提供：

- `src/windows/discord/tools.ts`
- `src/windows/live/tools.ts`
- `src/capabilities/memory/store/tools.ts`
- `src/capabilities/expression/speech_output/tools.ts`
- `src/capabilities/perception/scene_observation/tools.ts`

## Test Layout

| Path                 | Role                                   |
| -------------------- | -------------------------------------- |
| `test/architecture/` | 架构边界测试。                         |
| `test/core/`         | Core runtime primitives。              |
| `test/capabilities/` | 按 capability 分类的确定性测试。       |
| `test/windows/`      | Window/package/platform adapter 测试。 |
| `test/integration/`  | 跨 package 的确定性集成流。            |
| `test/helpers/`      | 测试 helper。                          |

## Memory Layout

运行时生成的记忆默认放在 `memory/`：

```text
memory/
├── discord/
├── live/
├── program/
└── long_term/
```

生成规则和检索规则见 [`MEMORY_GENERATION.md`](MEMORY_GENERATION.md)。

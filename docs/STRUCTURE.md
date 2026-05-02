# Stelle Structure

这份文档说明当前代码结构和每个部分的职责。严格架构边界见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，启动和配置见 [`../README.md`](../README.md)。

## Root

| Path                  | Role                                                |
| --------------------- | --------------------------------------------------- |
| `README.md`           | 配置、构建、启动和文档入口。                        |
| `config.yaml`         | 非密钥运行时配置。                                  |
| `.env.example`        | 本地 `.env` 模板。                                  |
| `package.json`        | npm scripts、依赖、格式化和测试入口。               |
| `tsconfig.json`       | TypeScript runtime 编译配置。                       |
| `vitest*.config.ts`   | 确定性测试和 eval 测试配置。                        |
| `docs/`               | 架构、规范、测试、记忆和 Topic Script 文档。        |
| `scripts/`            | 启动辅助、弹幕桥接、预检、日志导出和研究脚本。      |
| `evals/`              | 依赖真实模型的能力评估，不作为普通单元测试运行。    |
| `test/`               | 不依赖真实网络和真实 LLM 的确定性测试。             |
| `assets/renderer/`    | Live renderer 客户端、样例数据、vendor 和模型目录。 |
| `memory/`             | 本地运行时记忆数据，不作为源码规范化目标。          |
| `data/topic_scripts/` | Topic Script 草稿、审核稿和编译产物。               |

## Runtime Source

| Path                | Role                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `src/start.ts`      | CLI 入口，选择 `runtime`、`discord`、`live` 模式。                                         |
| `src/core/`         | 通用协议、Component registry/loader、DataPlane、watchdog、安全原语。                       |
| `src/runtime/`      | 应用启动、依赖容器、调度器、模块注册和 legacy cursor runtime host。                        |
| `src/capabilities/` | 可复用能力：RuntimeKernel、stage output、memory、reflection、program、perception、action。 |
| `src/windows/`      | 平台/场景组合层：live、discord、browser、desktop input、renderer bridge 和 adapters。      |
| `src/debug/`        | Debug server shell、认证、命令风险规则、DebugProvider contract。                           |
| `src/tools/`        | ToolRegistry、工具 schema、安全策略和按域拆分的默认工具 provider。                         |
| `src/utils/`        | EventBus、事件 schema、平台 runtime、JSON/text/TTS/live helpers。                          |

## Live Renderer

`assets/renderer/client/src/` 是浏览器端舞台：

| File                   | Role                                       |
| ---------------------- | ------------------------------------------ |
| `main.ts`              | Socket 命令入口、表单绑定、基础 UI 状态。  |
| `renderer_protocol.ts` | 浏览器端命令和 widget payload 类型。       |
| `program_widgets.ts`   | 直播节目面板和 widget 渲染。               |
| `audio_controller.ts`  | 音频队列、播放、字幕同步和 lip sync 调度。 |
| `live2d.ts`            | Live2D/Pixi 初始化、动作和表情控制。       |
| `style.css`            | 舞台、面板、状态和响应式样式。             |

## Tool Providers

`src/tools/providers/default_tools.ts` 只保留兼容导出；实际实现按域拆分：

- `core_tools.ts`：时间、计算、文件系统、命令执行。
- `discord_tools.ts`：Discord 读取与发送。
- `live_tools.ts`：直播舞台、OBS 和 topic 更新。
- `memory_tools.ts`：recent、long-term、proposal 和 research log。
- `search_tools.ts`：公共网页搜索和读取。
- `tts_tools.ts`：TTS 文件生成。
- `scene_tools.ts`：场景观察。
- `workspace.ts`：workspace path 和原子写入 helper。

## Memory Layout

运行时生成的记忆默认放在 `memory/`：

```text
memory/
├── discord/
│   ├── channels/<channel-id>/recent.jsonl
│   ├── channels/<channel-id>/history.md
│   └── global/
├── live/
│   ├── recent.jsonl
│   └── history.md
└── long_term/
    ├── observations/
    ├── user_facts/
    ├── self_state/
    ├── core_identity/
    ├── research_logs/
    └── proposals/
```

生成规则和检索规则见 [`MEMORY_GENERATION.md`](MEMORY_GENERATION.md)。

# 架构与代码规范 (Architecture & Conventions)

Stelle 是一个模块化、事件驱动的 VTuber/Streamer AI 运行时。
这份文档规定了开发时的代码导航路径、严格架构边界与项目约定。

---

## 1. 核心架构边界 (Architecture Boundaries)

系统划分为四个核心层。**高层可依赖低层，但绝对禁止反向依赖或跨层强耦合。**

| Layer               | 职责范围                                                                                                   | 禁止包含的逻辑                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/core/`         | 协议契约（Protocol）、EventBus、config helper、组件注册与加载、DataPlane（重负载数据）、资源策略、看门狗。 | 具体的能力实现、Window、宿主（Host）或 Debug 服务器逻辑。 |
| `src/runtime/`      | `RuntimeHost` 编排启动流、选择并加载 package、注册引导层服务。                                             | 具体的领域策略或包的内部实现逻辑。                        |
| `src/capabilities/` | 可复用的能力逻辑（Cognition, Expression, Memory, Program, Perception, Action, Tooling）。                  | 具体的 Window 或平台 Adapter 的生命周期逻辑。             |
| `src/windows/`      | 场景/平台组合层（Live, Discord, Browser, Desktop 等），渲染层桥接，平台事件转换。                          | 可复用的认知、记忆、输出或动作控制的领域策略。            |
| `src/debug/`        | Debug 服务器外壳、认证拦截与命令风险规则。                                                                 | Package 内部实现逻辑或特定的平台所有权。                  |

**特别说明**：

- 基础工具代码在 `src/capabilities/tooling/`。
- 特定领域的工具与自己的包放在一起，例如：`src/windows/live/tools.ts` 或 `src/capabilities/memory/store/tools.ts`。

---

## 2. 运行时与数据流转 (Runtime & Data Flow)

### 运行时启动流 (Runtime Startup Flow)

1. CLI 入口 (`src/start.ts`) 创建 `RuntimeHost` (`src/runtime/host.ts`)。
2. 读取包配置 (`config.yaml`) 和环境变量。
3. 实例化 Core 层的总线与中心系统（EventBus, Registry, ComponentLoader, DataPlane, DebugServer）。
4. 注册引导组件（Bootstrap services），如 Discord/Live 运行时、LLM、Memory、ToolRegistry。
5. 按模式依次加载 `ComponentPackage` 并启动生命周期 (`register` -> `start`)。
6. 各个 Window 开始监听外界平台并将之转化为中立事件，Capability 开始消费与处理。

### 组件包生命周期 (Component Package Lifecycle)

每个包具有统一生命周期控制，支持挂起与恢复：

- `register(ctx)`: 暴露服务、注册处理器和查询模型。
- `hydrateState(state)`: 注入持久化的恢复状态。
- `start(ctx)`: 启动活动任务（监听循环等）。
- `prepareUnload()`: 决定剩余任务如何处理（排队、取消或抛弃）。
- `snapshotState()`: 生成快照。
- `stop(ctx)`: 停止活动任务。

### 核心事件总线 (Event Protocol)

跨领域消息通信统一使用 `src/core/event/event_schema.ts` 的事件封包规范。
常见的事件线包括：

- `perceptual.event`: Window 收到的外部信息，发给内核。
- `cognition.intent`: 内核运算完毕后下发的意图。
- `stage.output.*` / `device.action.*`: 舞台与设备的仲裁状态流转。
- `topic_script.*`: 剧本的编排与运行事件。

### 数据平面 (Data Plane)

EventBus 只用来传递控制面事件（小负载）。大负载数据必须进入 **DataPlane**：

- 图像、视频帧、长段落文本、流式音频（Audio chunks）。
  通过 `DataPlane.putBlob()` 等方式获取 `ResourceRef`，再在 EventBus 中传递该 Reference。

### 输出与设备所有权 (Output & Device Ownership)

所有外部动作必须经过特定的 Arbiter 仲裁，不得在 Package 内部私自调用外部发送 API。

- **舞台输出 (Stage Output)**: `Perceptual` -> `Intent` -> `StageOutputCapability` -> `StageOutputArbiter` -> `Renderer`
- **程序编排 (Program Output)**: `Program Proposal` -> `StageOutputCapability` -> `StageOutputArbiter` -> `Renderer`
- **设备操作 (Device Action)**: `Action Service` -> `DeviceActionCapability` -> `DeviceActionArbiter` -> `Driver Package`

---

## 3. 编码规范 (Project Conventions)

### 格式化

- 使用 Prettier 统一格式：`npm run format` / `npm run format:check`
- 不参与格式化的有 `dist/`, `memory/`, `evals/logs/` 等生成产物。

### TypeScript ESM 约束

- 本项目采用 Node.js 原生 ESM 机制，**源代码中的 import 必须显式加上 `.js` 后缀**（即便该文件实际后缀为 `.ts`）。
- 优先使用明确类型、Zod 结构验证，杜绝一切没有保证的 "any" 黑盒。

### 安全原则 (Security)

- 严禁将控制层（Debug / Control Route）暴露到公网。
- 读取外部 URL 的工具实现必须经过 SSRF 检查拦截。
- 文件系统操作能力必须约束在 `Workspace` 指定的根目录下。

### 注释原则

- **避免过度注释**：不要对普通的 getter/setter 或者从命名一眼可知的功能进行 JSDoc 滥写。
- **只在关键点注释**：模块出口边界、复杂状态机流转、由于历史原因采用非直觉 Fallback 的设计点。

---

## 4. 常见扩展指南 (Extension Guides)

### 怎么增加一个新工具 (Tool)?

1. 如果是领域特定的工具，放在拥有它的 package 下（如 `src/windows/live/tools.ts`）。
2. 在该包的 `register()` 钩子中，调用 `tools.registry.register(...)`。
3. 补齐严格的 Zod Input Schema、需要的权限层级（Authority）和副作用审计配置（Side effect metadata）。

### 怎么增加一个新直播平台 (Live Platform Adapter)?

1. 在 `src/windows/live/adapters/` 目录下创建新平台适配器。
2. 捕获真实事件，将其转换、清洗为标准的 `NormalizedLiveEvent` 和 `PerceptualEvent`。
3. 注册到 `LivePlatformManager`，并补充 dry-run（本地脱水测试）相关的自动化验证。

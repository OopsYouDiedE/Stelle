# Stelle 架构重整计划（Plan.md）

> 目标读者：Codex / 代码代理 / 未来维护者  
> 目标：将 Stelle 重整为严格的 `Core / Debug / Capability / Window` 架构，同时补充 Data Plane / Bypass、背压、热插拔水化、故障隔离等工程机制。  
> 状态：用于渐进式重构的执行计划。

---

## 0. 核心原则

Stelle 必须围绕 **能力（Capability）** 和 **窗口（Window）** 重新组织，而不是继续围绕历史平台、旧 Cursor 边界或临时文件分区组织。

新的架构由四个顶层概念组成：

```txt
Core        = 通用运行时基础
Debug       = 可观测性与控制面外壳
Capability  = 可复用、可热插拔的模块化能力
Window      = 场景 / 平台组合层
```

最重要的规则：

> **Core 不负责任何业务逻辑。Core 不知道任何具体 Capability 或 Window。Core 只能定义通用契约、生命周期、事件、配置、安全原语、资源引用和运行时组件加载/卸载机制。**

其他代码可以调用 Core。  
Core 不得导入具体 Capability、Window、Debug 面板、Bilibili、Discord、Live2D、TTS、浏览器、Android、Topic Script 等代码。

---

## 1. 新架构层级

### 1.1 Core

Core 是通用运行时基础。

Core 拥有：

```txt
- runtime 生命周期原语
- 配置加载原语
- event bus 与事件元数据
- component package 契约
- component registry
- runtime load / unload 机制
- clock 与 scheduler 原语
- protocol 类型
- data plane / resource registry / stream registry 的通用抽象
- security 原语
- error 类型
- logging 原语
- dependency injection 接口
```

Core 不得拥有：

```txt
- 直播业务逻辑
- Discord 行为逻辑
- Bilibili / Twitch / YouTube adapter
- TTS 行为逻辑
- Live2D 行为逻辑
- 浏览器 / 设备行为逻辑
- Topic Script 行为逻辑
- Stelle 人格或记忆语义
- prompt 内容
- LLM planning policy
- stage output policy
- debug panel 具体内容
```

Core 不是“大脑”。  
Core 是允许大脑、能力、窗口、Debug 面板被挂载的运行时基座。

### 1.2 Debug

Debug 是可观测性与控制面外壳。

Debug 拥有：

```txt
- debug server
- debug window / web UI shell
- debug authentication middleware
- panel registry
- debug command routing
- debug event stream display
- remote-safe access rules
```

Debug 不得自己编写领域专属调试内容。

每个 Capability 或 Window 可以贡献自己的 DebugProvider：

```ts
interface DebugProvider {
  id: string;
  title: string;
  ownerPackageId: string;
  panels?: DebugPanelDefinition[];
  commands?: DebugCommandDefinition[];
  getSnapshot?(): Promise<unknown> | unknown;
}
```

Debug 只负责装载和渲染这些 provider。

Debug 不得直接导入：

```txt
- live window 内部实现
- Discord window 内部实现
- 具体 capability 内部实现
- Bilibili adapter 内部实现
- TTS 实现内部
- browser driver 内部
```

Debug 可以依赖 Core protocol 和 Core component registry。

### 1.3 Capability

Capability package 提供可复用、可独立使用的模块化能力。

Capability 必须能够作为一个完整能力单元被单独装载、启动、停止、卸载。

示例：

```txt
- cognition.runtime_kernel
- cognition.attention
- cognition.planner
- cognition.drive_engine
- perception.text_ingress
- perception.moderation
- expression.stage_output
- expression.speech_output
- expression.avatar_motion
- memory.store
- memory.viewer_profile
- action.device_action
- action.browser_control
- action.desktop_input
- program.stage_director
- program.topic_script
```

Capability 拥有实际能力实现。

Capability 可以依赖：

```txt
- Core contracts
- 其他 Capability 的公开 contract / read-only service
- Debug provider contract，仅用于导出 debug provider
```

Capability 不得依赖：

```txt
- 具体 Window 实现
- 具体平台 adapter
- debug window 实现
- application boot mode
```

Capability 可以暴露：

```txt
- service API
- event handlers
- intent handlers
- debug provider
- configuration schema
- lifecycle hooks
```

### 1.4 Window

Window package 将能力组合成具体交互场景。

示例：

```txt
- live_window
- discord_window
- stage_window
- browser_window
- debug_window
- future_android_window
- future_minecraft_window
```

Window 拥有：

```txt
- platform adapters
- platform connection lifecycle
- 从平台事件到 Core protocol event 的转换
- 所选 capabilities 的组合
- 面向用户 / 平台的场景接口
- window-level debug provider
```

Window 不得实现可复用能力逻辑。

例如：

```txt
Bilibili WebSocket adapter      -> Window
弹幕文本标准化管线              -> Window + perception capability 边界
attention scoring               -> Capability
LLM response planning           -> Capability
stage output arbitration        -> Capability
TTS playback                    -> Capability
Live2D renderer bridge           -> Window 或 expression capability adapter 边界
```

Window 是组合层，不是能力实现层。

---

## 2. 依赖方向规则

### 2.1 允许的方向

```txt
Debug      -> Core
Capability -> Core
Window     -> Core
Window     -> Capability
Capability -> Capability contract / read-only service
Debug      -> DebugProvider objects registered by packages
```

### 2.2 禁止的方向

```txt
Core       -> Capability
Core       -> Window
Core       -> Debug concrete panels
Capability -> Window
Capability -> concrete platform adapter
Debug      -> Capability internals
Debug      -> Window internals
```

### 2.3 实际 import 规则

Core 文件不得 import：

```txt
src/capabilities/
src/windows/
src/debug/panels/
src/live/
src/cursor/
src/stage/
src/device/
src/tools/providers/
```

Capability 文件不得 import：

```txt
src/windows/
src/live/adapters/
src/cursor/live/
src/cursor/discord/
src/core/application.ts
```

Window 文件可以 import：

```txt
src/core/
src/capabilities/
```

Debug shell 文件可以 import：

```txt
src/core/
src/debug/contracts/
```

Debug shell 文件不应 import 具体 capability 实现文件。

---

## 3. Control Plane / Data Plane / Bypass 机制

### 3.1 Bypass 的定义

Bypass 不允许绕过安全、审计和生命周期。

Bypass 只允许绕过 **EventBus 的大数据传输路径**。

也就是说：

```txt
Control Plane 继续走 Core / Event / Intent / ExecutionCommand
Data Plane 走 ResourceRef / StreamRef / DataPlane
```

核心原则：

```txt
EventBus 管“发生了什么”
DataPlane 管“重数据在哪里”
RuntimeKernel 管“这意味着什么”
Capability 管“我能做什么”
Window 管“这个世界怎么接进来”
```

不要把视频帧、音频 PCM、大截图、大型 JSON、超长上下文直接塞进 EventBus。

错误示例：

```ts
event.payload = {
  screenshotBase64: "...几十 MB...",
  audioPcm: new Float32Array(...),
}
```

正确示例：

```ts
event.payload = {
  frameRef: {
    id: "frame_abc",
    kind: "image",
    mediaType: "image/png",
    sizeBytes: 842133,
    ownerPackageId: "window.browser",
    ttlMs: 5000,
  }
}
```

大数据不上总线，总线只传引用。

### 3.2 Control Plane

Control Plane 承载：

```txt
- PerceptualEvent
- Intent
- ExecutionCommand
- ExecutionResult
- 状态变更事件
- 生命周期事件
- Debug 命令
- 审计事件
```

EventBus 只应传递轻量事件。

建议限制：

```txt
单个 Event payload 默认 < 64 KB
超过 64 KB 必须进入 DataPlane
```

### 3.3 Data Plane

Data Plane 承载：

```txt
- 图片
- 音频 chunk
- 视频帧
- 长文本 blob
- 大型 JSON
- 浏览器快照
- 场景快照
- embedding
- 模型上下文块
- 外部资源句柄
```

Core 负责 DataPlane 的通用机制，但不解释数据语义。

Core 只知道：

```txt
- resource id
- kind
- mediaType
- ownerPackageId
- createdAt
- ttlMs
- sizeBytes
- accessScope
- metadata
```

Core 不知道某个 PNG 是浏览器截图、游戏画面还是直播画面。

### 3.4 新增 Core DataRef 协议

新增：

```txt
src/core/protocol/data_ref.ts
```

```ts
export type DataRefKind =
  | "text_blob"
  | "json_blob"
  | "image"
  | "audio_chunk"
  | "video_frame"
  | "embedding"
  | "browser_snapshot"
  | "scene_snapshot";

export interface ResourceRef {
  id: string;
  kind: DataRefKind;
  mediaType?: string;
  ownerPackageId: string;
  createdAt: number;
  ttlMs: number;
  sizeBytes?: number;
  checksum?: string;
  accessScope: "private" | "runtime" | "debug" | "public";
  metadata?: Record<string, unknown>;
}

export interface StreamRef {
  id: string;
  kind: "audio_stream" | "video_stream" | "event_stream" | "state_stream";
  ownerPackageId: string;
  createdAt: number;
  transport: "memory_ring" | "message_port" | "websocket" | "file_tail" | "external_url";
  latestOnly: boolean;
  sampleRateHz?: number;
  fps?: number;
  metadata?: Record<string, unknown>;
}
```

### 3.5 新增 DataPlane 接口

新增：

```txt
src/core/runtime/data_plane.ts
src/core/runtime/resource_registry.ts
src/core/runtime/stream_registry.ts
src/core/security/resource_access_policy.ts
```

最小接口：

```ts
export interface DataPlane {
  putBlob(input: {
    ownerPackageId: string;
    kind: DataRefKind;
    mediaType?: string;
    data: Uint8Array | string | object;
    ttlMs: number;
    accessScope?: ResourceRef["accessScope"];
    metadata?: Record<string, unknown>;
  }): Promise<ResourceRef>;

  readBlob(
    ref: ResourceRef,
    requesterPackageId: string,
  ): Promise<Uint8Array | string | object>;

  release(refId: string, requesterPackageId: string): Promise<void>;

  createStream(input: {
    ownerPackageId: string;
    kind: StreamRef["kind"];
    transport?: StreamRef["transport"];
    latestOnly?: boolean;
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<StreamRef>;

  subscribe(
    streamRef: StreamRef,
    requesterPackageId: string,
  ): AsyncIterable<unknown>;
}
```

### 3.6 四档数据路径

#### 第一档：Inline Payload

适合：

```txt
- 弹幕文本
- Discord 消息
- 轻量 JSON
- 状态变更
- 普通 Intent
- ExecutionResult
```

限制：

```txt
payload < 64 KB
```

直接走 EventBus。

#### 第二档：Blob Resource

适合：

```txt
- 截图
- 中型 JSON
- 长上下文
- 临时 prompt block
- 短音频片段
- 工具返回的大文本
```

流程：

```txt
DataPlane.putBlob(data) -> ResourceRef
EventBus.publish({ payload: { ref } })
consumer.read(ref)
```

限制：

```txt
64 KB ~ 10 MB
必须有 TTL
默认不持久化
Debug 可查看 metadata，但不默认下载内容
```

#### 第三档：Stream Resource

适合：

```txt
- 麦克风音频流
- TTS 播放状态流
- 浏览器连续截图
- Live2D 渲染状态
- 设备状态轮询
- 游戏画面
```

流程：

```txt
DataPlane.createStream() -> StreamRef
producer.write(stream, chunk)
consumer.subscribe(stream)
```

必须有背压策略。不要假设所有帧都能处理。

#### 第四档：External Handle

适合：

```txt
- 文件路径
- Browser DevTools session
- WebRTC track
- OBS source
- 外部 Python TTS server
- 外部视觉模型服务
```

EventBus 只传 handle，不传内容。

外部 URL / socket / file handle 必须经过权限控制，Debug 远程模式不得默认访问。

### 3.7 RuntimeKernel 与多模态数据

RuntimeKernel 默认不处理原始视频帧、音频流和大截图。

RuntimeKernel 应该处理：

```txt
- 文本事件
- 结构化观察
- 压缩后的 scene observation
- 重要帧引用
- 用户行为摘要
- 必要时按需读取的一帧 / 一段音频
```

视觉能力应该处理高带宽输入，然后只向 Kernel 输出观察结果：

```ts
{
  type: "scene.observation.received",
  payload: {
    sceneRef: "scene_123",
    summary: "页面上有一个登录按钮和一个错误提示",
    objects: [
      { label: "button", text: "登录", bbox: [100, 200, 180, 240] },
      { label: "error", text: "密码错误", bbox: [90, 260, 300, 300] }
    ],
    confidence: 0.82
  }
}
```

Kernel 只有在需要进一步判断时，才通过 ResourceRef 读取原图。

推荐链路：

```txt
Browser / Scene Window
  -> video frame into DataPlane
  -> EventBus publishes frameRef
  -> SceneObservation Capability reads frameRef
  -> emits scene summary event
  -> RuntimeKernel reads summary, not raw frame

Audio Input
  -> audio stream into DataPlane
  -> ASR Capability consumes stream
  -> emits transcript PerceptualEvent
  -> RuntimeKernel handles transcript
```

---

## 4. 跨模块同步读取与异步事件的规则

### 4.1 允许低延迟 Read Service

Capability 之间允许暴露同步 / 低延迟 Service API，但只用于查询。

采用 CQS 原则：

```txt
Query   = 可以同步读取
Command = 必须事件化 / Intent 化 / ExecutionCommand 化
```

例如 RuntimeKernel 查询用户画像：

```ts
const viewerProfile = registry.resolve<ViewerProfileService>("memory.viewer_profile");
const profile = await viewerProfile?.getViewerSummary(actorId);
```

这是允许的，因为它是 read model 查询。

### 4.2 禁止跨 Capability 直接写状态

不允许这样：

```ts
viewerProfile.update(...)
```

应改为：

```txt
Event / Intent:
viewer_profile.observed_interaction
```

规则：

```txt
读可以同步，写必须事件化。
低延迟 read model 可以 Service API。
有副作用、有审计需求、有状态变更的行为走 Event / Intent / ExecutionCommand。
```

这个规则用于避免两个极端：

```txt
- 所有东西都同步调用，导致耦合腐化
- 所有东西都异步事件化，导致认知链路延迟爆炸
```

---

## 5. Window 与 Perception 的职责边界

### 5.1 三层边界

```txt
Window adapter：
  只做平台协议解析，得到平台无关的初级结构。

Perception capability：
  做通用归一化、moderation、batch、去重、特征提取。

Cognition capability：
  做注意力判断、是否回应、如何回应。
```

Bilibili adapter 可以知道：

```txt
DANMU_MSG
SEND_GIFT
SUPER_CHAT_MESSAGE
GUARD_BUY
```

RuntimeKernel 不应该知道这些词。

### 5.2 平台元数据允许存在，但 Kernel 不得依赖

Window 输出事件可以包含平台 metadata：

```ts
{
  type: "live.text_message",
  sourceWindow: "live.bilibili",
  payload: {
    text: "主播在吗",
    actor: { id: "...", displayName: "..." },
    platformKind: "chat",
    trust: { paid: false }
  },
  metadata: {
    rawPlatform: "bilibili",
    rawCommand: "DANMU_MSG"
  }
}
```

Kernel 可以读取：

```txt
text
actor
trust
priority
semantic intent
```

Kernel 不应该依赖：

```txt
rawCommand === "DANMU_MSG"
platform === "bilibili"
```

---

## 6. 背压（Backpressure）与队列策略

### 6.1 背压必须分三层

背压不是一个地方能解决的，必须三层都有：

```txt
1. Window 入口限流
2. EventBus / DataPlane 有 bounded queue
3. Capability 自己声明 queue policy
```

### 6.2 队列语义

DataPlane / EventBus / Capability 队列必须支持三种语义：

```txt
lossless：
  不可丢。例如付费事件、用户命令、关键执行结果。

bounded：
  有上限。例如普通聊天事件，满了合并或丢低优先级。

latest-only：
  只保留最新。例如画面帧、鼠标位置、OBS 状态、设备状态。
```

不要把所有事件都当 lossless。直播弹幕、视频帧、状态轮询不能全量 lossless，否则系统一定会爆。

### 6.3 BackpressureStatus

新增协议：

```ts
export interface BackpressureStatus {
  streamId?: string;
  queueId?: string;
  consumerId: string;
  bufferedItems: number;
  droppedItems: number;
  lagMs: number;
  recommendedAction:
    | "ok"
    | "slow_down"
    | "sample"
    | "drop_low_priority"
    | "latest_only";
}
```

### 6.4 PackageBackpressurePolicy

Capability / Window 可以声明自己的队列策略：

```ts
interface PackageBackpressurePolicy {
  maxQueueSize: number;
  overflow:
    | "drop_oldest"
    | "drop_newest"
    | "merge"
    | "latest_only"
    | "reject";
  priorityKey?: string;
}
```

### 6.5 直播场景默认策略

```txt
普通弹幕：
  merge / drop_oldest / semantic coalesce

提问弹幕：
  保留，允许合批

礼物 / SC / 上舰：
  lossless，不得静默丢弃

入场 / 点赞：
  sampled / latest summary

视频帧：
  latest-only

音频 chunk：
  bounded，过期 chunk 直接丢，最终 transcript 进入 Kernel

设备状态：
  latest-only，只有变化超过阈值才发事件
```

---

## 7. RuntimeKernel 防 God Object 规则

### 7.1 RuntimeKernel 是 Capability，不是 Core

RuntimeKernel 位于：

```txt
src/capabilities/cognition/runtime_kernel/
```

它不属于 Core。

Core 只负责加载 RuntimeKernel capability，不知道其内部认知逻辑。

### 7.2 RuntimeKernel 是管线宿主，不是所有逻辑的存放处

RuntimeKernel 不能重新变成 LiveDanmakuCursor 的替代版上帝对象。

RuntimeKernel 内部必须是 pipeline：

```txt
InputNormalizer
AttentionPolicy
ContextAssembler
Planner
IntentReducer
DriveEngine
ExecutionFeedbackHandler
```

Kernel 只负责调度这些 stage。

示例：

```ts
class RuntimeKernel {
  async step(event: PerceptualEvent) {
    const enriched = await this.pipeline.enrich(event);
    const attention = await this.pipeline.attention.evaluate(enriched, this.state);

    if (!attention.accepted) {
      return ignored(attention.reason);
    }

    const context = await this.pipeline.context.build(enriched, this.state);
    const intents = await this.pipeline.planner.plan(context);
    return this.pipeline.reducer.reduce(intents, this.state);
  }
}
```

### 7.3 Pipeline Stage 可替换

RuntimeKernel 内部 stage 应该通过接口组合：

```ts
interface KernelPipelineStage<TInput, TOutput> {
  id: string;
  run(input: TInput, state: RuntimeKernelState): Promise<TOutput>;
}
```

不要把所有判断硬写进 `kernel.ts`。

### 7.4 每个 KernelDecision 必须有 reason

所有决策都必须可解释：

```ts
type KernelDecision =
  | { kind: "ignored"; reason: string; sourceEventIds: string[] }
  | { kind: "intent"; intent: Intent; reason: string }
  | { kind: "state_updated"; reason: string; sourceEventIds?: string[] };
```

不允许 silent drop。

---

## 8. 热插拔与状态水化（Hydration）

### 8.1 状态分类

Capability / Window 状态分三类：

```txt
Ephemeral State：
  临时状态，卸载就丢。例如当前 batch buffer。

Durable State：
  持久状态，写入 store。例如 viewer profile、long-term memory。

Transferable State：
  可迁移状态。例如 planner 当前 pending intents、kernel state snapshot。
```

### 8.2 ComponentPackage 状态生命周期

ComponentPackage 可选实现：

```ts
interface StatefulComponentPackage extends ComponentPackage {
  snapshotState?(): Promise<unknown>;
  hydrateState?(state: unknown): Promise<void>;
  prepareUnload?(): Promise<UnloadPlan>;
}

interface UnloadPlan {
  acceptNewWork: false;
  pendingWork:
    | "drain"
    | "cancel"
    | "handoff"
    | "drop_expired";
  estimatedMs?: number;
  reason: string;
}
```

### 8.3 安全卸载流程

卸载不是直接 kill。

流程：

```txt
1. stop accepting new work
2. drain / cancel pending work
3. snapshot transferable state
4. release ResourceRef / StreamRef
5. unregister debug provider
6. unload old package
7. load new package
8. hydrate state
9. resume accepting work
```

### 8.4 LLM 请求迁移策略

正在进行中的 LLM 请求通常不需要完美接管。

允许策略：

```txt
- 旧请求允许完成，但结果如果版本过期就丢弃
- 或卸载时通过 AbortController 取消
- 新版本通过 hydrateState 接管可迁移状态
```

不要追求所有异步 work 无缝迁移，否则复杂度会失控。

---

## 9. 故障隔离与容灾策略

### 9.1 初版允许同进程，但协议必须预留隔离模式

ComponentPackage 可以声明 isolation mode：

```ts
type IsolationMode =
  | "in_process"
  | "worker_thread"
  | "external_process";

interface ComponentPackage {
  isolation?: IsolationMode;
}
```

### 9.2 三档隔离

```txt
in_process：
  默认，最快，适合稳定核心能力。

worker_thread：
  适合高 CPU / 可能卡顿的能力，例如视觉、语音、浏览器控制。

external_process：
  适合高风险或第三方平台适配器，例如 B站连接、Python TTS、实验性模型服务。
```

### 9.3 故障处理规则

```txt
- 一个 Window 崩溃，不应拖垮 RuntimeKernel。
- 一个高风险 Capability 卡死，应能被 watchdog 发现并停止。
- external_process 失败后，Core 只记录 ExecutionResult / health event，不解释业务语义。
- Debug 应显示 package health / crash reason / restart count。
```

### 9.4 未来 Watchdog

预留：

```txt
src/core/runtime/watchdog.ts
```

职责：

```txt
- package heartbeat
- timeout detection
- worker/external process restart
- crash audit event
- debug health exposure
```

---

## 10. 目标目录结构

最终目标结构：

```txt
src/
  core/
    config/
      config_schema.ts
      env.ts
      loader.ts

    event/
      event_bus.ts
      event_schema.ts
      event_history.ts

    protocol/
      perceptual_event.ts
      intent.ts
      execution.ts
      data_ref.ts
      debug.ts
      component.ts

    runtime/
      clock.ts
      scheduler.ts
      lifecycle.ts
      component_registry.ts
      component_loader.ts
      runtime_host.ts
      data_plane.ts
      resource_registry.ts
      stream_registry.ts
      watchdog.ts

    security/
      auth_token.ts
      access_policy.ts
      remote_debug_policy.ts
      resource_access_policy.ts

    errors/
      errors.ts

    logging/
      logger.ts

    container/
      service_container.ts

    index.ts

  debug/
    contracts/
      debug_provider.ts
      debug_panel.ts
      debug_command.ts

    server/
      debug_server.ts
      debug_auth.ts
      debug_routes.ts
      debug_events.ts

    window/
      debug_window.ts
      panel_registry.ts
      panel_loader.ts

    client/
      # optional future debug UI client

    index.ts

  capabilities/
    cognition/
      runtime_kernel/
        kernel.ts
        pipeline.ts
        state.ts
        policy.ts
        planner.ts
        drive_engine.ts
        replay.ts
        package.ts
        debug_provider.ts
        types.ts

      attention/
        attention_policy.ts
        package.ts
        debug_provider.ts
        types.ts

      reflection/
        reflection_engine.ts
        package.ts
        debug_provider.ts
        types.ts

    perception/
      text_ingress/
        normalizer.ts
        batcher.ts
        package.ts
        debug_provider.ts
        types.ts

      moderation/
        input_moderation.ts
        output_moderation.ts
        package.ts
        debug_provider.ts
        types.ts

      scene_observation/
        observer.ts
        package.ts
        debug_provider.ts
        types.ts

    expression/
      stage_output/
        arbiter.ts
        budget.ts
        policy.ts
        queue.ts
        renderer.ts
        package.ts
        debug_provider.ts
        types.ts

      speech_output/
        tts_client.ts
        tts_queue.ts
        package.ts
        debug_provider.ts
        types.ts

      avatar_motion/
        motion_mapper.ts
        expression_mapper.ts
        package.ts
        debug_provider.ts
        types.ts

      caption_output/
        caption_renderer.ts
        package.ts
        debug_provider.ts
        types.ts

    memory/
      store/
        memory_store.ts
        recent_memory.ts
        long_term_memory.ts
        package.ts
        debug_provider.ts
        types.ts

      viewer_profile/
        viewer_profile_store.ts
        relationship_service.ts
        package.ts
        debug_provider.ts
        types.ts

    action/
      device_action/
        arbiter.ts
        allowlist.ts
        policy.ts
        package.ts
        debug_provider.ts
        types.ts

      browser_control/
        browser_driver.ts
        package.ts
        debug_provider.ts
        types.ts

      desktop_input/
        desktop_driver.ts
        package.ts
        debug_provider.ts
        types.ts

      android_device/
        adb_driver.ts
        package.ts
        debug_provider.ts
        types.ts

    program/
      stage_director/
        stage_director.ts
        orchestrator.ts
        public_memory.ts
        world_canon.ts
        prompt_lab.ts
        package.ts
        debug_provider.ts
        types.ts

      topic_script/
        runtime.ts
        review.ts
        repository.ts
        compiler.ts
        package.ts
        debug_provider.ts
        types.ts

  windows/
    live/
      live_window.ts
      package.ts
      debug_provider.ts
      adapters/
        bilibili_adapter.ts
        twitch_adapter.ts
        youtube_adapter.ts
        tiktok_adapter.ts
      bridge/
        live_renderer_bridge.ts
      types.ts

    discord/
      discord_window.ts
      package.ts
      debug_provider.ts
      adapters/
        discord_adapter.ts
      types.ts

    stage/
      stage_window.ts
      package.ts
      debug_provider.ts
      renderer/
        renderer_server.ts
        local_renderer_bridge.ts
      types.ts

    browser/
      browser_window.ts
      package.ts
      debug_provider.ts
      types.ts

  shared/
    json.ts
    text.ts
    ids.ts
    fs.ts
    time.ts

  start.ts
```

重要：这是重构完成后的目标结构。  
不要一次性移动所有文件。按迁移阶段执行。

---

## 11. Core Protocol Contracts

Core protocol types 是 Core、Capability、Window、Debug 之间的稳定边界。

### 11.1 ComponentPackage Contract

新增：

```txt
src/core/protocol/component.ts
```

```ts
export type ComponentKind = "capability" | "window" | "debug";

export interface ComponentPackage {
  id: string;
  kind: ComponentKind;
  version: string;
  displayName: string;

  isolation?: "in_process" | "worker_thread" | "external_process";

  requires?: ComponentRequirement[];
  provides?: ComponentProvision[];

  register(context: ComponentRegisterContext): Promise<void> | void;
  start?(context: ComponentRuntimeContext): Promise<void> | void;
  stop?(context: ComponentRuntimeContext): Promise<void> | void;

  snapshotState?(): Promise<unknown>;
  hydrateState?(state: unknown): Promise<void>;
  prepareUnload?(): Promise<UnloadPlan>;

  getDebugProvider?(): DebugProvider | undefined;
}

export interface ComponentRequirement {
  id: string;
  kind?: ComponentKind;
  optional?: boolean;
}

export interface ComponentProvision {
  id: string;
  kind:
    | "service"
    | "read_model"
    | "event_handler"
    | "intent_handler"
    | "debug_provider";
}

export interface ComponentRegisterContext {
  registry: ComponentRegistry;
  events: EventBus;
  dataPlane: DataPlane;
  config: ConfigReader;
  logger: Logger;
  security: SecurityService;
}

export interface ComponentRuntimeContext extends ComponentRegisterContext {
  clock: Clock;
}
```

Core 定义 contract，但不导入具体 package。

### 11.2 PerceptualEvent

新增：

```txt
src/core/protocol/perceptual_event.ts
```

```ts
export interface PerceptualEvent<TPayload = unknown> {
  id: string;
  type: string;
  sourceWindow: string;
  sourceCapability?: string;
  actorId?: string;
  sessionId?: string;
  timestamp: number;
  ttlMs?: number;
  salienceHint?: number;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
```

规则：

```txt
- Platform adapter 将原始平台事件转换为 PerceptualEvent。
- Capability 可以 enrich PerceptualEvent。
- RuntimeKernel 消费 PerceptualEvent。
- Core 不解释 payload 语义。
- 大 payload 必须使用 ResourceRef / StreamRef。
```

### 11.3 Intent

新增：

```txt
src/core/protocol/intent.ts
```

```ts
export type IntentType =
  | "respond"
  | "speak"
  | "act"
  | "remember"
  | "observe"
  | "update_state"
  | "debug";

export interface Intent<TPayload = unknown> {
  id: string;
  type: IntentType;
  sourcePackageId: string;
  targetCapability?: string;
  targetWindow?: string;
  priority: number;
  urgency?: number;
  createdAt: number;
  expiresAt?: number;
  reason: string;
  sourceEventIds?: string[];
  payload: TPayload;
  metadata?: Record<string, unknown>;
}
```

规则：

```txt
- Capability 产生 Intent。
- Window 可以提交外部事件，但不应产生高层 cognition intent，除非是 window-level control intent。
- Expression / Action capability 消费 Intent，并转换为 ExecutionCommand。
```

### 11.4 ExecutionCommand and ExecutionResult

新增：

```txt
src/core/protocol/execution.ts
```

```ts
export interface ExecutionCommand<TPayload = unknown> {
  id: string;
  targetCapability: string;
  targetWindow?: string;
  action: string;
  priority: number;
  createdAt: number;
  ttlMs?: number;
  reason: string;
  payload: TPayload;
  metadata?: Record<string, unknown>;
}

export type ExecutionStatus =
  | "accepted"
  | "queued"
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "dropped"
  | "interrupted";

export interface ExecutionResult<TPayload = unknown> {
  commandId: string;
  status: ExecutionStatus;
  reason?: string;
  timestamp: number;
  payload?: TPayload;
  metadata?: Record<string, unknown>;
}
```

### 11.5 DebugProvider Protocol

新增：

```txt
src/debug/contracts/debug_provider.ts
```

```ts
export interface DebugProvider {
  id: string;
  title: string;
  ownerPackageId: string;
  panels?: DebugPanelDefinition[];
  commands?: DebugCommandDefinition[];
  getSnapshot?(): Promise<unknown> | unknown;
}

export interface DebugPanelDefinition {
  id: string;
  title: string;
  kind: "json" | "table" | "log" | "timeline" | "custom";
  getData(): Promise<unknown> | unknown;
}

export interface DebugCommandDefinition {
  id: string;
  title: string;
  risk: "read" | "safe_write" | "runtime_control" | "external_effect";
  run(input: unknown): Promise<unknown> | unknown;
}
```

规则：

```txt
- Debug 渲染已注册 provider。
- Capability 和 Window 提供自己的 DebugProvider。
- Debug 不知道 provider 内部如何生成数据。
```

---

## 12. 当前代码迁移地图

本节告诉 Codex 现有代码最终应该放置到哪里。

### 12.1 Root / App / Startup

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/start.ts` | `src/start.ts` | 保留为 CLI 入口。应创建 RuntimeHost 并加载 packages。 |
| `src/core/application.ts` | `src/core/runtime/runtime_host.ts` 或 `src/start.ts` orchestration | 拆分。通用生命周期进入 Core。具体 package list 移出 Core。 |
| `src/core/container.ts` | `src/core/container/service_container.ts` + Core 外部 package composition | Core container 不得直接实例化具体 capability/window。 |
| `src/core/scheduler.ts` | `src/core/runtime/scheduler.ts` | 保持通用。尽量移除业务特定 event name。 |
| `src/runtime_state.ts` | `src/core/runtime/runtime_snapshot.ts` 或 Debug snapshot service | 当前更像 debug snapshot，不是 cognition state。 |
| `src/config/*` | `src/core/config/*` | 保留通用配置加载。具体 capability config 由 package 声明。 |

### 12.2 Event / Protocol

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/utils/event_bus.ts` | `src/core/event/event_bus.ts` | 保留为通用 EventBus。 |
| `src/utils/event_schema.ts` | 拆分到 `src/core/event/` + package-owned schemas | Core 不应永久包含所有 live/discord/stage/device schema。迁移期保留兼容导出。 |
| `src/utils/intent_schema.ts` | `src/core/protocol/intent.ts` 或 package-specific intent types | 拆分 generic 和 domain-specific。 |

### 12.3 Data Plane

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| 无 | `src/core/protocol/data_ref.ts` | 新增 ResourceRef / StreamRef。 |
| 无 | `src/core/runtime/data_plane.ts` | 新增 DataPlane 抽象。 |
| 无 | `src/core/runtime/resource_registry.ts` | 新增 blob resource 生命周期管理。 |
| 无 | `src/core/runtime/stream_registry.ts` | 新增 stream 生命周期管理。 |
| 无 | `src/core/security/resource_access_policy.ts` | 新增 ResourceRef / StreamRef 权限策略。 |

### 12.4 Live / Platform Adapters / Window

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/live/adapters/bilibili.ts` | `src/windows/live/adapters/bilibili_adapter.ts` | 平台专属 window adapter。 |
| `src/live/adapters/twitch.ts` | `src/windows/live/adapters/twitch_adapter.ts` | 平台专属 window adapter。 |
| `src/live/adapters/youtube.ts` | `src/windows/live/adapters/youtube_adapter.ts` | 平台专属 window adapter。 |
| `src/live/adapters/tiktok.ts` | `src/windows/live/adapters/tiktok_adapter.ts` | 平台专属 window adapter。 |
| `src/live/adapters/manager.ts` | `src/windows/live/live_window.ts` | Window composition / adapter lifecycle。 |
| `src/live/infra/renderer_server.ts` | `src/windows/stage/renderer/renderer_server.ts` | Renderer 属于 stage window。 |
| `src/utils/live.ts` | 拆分到 `windows/stage/bridge/` 和 expression capabilities | 分离 bridge、OBS、renderer、protocol。 |
| `scripts/bilibili_danmaku_bridge.ts` | `scripts/` 兼容或 `windows/live` dev tool | 暂时保留。 |

### 12.5 Live Cursor / Cognition

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/cursor/live/cursor.ts` | 缩小为 `src/windows/live/live_window.ts` 兼容层或删除 | 当前过胖。决策逻辑迁到 capabilities。 |
| `src/cursor/live/gateway.ts` | `src/capabilities/perception/text_ingress/` + window adapter 边界 | batching/normalization 尽量通用。平台部分进 Window。 |
| `src/cursor/live/router.ts` | `src/capabilities/cognition/runtime_kernel/planner.ts` + `attention_policy.ts` | LLM decision、silent repair、attention rules 进入 cognition capability。 |
| `src/cursor/live/executor.ts` | `src/capabilities/cognition/runtime_kernel/tool_executor_adapter.ts` 或 tooling capability | 工具执行策略属于 capability，不属于 Cursor。 |
| `src/cursor/live/responder.ts` | `src/capabilities/expression/stage_output/` adapter | 将 response intent 转 stage output intent。 |
| `src/cursor/live/types.ts` | 拆分到 cognition/expression/window types | 不要继续集中所有 live types。 |

### 12.6 Inner Cursor / Reflection

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/cursor/inner/cursor.ts` | `src/capabilities/cognition/reflection/reflection_engine.ts` | InnerCursor 成为后台反思 capability。 |
| `src/cursor/inner/research_agenda.ts` | `src/capabilities/cognition/reflection/research_agenda.ts` | capability-local。 |
| `src/cursor/inner/field_sampler.ts` | `src/capabilities/cognition/reflection/field_sampler.ts` | capability-local。 |
| `src/cursor/inner/self_model.ts` | `src/capabilities/cognition/reflection/self_model.ts` | capability-local。 |
| `src/cursor/inner/pressure.ts` | `src/capabilities/cognition/reflection/pressure.ts` | capability-local。 |
| `src/cursor/inner/directive_planner.ts` | `src/capabilities/cognition/reflection/directive_planner.ts` | capability-local。 |
| `src/cursor/inner/memory_writer.ts` | `src/capabilities/cognition/reflection/memory_writer.ts` | 可依赖 memory capability contract。 |

### 12.7 Stage Output / Expression

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/actuator/output_arbiter.ts` | `src/capabilities/expression/stage_output/arbiter.ts` | 当前是较硬模块。基本迁移即可。 |
| `src/stage/output_budget.ts` | `src/capabilities/expression/stage_output/budget.ts` | 迁移。 |
| `src/stage/output_policy.ts` | `src/capabilities/expression/stage_output/policy.ts` | 迁移。 |
| `src/stage/output_queue.ts` | `src/capabilities/expression/stage_output/queue.ts` | 迁移。 |
| `src/stage/output_renderer.ts` | `src/capabilities/expression/stage_output/renderer.ts` | 可能依赖 stage window bridge，接口要清楚。 |
| `src/stage/output_types.ts` | `src/capabilities/expression/stage_output/types.ts` | 迁移或拆出 Core generic intent。 |
| `scripts/kokoro_tts_server.py` | external service script | 保留脚本。通过 `speech_output` capability 包装访问。 |
| TTS helpers in `src/utils/` | `src/capabilities/expression/speech_output/` | 渐进迁移。 |

### 12.8 Device / Action

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/actuator/action_arbiter.ts` | `src/capabilities/action/device_action/arbiter.ts` | 迁移。 |
| `src/device/action_allowlist.ts` | `src/capabilities/action/device_action/allowlist.ts` | 迁移。 |
| `src/device/action_types.ts` | `src/capabilities/action/device_action/types.ts` | 迁移 domain-specific parts。 |
| `src/device/drivers/browser_cdp_driver.ts` | `src/capabilities/action/browser_control/browser_driver.ts` | 迁移。 |
| `src/device/drivers/desktop_input_driver.ts` | `src/capabilities/action/desktop_input/desktop_driver.ts` | 迁移。 |
| `src/device/drivers/android_adb_driver.ts` | `src/capabilities/action/android_device/adb_driver.ts` | 迁移。 |

### 12.9 Program / Live Business

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/live/controller/stage_director.ts` | `src/capabilities/program/stage_director/stage_director.ts` | Program capability。去除平台假设。 |
| `src/live/controller/orchestrator.ts` | `src/capabilities/program/stage_director/orchestrator.ts` | 迁移。 |
| `src/live/controller/public_memory.ts` | `src/capabilities/program/stage_director/public_memory.ts` 或 memory capability | 根据耦合决定。 |
| `src/live/controller/world_canon.ts` | `src/capabilities/program/stage_director/world_canon.ts` | 迁移。 |
| `src/live/controller/prompt_lab.ts` | `src/capabilities/program/stage_director/prompt_lab.ts` | 迁移。 |
| `src/live/controller/topic_script_runtime.ts` | `src/capabilities/program/topic_script/runtime.ts` | 迁移。 |
| `src/live/controller/topic_script_review.ts` | `src/capabilities/program/topic_script/review.ts` | 迁移。 |
| `src/live/controller/topic_script_repository.ts` | `src/capabilities/program/topic_script/repository.ts` | 迁移。 |
| `src/live/controller/replay.ts` | 拆分为 `runtime_kernel/replay.ts` 和 live-window replay tools | 现有 replay 基于 EventBus。新增 deterministic kernel replay。 |
| `src/live/controller/event_journal.ts` | `src/windows/live/journal.ts` 或 debug/live tool | 记录 window event stream。 |
| `src/live/controller/health_service.ts` | `src/windows/live/health.ts` + debug provider | Window-level health。 |
| `src/live/controller/relationship_service.ts` | `src/capabilities/memory/viewer_profile/relationship_service.ts` | 迁移。 |
| `src/live/controller/viewer_profile.ts` | `src/capabilities/memory/viewer_profile/viewer_profile_store.ts` | 迁移。 |

### 12.10 Memory

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/memory/memory.ts` | `src/capabilities/memory/store/memory_store.ts` | 迁移。临时保留兼容导出。 |
| `src/memory/llm.ts` | `src/capabilities/cognition/planner/llm_client.ts` 或 `capabilities/model/llm_client.ts` | 如需要，可设独立 model capability。 |
| `src/memory/semantic.ts` | `src/capabilities/memory/store/semantic.ts` | 迁移。 |
| `memory/` runtime data | 保持不变 | 运行时数据布局暂不强制改变。 |

### 12.11 Tools

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/tools/registry.ts` | `src/capabilities/tooling/tool_registry.ts` 或 Core protocol + capability implementation | Tool execution 是 capability，不是 Core。 |
| `src/tools/providers/*` | 按 capability owner 拆分 | live tools 到 Window/Expression，memory tools 到 Memory capability，search tools 到 Tooling capability。 |
| `src/tool.ts` | compatibility export | 保留直到所有 import 迁移。 |

### 12.12 Debug

| 当前路径 | 目标路径 | 说明 |
|---|---|---|
| `src/core/debug_controller.ts` | `src/debug/server/debug_routes.ts` + `src/debug/window/panel_registry.ts` | 从 debug shell 中移除领域 import。 |
| renderer debug routes | `src/debug/server/` | Debug server 渲染 provider。 |
| control commands | package-owned debug commands | Debug routes 只路由命令。 |
| `src/core/live_control_service.ts` | 拆到 window/capability debug commands | Debug 不拥有 live-specific 行为。 |

---

## 13. Package 注册模型

每个 Capability 和 Window 都应该导出 package object。

示例：

```ts
// src/capabilities/expression/stage_output/package.ts
export const stageOutputCapability: ComponentPackage = {
  id: "capability.expression.stage_output",
  kind: "capability",
  version: "1.0.0",
  displayName: "Stage Output",

  provides: [
    { id: "stage_output", kind: "service" },
    { id: "stage_output.intent_handler", kind: "intent_handler" },
    { id: "stage_output.debug", kind: "debug_provider" },
  ],

  register(ctx) {
    const service = new StageOutputArbiter(...);
    ctx.registry.provide("stage_output", service);
    ctx.registry.provideDebugProvider(stageOutputDebugProvider(service));
  },
};
```

Window 示例：

```ts
// src/windows/live/package.ts
export const liveWindowPackage: ComponentPackage = {
  id: "window.live",
  kind: "window",
  version: "1.0.0",
  displayName: "Live Window",

  requires: [
    { id: "capability.perception.text_ingress" },
    { id: "capability.cognition.runtime_kernel" },
    { id: "capability.expression.stage_output" },
  ],

  provides: [
    { id: "window.live", kind: "service" },
    { id: "window.live.debug", kind: "debug_provider" },
  ],

  register(ctx) {
    // resolve needed capabilities by contract
    // create live window
    // register debug provider
  },
};
```

Core 只加载 package objects 并调用生命周期方法。

---

## 14. Runtime 加载 / 卸载

Core 必须提供通用 ComponentRegistry。

新增：

```txt
src/core/runtime/component_registry.ts
src/core/runtime/component_loader.ts
```

必须支持：

```txt
- register package
- validate package id uniqueness
- validate requirements
- start package
- stop package
- unload package
- expose service registry
- expose read model registry
- expose debug provider registry
- support multiple capabilities and multiple windows
```

伪 API：

```ts
class ComponentRegistry {
  register(pkg: ComponentPackage): void;
  unregister(packageId: string): Promise<void>;

  start(packageId: string): Promise<void>;
  stop(packageId: string): Promise<void>;

  provide<T>(key: string, value: T): void;
  resolve<T>(key: string): T | undefined;

  provideDebugProvider(provider: DebugProvider): void;
  listDebugProviders(): DebugProvider[];
}
```

热插拔规则：

```txt
- runtime active 时可以加载 package。
- 若没有 active required dependency 指向某 package，则可以 stop / unload。
- Window unload 必须先停止平台连接。
- Capability unload 必须安全拒绝、取消、交接或完成 pending work。
- Debug provider 随 owner package unload 自动消失。
```

第一版不要求实现远程动态插件加载。  
初始实现可以加载静态本地 package objects，但必须使用与未来 hot loading 相同的接口。

---

## 15. Debug 架构

Debug 必须成为独立 control plane。

### 15.1 Debug Window

Debug window 应展示：

```txt
- active packages
- active capabilities
- active windows
- event stream
- data plane resources / streams metadata
- runtime health
- per-package panels
- registered commands
- security mode
- backpressure status
```

### 15.2 Panel Registration

每个 package 可以注册 panels：

```ts
ctx.registry.provideDebugProvider({
  id: "stage_output.debug",
  title: "Stage Output",
  ownerPackageId: "capability.expression.stage_output",
  panels: [
    {
      id: "queue",
      title: "Queue",
      kind: "json",
      getData: () => service.snapshot(),
    },
  ],
});
```

Debug 不知道 `service.snapshot()` 如何生成。

### 15.3 Remote Safety

Debug 远程访问必须支持：

```txt
- default local-only mode
- explicit remote enabled mode
- token authentication
- command risk levels
- deny external-effect commands unless explicitly enabled
- audit log for all debug commands
```

Command risk levels：

```txt
read              = snapshot / logs only
safe_write        = harmless local state toggle
runtime_control   = start/stop/reload packages
external_effect   = sends messages, speaks, controls device, calls network write
```

默认策略：

```txt
local-only：
  allow read + safe_write

remote-token：
  allow read, safe_write, selected runtime_control

remote-token + operator mode：
  allow external_effect after explicit config
```

Debug 可以显示 DataPlane metadata，但远程 Debug 不得默认下载 private/runtime scope 的 ResourceRef 内容。

---

## 16. Runtime Kernel Capability

第一个要做硬的能力应该是：

```txt
src/capabilities/cognition/runtime_kernel/
```

它不是 Core。

它拥有：

```txt
- attention decision
- runtime cognition state
- step(event)
- tick()
- planner call boundary
- drive engine
- reasoned decisions
- deterministic scenario replay
- pipeline composition
```

公共 API：

```ts
class RuntimeKernel {
  step(event: PerceptualEvent): Promise<KernelDecision[]>;
  tick(): Promise<KernelDecision[]>;
  onExecutionResult(result: ExecutionResult): Promise<void>;
  snapshot(): RuntimeKernelSnapshot;
}
```

规则：

```txt
- 每个 decision 必须有 reason。
- 不得 import 平台特定代码。
- 不得出现 Bilibili / Discord / Live2D 等平台名。
- 只消费 PerceptualEvent / ResourceRef / StreamRef。
- 使用 Core registry resolve service / read model。
- 大型多模态数据默认由专门 capability 处理，Kernel 只读结构化观察。
```

初始场景覆盖：

```txt
- addressable danmaku -> respond intent
- noise danmaku -> ignored
- connection test message -> respond intent
- batch of messages -> merged response intent
- stage busy -> delayed/queued intent
- idle tick -> proactive topic intent
- LLM failure -> safe fallback
- high priority proposal -> not dropped
```

---

## 17. 迁移阶段

不要一次性大重写。

### Phase 1: 创建 Contract 与空壳

任务：

```txt
1. 创建 `src/core/protocol/*`。
2. 创建 `src/core/runtime/component_registry.ts`。
3. 创建 `src/debug/contracts/*`。
4. 创建 `src/core/protocol/data_ref.ts`。
5. 创建 `src/core/runtime/data_plane.ts` 空实现或最小内存实现。
6. 创建空的 `src/capabilities/` 和 `src/windows/` 目录。
7. 添加兼容导出，确保现有测试仍可通过。
8. 暂不移动旧 live/cursor/stage 代码。
```

验收：

```txt
npm run format:check
npx tsc --noEmit
npm test
```

### Phase 2: 抽出 Stage Output Capability

先移动相对稳定的 stage output 代码。

任务：

```txt
1. 将 `src/actuator/output_arbiter.ts` 移到 `src/capabilities/expression/stage_output/arbiter.ts`。
2. 移动 output budget/policy/queue/types。
3. 导出 `stageOutputCapability` package。
4. 从旧路径保留 compatibility re-exports。
5. 注册 queue/snapshot debug provider。
```

验收：

```txt
- existing stage tests pass
- old imports still pass
- debug provider appears in registry
```

### Phase 3: 抽出 Runtime Kernel Capability

任务：

```txt
1. 创建 `RuntimeKernel`。
2. 创建 `RuntimeKernelState`。
3. 创建 Kernel pipeline 接口。
4. 将 attention heuristics 从 `LiveGateway` 移出。
5. 将 silent-decision repair 从 `LiveRouter` 移出。
6. 添加 `kernel_live_scenarios.test.ts`。
7. 添加 deterministic replay helper。
```

注意：

```txt
- 不要删除 LiveDanmakuCursor。
- LiveDanmakuCursor 可在 feature flag 后调用 RuntimeKernel。
```

Feature flag：

```yaml
runtime:
  kernelEnabled: true
```

验收：

```txt
- scenario tests use kernel.step() and kernel.tick()
- no new test calls LiveDanmakuCursor private methods
```

### Phase 4: 添加 DataPlane / Bypass 最小实现

任务：

```txt
1. 实现内存版 DataPlane。
2. 支持 putBlob / readBlob / release。
3. 支持 createStream 的 latest-only memory ring 初版。
4. EventBus 大 payload 测试应提示或拒绝。
5. Debug 显示 ResourceRef / StreamRef metadata。
6. 增加资源 TTL 清理。
```

验收：

```txt
- image/audio/json blob 不直接进入 EventBus
- ResourceRef 可以被授权读取
- TTL 过期后读取失败
- Debug 只显示 metadata，不默认读取内容
```

### Phase 5: 将 Live Cursor 转成 Live Window

任务：

```txt
1. 创建 `src/windows/live/live_window.ts`。
2. 将 Bilibili/Twitch/YouTube/TikTok adapters 移到 `windows/live/adapters`。
3. LiveWindow 将平台事件转换为 PerceptualEvent。
4. LiveWindow 调用 RuntimeKernel。
5. LiveWindow 将 output intents 路由到 stage output capability。
6. 旧 `LiveDanmakuCursor` 保留为 compatibility wrapper，或在测试迁移后删除。
```

验收：

```txt
- live event flow works through window -> kernel -> capability
- LiveWindow has debug provider
- platform adapters do not import cognition/planner internals
```

### Phase 6: 抽出 Debug System

任务：

```txt
1. 将 debug controller 移到 `src/debug/server`。
2. 建立 DebugProvider registry。
3. Debug page 显示 package panels。
4. 将 live-specific control commands 移出 Debug，改为 package-owned debug providers。
5. 添加 remote debug security policy。
6. 添加 debug command risk enforcement。
```

验收：

```txt
- debug shell has no direct live/discord/stage imports
- panels are provided by packages
- remote token policy is enforced
```

### Phase 7: 抽出 Program Capabilities

任务：

```txt
1. 将 `LiveStageDirector` 移到 `capabilities/program/stage_director`。
2. 将 `TopicScriptRuntimeService` 及相关文件移到 `capabilities/program/topic_script`。
3. Program capabilities 发出 generic intents/proposals。
4. Windows 决定这些 proposal 进入哪里。
```

验收：

```txt
- stage director no longer imports platform adapters
- topic script can run without live platform connection in tests
```

### Phase 8: 抽出 Memory 与 Reflection Capabilities

任务：

```txt
1. 将 MemoryStore 移到 `capabilities/memory/store`。
2. 将 ViewerProfileStore 和 relationship service 移到 `capabilities/memory/viewer_profile`。
3. 将 InnerCursor 内部迁到 `capabilities/cognition/reflection`。
4. Reflection capability 通过 policy overlay / event 影响 RuntimeKernel。
```

验收：

```txt
- reflection can run as background capability
- runtime kernel remains real-time decision center
- no circular dependency between memory and reflection
```

### Phase 9: 抽出 Device / Action Capabilities

任务：

```txt
1. 将 DeviceActionArbiter 移到 `capabilities/action/device_action`。
2. 将 browser/desktop/android drivers 移到各自 capabilities。
3. BrowserWindow 组合 browser control capability。
```

验收：

```txt
- device action tests pass
- high-risk action policy remains intact
- Window does not implement device policy
```

### Phase 10: 引入隔离模式与 Watchdog 初版

任务：

```txt
1. ComponentPackage 增加 isolation 字段。
2. RuntimeHost 对 in_process package 保持现状。
3. 预留 worker_thread / external_process adapter 接口。
4. 添加 package heartbeat / health snapshot。
5. Debug 显示 package health。
```

验收：

```txt
- package health 可见
- package stop / crash reason 可审计
- 不要求第一版完整 worker 化
```

### Phase 11: 删除兼容层

所有测试和 import 迁移完后再删除：

```txt
- old `src/cursor/live/*`
- old `src/live/adapters/*`
- old `src/stage/*`
- old actuator re-exports
- shrink `utils/`
- update docs
```

验收：

```txt
npm run format:check
npx tsc --noEmit
npm test
npm run build
```

---

## 18. 测试计划

### 18.1 必要测试组

新增或更新：

```txt
test/core/
  component_registry.test.ts
  component_loader.test.ts
  protocol_schema.test.ts
  data_plane.test.ts
  resource_access_policy.test.ts

test/debug/
  debug_provider_registry.test.ts
  remote_debug_auth.test.ts
  debug_command_risk.test.ts

test/capabilities/
  runtime_kernel_scenarios.test.ts
  runtime_kernel_pipeline.test.ts
  stage_output_capability.test.ts
  text_ingress_capability.test.ts
  moderation_capability.test.ts
  reflection_capability.test.ts

test/windows/
  live_window_flow.test.ts
  discord_window_flow.test.ts
  stage_window_bridge.test.ts

test/integration/
  live_kernel_stage_flow.test.ts
  hotplug_capability_window.test.ts
  data_plane_scene_observation_flow.test.ts
```

### 18.2 RuntimeKernel 场景测试

必须包含：

```txt
1. Normal viewer question -> respond intent.
2. Low-value spam -> ignored with reason.
3. “能看到吗 / 在吗” -> respond intent, no silent drop.
4. Multiple messages -> merged plan.
5. High-priority gift/superchat proposal -> priority preserved.
6. Stage busy -> queue/delay behavior.
7. Idle tick -> proactive intent.
8. LLM failure -> safe fallback.
```

### 18.3 Hot Plug 测试

必须包含：

```txt
1. load one capability
2. load multiple capabilities
3. load one window requiring capabilities
4. reject window load when required capability missing
5. unload window
6. unload capability after dependent window stopped
7. reject capability unload while active dependent window exists
8. debug provider appears/disappears with package lifecycle
9. snapshotState / hydrateState roundtrip
10. pending work cancel/drain policy
```

### 18.4 DataPlane / Bypass 测试

必须包含：

```txt
1. EventBus rejects or warns on oversized payload.
2. putBlob returns ResourceRef.
3. readBlob requires permission.
4. expired ResourceRef cannot be read.
5. StreamRef latest-only drops old frames.
6. Debug can view resource metadata.
7. Debug remote mode cannot read private resource content by default.
8. SceneObservation flow uses frameRef instead of inline image data.
```

### 18.5 Backpressure 测试

必须包含：

```txt
1. ordinary danmaku queue overflow merges/drops low priority.
2. super chat / paid event is not silently dropped.
3. video frame stream is latest-only.
4. audio chunk stream drops expired chunks.
5. BackpressureStatus reports lag and dropped count.
```

---

## 19. 文档更新

每个 major phase 后更新文档。

目标文档：

```txt
docs/ARCHITECTURE.md
docs/STRUCTURE.md
docs/CODEBASE_GUIDE.md
docs/TESTING.md
docs/OPERATIONS.md
```

新增文档：

```txt
docs/COMPONENT_PACKAGE_CONTRACT.md
docs/CAPABILITY_GUIDE.md
docs/WINDOW_GUIDE.md
docs/DEBUG_PROVIDER_GUIDE.md
docs/DATA_PLANE_AND_BYPASS.md
docs/BACKPRESSURE_POLICY.md
docs/HOTPLUG_AND_HYDRATION.md
docs/MIGRATION_STATUS.md
```

### 19.1 新架构摘要

Docs 应明确：

```txt
- Core 只拥有 contracts 和 runtime substrate。
- Capabilities 拥有能力。
- Windows 将能力组合成具体交互表面。
- Debug 渲染 package-provided debug panels。
- 所有 package 均由 ComponentPackage 生命周期管理。
- EventBus 是 Control Plane。
- DataPlane 是重数据旁路。
- Bypass 不绕过安全、审计、生命周期。
```

---

## 20. 命名规则

一致使用：

```txt
Core
Debug
Capability
Window
ComponentPackage
PerceptualEvent
Intent
ExecutionCommand
ExecutionResult
ResourceRef
StreamRef
DataPlane
RuntimeKernel
DebugProvider
BackpressureStatus
```

避免模糊名：

```txt
Manager
Service
Controller
Handler
Processor
Orchestrator
```

这些名字只有在职责非常清楚时才允许使用。

示例：

```txt
Good:
- ComponentRegistry
- RuntimeKernel
- StageOutputArbiter
- LiveWindow
- DebugProviderRegistry
- ResourceRegistry
- StreamRegistry

Bad:
- LiveManager
- UniversalController
- AIService
- MainProcessor
- MagicHandler
```

---

## 21. 必须移除或避免的反模式

禁止或移除：

```txt
- Core importing concrete capability/window code.
- Debug shell importing live/stage/discord internals.
- Window implementing cognition policy.
- Capability importing platform adapter.
- Event schemas in Core containing every domain event forever.
- Tests using `(object as any).privateMethod()`.
- Silent decisions without reason.
- LLM fallback hidden in router tail.
- Magic-word persona cleanup scattered in prompt code.
- Business logic inside Gateway.
- Heavy image/audio/video payload directly inside EventBus.
- Treating all queues as lossless.
- RuntimeKernel becoming a God Object.
- “temporary” compatibility exports without removal plan.
```

---

## 22. 立即交给 Codex 的任务列表

Codex 应按顺序执行。

### Task 1: Add Contracts

创建：

```txt
- src/core/protocol/component.ts
- src/core/protocol/perceptual_event.ts
- src/core/protocol/intent.ts
- src/core/protocol/execution.ts
- src/core/protocol/data_ref.ts
- src/debug/contracts/debug_provider.ts
```

暂不移动旧代码。

### Task 2: Add Component Registry

创建：

```txt
- src/core/runtime/component_registry.ts
- src/core/runtime/component_loader.ts
```

添加测试：

```txt
test/core/component_registry.test.ts
```

### Task 3: Add DataPlane Skeleton

创建：

```txt
- src/core/runtime/data_plane.ts
- src/core/runtime/resource_registry.ts
- src/core/runtime/stream_registry.ts
- src/core/security/resource_access_policy.ts
```

添加测试：

```txt
test/core/data_plane.test.ts
test/core/resource_access_policy.test.ts
```

### Task 4: Add Runtime Kernel Skeleton

创建：

```txt
- src/capabilities/cognition/runtime_kernel/kernel.ts
- src/capabilities/cognition/runtime_kernel/pipeline.ts
- src/capabilities/cognition/runtime_kernel/state.ts
- src/capabilities/cognition/runtime_kernel/policy.ts
- src/capabilities/cognition/runtime_kernel/package.ts
- src/capabilities/cognition/runtime_kernel/debug_provider.ts
```

添加测试：

```txt
test/capabilities/runtime_kernel_scenarios.test.ts
test/capabilities/runtime_kernel_pipeline.test.ts
```

### Task 5: Wrap Existing StageOutputArbiter as Capability

如果直接移动风险高，第一步先创建 capability package 包装旧路径。

```txt
src/capabilities/expression/stage_output/package.ts
src/capabilities/expression/stage_output/debug_provider.ts
```

之后再移动实际文件。

### Task 6: Add LiveWindow Skeleton

```txt
src/windows/live/live_window.ts
src/windows/live/package.ts
src/windows/live/debug_provider.ts
```

初期 LiveWindow 可以委托现有 live adapters。

### Task 7: Migrate One Flow

先只迁移这个流：

```txt
fixture live danmaku
  -> LiveWindow
  -> RuntimeKernel.step()
  -> Intent
  -> StageOutputCapability
```

不要同时迁移 Discord、browser、topic script、memory。

### Task 8: Add Bypass Flow Test

增加：

```txt
scene frame
  -> DataPlane ResourceRef
  -> EventBus publishes frameRef
  -> SceneObservation Capability reads frameRef
  -> RuntimeKernel receives scene summary
```

---

## 23. 完整重构验收标准

重构完成时必须满足：

```txt
1. Core 没有从 capabilities/windows/debug panels 导入任何代码。
2. Debug shell 不导入 package internals，只渲染 provider panels。
3. 至少两个 Capabilities 可以独立 load/unload。
4. 至少两个 Windows 可以独立 load/unload。
5. Live input path 走 Window -> RuntimeKernel -> StageOutputCapability。
6. RuntimeKernel 有 deterministic scenario tests。
7. EventBus 不承载大型 image/audio/video payload。
8. DataPlane 支持 ResourceRef / StreamRef / TTL / access policy。
9. Backpressure 策略覆盖普通弹幕、付费事件、视频帧、音频 chunk。
10. Live platform adapters 位于 windows/live/adapters。
11. Stage output arbitration 位于 capabilities/expression/stage_output。
12. Inner reflection logic 位于 capabilities/cognition/reflection。
13. Topic script logic 位于 capabilities/program/topic_script。
14. Device action logic 位于 capabilities/action/device_action。
15. 旧 Cursor-based live brain 被删除或缩减为 compatibility wrapper。
16. 新测试不依赖 `(x as any).privateMethod()`。
17. RuntimeKernel 内部是 pipeline，不是巨型黑盒。
18. Hotplug 支持 snapshotState / hydrateState / prepareUnload。
19. Debug 可以显示 package health / debug providers / data resource metadata。
20. `npm run format:check`, `npx tsc --noEmit`, `npm test`, `npm run build` 全部通过。
```

---

## 24. 设计意图

重构完成后的 Stelle 应该是：

```txt
Core 启动通用运行时。
Capabilities 注册能力。
Windows 将能力组合成交互窗口。
Debug 显示各 package 自己选择暴露的调试内容。
RuntimeKernel 作为 capability 做实时决策。
Reflection 作为后台 capability 运行。
StageOutput 作为硬 expression capability 负责表达仲裁。
LiveWindow 和 DiscordWindow 是同一个 AI 主体的不同窗口，而不是两个独立大脑。
DataPlane 处理重数据，EventBus 只处理控制事件。
```

本次重构的目标不是制造更多文件。

目标是建立 **硬边界**。

如果一个新文件没有让边界更清楚，就不要创建它。

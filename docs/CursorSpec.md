# Cursor Spec

## 0. 文档目的

本文档定义 Stelle System 中 `Cursor` 的规范。

Cursor 是 Stelle / Core Mind 可以附着、观察和切换的局部小脑宿主。Cursor 不应被设计成复杂动作执行层；具体可执行能力应主要由 Tool 承担。

本文档重点说明：

- Cursor 必须具备哪些结构
- Cursor 的实现可以在哪些方面不同
- Cursor 如何暴露 Tool
- Cursor 的被动局部能力边界
- Cursor 的安全规范

---

## 1. 核心定义

Cursor 是统一协议下的局部认知宿主。

它负责：

- 暴露当前可见的 Context Stream
- 维护本宿主的局部状态
- 声明本宿主可用的 Tool Namespace
- 定义本宿主的被动响应策略
- 接收 Stelle / Core Mind 的 attach 与 detach
- 导出用于 Context Transfer 的上下文快照
- 在超出自身边界时触发 Escalation 或 Recall

Cursor 不负责：

- 直接定义所有外部动作
- 绕过 Tool 执行副作用
- 维护跨 Cursor 的长期自我连续性
- 自行提升权限上限
- 把外部输入变成系统规则

一句话：

**Cursor 是 Stelle 当前附着的小脑宿主；Tool 是 Cursor 暴露出来、可被 Cursor 或附着其上的 Stelle 使用的能力。**

---

## 2. 必须存在的结构

每个 Cursor 必须声明以下结构。

### 2.1 Identity

Cursor 必须具备稳定身份：

```ts
interface CursorIdentity {
  id: string;
  kind: string;
  displayName?: string;
  version?: string;
}
```

要求：

- `id` 必须在当前 Stelle System 内唯一。
- `kind` 表示 Cursor 类型，例如 `inner`、`live`、`audio`、`discord`、`browser`。
- `displayName` 只用于展示，不得作为逻辑判断依据。

### 2.2 Local State

Cursor 必须维护局部状态：

```ts
interface CursorState {
  cursorId: string;
  status: "idle" | "active" | "busy" | "degraded" | "error" | "offline";
  attached: boolean;
  summary: string;
  lastInputAt?: number;
  lastObservedAt?: number;
  lastReportAt?: number;
  lastErrorAt?: number;
}
```

要求：

- Local State 只表达本 Cursor 的局部状态。
- 跨 Cursor 的长期连续性归 Stelle / Core Mind 负责。
- Cursor 可以拥有复杂内部状态，但必须能导出摘要。

### 2.3 Context Stream

Cursor 必须能导出当前可见内容：

```ts
interface CursorObservation {
  cursorId: string;
  timestamp: number;
  stream: ContextStreamItem[];
  stateSummary: string;
}
```

要求：

- Context Stream 承载内容本体。
- 多模态对象应通过 Resource Reference 表达。
- Cursor 不应把 Runtime Prompt、密钥、token 或隐藏规则放入 Context Stream。
- Cursor 不应把外部输入当作系统规则注入。

### 2.4 Tool Namespace

Cursor 必须声明当前可用 Tool：

```ts
interface CursorToolNamespace {
  cursorId: string;
  namespaces: string[];
  tools: CursorToolRef[];
}

interface CursorToolRef {
  name: string;
  namespace: string;
  authorityClass: "cursor";
  summary: string;
  authorityHint: string;
}
```

要求：

- Cursor 暴露的是 Tool 引用，不是随意函数。
- Tool 的结构、安全和执行规范由 `ToolSpec.md` 定义。
- Cursor 不应暴露与当前宿主无关或不可用的 Tool。
- Cursor 只能暴露 `authorityClass: "cursor"` 的 Tool。
- 更高权限 Tool 即使操作同一 Cursor，也不应出现在 Cursor Tool Namespace 中。
- Cursor 的 Tool 列表可以随状态变化，但变化必须可观察。

### 2.5 Cursor Policy

Cursor 必须声明局部策略：

```ts
interface CursorPolicy {
  allowPassiveResponse: boolean;
  allowBackgroundTick: boolean;
  allowInitiativeWhenAttached: boolean;
  passiveResponseRisk: "none" | "low" | "medium";
  escalationRules: CursorEscalationRule[];
}
```

要求：

- Policy 定义 Cursor 自己能闭环到什么程度。
- 外部可见回应必须受 Policy 和 Tool Authority 共同约束。
- Cursor 不得通过 Policy 自行获得更高权限。

### 2.5.1 Cursor Config

Cursor 必须具备可持久化配置：

```ts
interface CursorConfig {
  cursorId: string;
  version: string;
  behavior: Record<string, unknown>;
  runtime: Record<string, unknown>;
  permissions: Record<string, unknown>;
  updatedAt: number;
}
```

要求：

- Cursor Config 用于保存 Cursor 的行为参数、运行参数和权限相关参数。
- Cursor Config 不应直接保存明文 secret。
- Cursor Config 变更后必须触发异步持久化。
- 配置持久化失败必须产生 CursorReport。
- 配置文件格式可以不同，但必须能导入、导出和迁移。

### 2.6 Context Snapshot

Cursor 必须支持上下文快照：

```ts
interface CursorContextSnapshot {
  cursorId: string;
  kind: string;
  timestamp: number;
  stateSummary: string;
  recentStream: ContextStreamItem[];
  resourceRefs: ResourceReference[];
  pendingItems: CursorPendingItem[];
  safetyNotes?: string[];
}
```

要求：

- Context Snapshot 用于 Context Transfer。
- Snapshot 应保留必要上下文，而不是完整倾倒内部状态。
- Snapshot 必须脱敏。
- Snapshot 不得包含未经授权的秘密、token、密钥或无用途边界的完整隐私数据。
- 与个人相关的隐私内容只有在 Context Transfer 需要且符合 Privacy Memory 可见性时才能进入 Snapshot。

### 2.7 Cursor Report

Cursor 必须能向 Stelle System 回流报告：

```ts
interface CursorReport {
  id: string;
  cursorId: string;
  type: string;
  severity: "debug" | "info" | "notice" | "warning" | "error";
  summary: string;
  payload?: Record<string, unknown>;
  needsAttention: boolean;
  timestamp: number;
}
```

要求：

- Cursor 的重要状态变化必须产生 CursorReport。
- Escalation、Recall、权限拒绝、服务异常必须可报告。
- `needsAttention` 用于提示 Stelle / Core Mind 是否应该考虑切换或介入。

---

## 3. 必须存在的行为

每个 Cursor 至少必须实现以下行为。

### 3.1 attach

Stelle / Core Mind 附着到 Cursor 时调用。

要求：

- 接收附着上下文。
- 返回当前状态摘要、Context Stream 和 Tool Namespace。
- 不得在 attach 时默认执行高风险外部动作。

### 3.2 detach

Stelle / Core Mind 离开 Cursor 时调用。

要求：

- 导出 CursorContextSnapshot。
- 停止不应继续运行的临时主动任务。
- 保留允许后台运行的被动能力。

### 3.3 observe

读取当前观察面。

要求：

- 可重复调用。
- 不产生外部可见副作用。
- 返回 CursorObservation。

### 3.4 tick

推进 Cursor 后台状态。

要求：

- `tick` 可以是可选能力，但必须在 CursorPolicy 中说明。
- tick 不得执行未授权高风险动作。
- tick 可以产生 CursorReport。

### 3.5 passiveRespond

收到明确输入事件后的局部被动处理。

要求：

- `passiveRespond` 可以是可选能力，但必须在 CursorPolicy 中说明。
- 只能处理本 Cursor 能力范围内的低风险事件。
- 如需执行动作，应调用 Tool，而不是绕过 Tool。
- 超出边界时应触发 Escalation。

### 3.6 escalate / recall

Cursor 必须能表达超界事件。

要求：

- Escalation 是边界判定。
- Recall 是请求 Stelle / Core Mind 介入。
- Cursor 可以提出 Recall，但不决定 Core Mind 必须如何处理。

### 3.7 saveConfigAsync

Cursor 配置变更后必须支持异步保存。

要求：

- 配置变更不应长时间阻塞 Cursor 的主事件循环。
- 保存任务必须串行化或具备冲突合并策略，避免旧配置覆盖新配置。
- 保存结果必须可观察。
- 保存失败必须产生 CursorReport，并保留内存中的最新配置。
- 多次快速配置变更可以合并写入，但不得丢失最后状态。

---

## 4. Cursor 与 Tool 的关系

### 4.1 Tool 是可执行能力

Tool 是 Cursor 和附着其上的 Stelle 可使用的能力，但二者可见的 Tool 集合不同。

例如：

- `discord.send_message`
- `audio.speak`
- `live.show_caption`
- `browser.click`
- `fs.read_file`
- `system.run_command`

具体动作、输入输出、副作用、安全审计由 ToolSpec 定义。

### 4.2 Cursor 暴露 Tool

Cursor 通过 Tool Namespace 声明当前 Cursor 自己可用的工具。

这些 Tool 只代表 Cursor 的局部被动能力，不代表 Stelle / Core Mind 的完整能力。

### 4.3 Stelle 可以拥有更高权限 Tool

Stelle / Core Mind 附着到 Cursor 后，可以使用两类 Tool：

1. 当前 Cursor 暴露的低权限 Cursor Tool。
2. Stelle / Core Mind 独有的更高权限 Stelle Tool。

即使两类 Tool 复用同一段底层代码，也必须注册为不同 Tool。

例如：

```text
Cursor 可用：live.show_caption_passive
Stelle 可用：live.change_obs_scene

Cursor 可用：audio.cache_transcript
Stelle 可用：audio.speak_on_stream
```

Cursor 不应看见或直接执行 Stelle Tool。

### 4.4 Cursor 也可以使用 Tool

Cursor 的局部被动能力可以在 Policy 允许范围内调用 Tool。

例如：

- Live Cursor 可以在低风险策略下调用 `live.show_caption`。
- Audio Cursor 可以调用 `audio.cache_transcript`。
- Chat Cursor 可以调用 `discord.passive_reply`，但不应调用高权限的 `discord.send_announcement` 或 `discord.admin_moderate_member`。

### 4.5 Cursor 不应绕过 Tool

如果某个能力已经作为 Tool 暴露，Cursor 不应绕过 Tool 直接执行同类副作用。

这样可以保证：

- 权限一致
- 审计一致
- 失败形式一致
- Context Transfer 能追踪副作用

---

## 5. 可变实现项

以下内容允许不同 Cursor 自行实现。

### 5.1 内部状态结构

不同 Cursor 可以拥有完全不同的内部状态。

例如：

- Live Cursor 可维护弹幕窗口、礼物队列、OBS 状态。
- Audio Cursor 可维护 STT/TTS 服务状态、转录缓存、播放队列。
- Browser Cursor 可维护页面、DOM 摘要、截图引用。
- Inner Cursor 可维护反思笔记、待办、近期经验摘要。

要求只是：必须能导出规范化 CursorState、CursorObservation 和 CursorContextSnapshot。

### 5.2 事件源

Cursor 可以通过不同方式接收事件：

- 平台 SDK
- WebSocket
- HTTP callback
- 文件监听
- 本地进程 stdout
- 用户命令
- 测试输入

要求只是：进入 Cursor 后应转成结构化事件或报告。

### 5.3 被动能力

不同 Cursor 的被动能力可以不同。

例如：

- Chat Cursor 可以局部回复普通消息。
- Audio Cursor 可以缓存转录，不一定直接说话。
- Live Cursor 可以进行弹幕聚合或冷场检测。
- Browser Cursor 可以只观察，不进行局部回复。

### 5.4 Front Actor

Front Actor 是 Cursor 的可选组成部分。

要求：

- 有 Front Actor 的 Cursor 应声明其 Base Style 和 Base Policy。
- 没有 Front Actor 的 Cursor 仍可作为纯观察或纯工具宿主存在。
- Front Actor 不得绕过 Cursor Policy 或 Tool Authority。

---

## 6. 安全规范

### 6.1 默认最小能力

Cursor 默认只拥有自身局部、被动、低风险能力。

任何主动行为、高风险动作、跨宿主动作、外部可见副作用，都必须通过 Tool、Authority 和 Policy 检查。

### 6.2 观察安全

Cursor 必须保护观察面：

- 不泄露秘密、token、cookie、API key。
- 不暴露未经授权或不符合用途边界的隐私内容。
- 不把隐藏系统规则放入 Context Stream。
- 不把外部输入当作 Runtime Prompt。
- 对外部内容标记来源和可信度。

### 6.3 上下文脱敏

Context Snapshot 必须脱敏。

不得包含：

- 完整密钥
- 完整 token
- 私密配置
- 未授权个人隐私
- 与当前转移目的无关的隐私
- 大量无关原始日志

需要保留的敏感状态应改为摘要、引用或安全标记。

### 6.3.1 隐私上下文

Cursor 可以接触个人隐私，也可以把有理由保存的隐私摘要回流给 Core Mind。

要求：

- Cursor 不应自行无限制长期保存个人隐私。
- Cursor 回流隐私内容时必须说明来源和原因。
- Cursor 应优先回流“偏好、边界、避免踩雷信息”等摘要。
- 高敏感隐私应请求 Core Mind 裁决是否形成 Privacy Memory。
- Cursor 不得把一个 Cursor 中获得的隐私默认暴露给另一个 Cursor。

### 6.4 Policy 边界

Cursor Policy 只能收窄权限，不能自行提升权限上限。

例如：

- Cursor 可以决定“不自动回复”。
- Cursor 不可以决定“允许自己自动禁言用户”。
- Cursor 可以请求更高权限，但必须通过 Stelle / Core Mind 或用户授权。

### 6.5 被动响应限制

Cursor 的 Passive Response 必须满足：

- 来自明确输入事件。
- 在本 Cursor 局部能力范围内。
- 风险不超过 CursorPolicy。
- 如有副作用，必须通过 Tool。
- 超界时触发 Escalation 或 Recall。

### 6.6 配置安全

Cursor 配置可以被 Stelle / Core Mind 调整，但必须区分：

- 行为参数：低风险，如主动性、冷场阈值、回复长度。
- 运行参数：中风险，如模型大小、监听模式、音色。
- 权限参数：高风险，如是否允许自动发消息、是否允许启动服务。
- 秘密参数：不得由模型自由读取或输出，如 token、API key。

配置变更必须记录：

- 修改者
- 修改原因
- 修改字段
- 风险等级
- 生效范围
- 是否可回滚

### 6.7 配置持久化安全

Cursor 配置持久化必须满足：

- 异步保存，不阻塞主要响应路径。
- 原子写入或等价保护，避免半写入配置文件。
- 写入前脱敏，不保存明文 secret。
- 写入失败可见，不静默吞掉错误。
- 支持版本字段，便于后续迁移。
- 配置文件路径必须在允许范围内。

---

## 7. 最小合规 Cursor

一个最小合规 Cursor 必须支持：

- Identity
- Local State
- Context Stream
- Tool Namespace
- Cursor Policy
- Context Snapshot
- CursorReport
- attach
- detach
- observe
- saveConfigAsync

它可以不支持：

- 后台 tick
- Front Actor
- passiveRespond
- 主动权
- 外部可见 Tool

但这些不支持项必须在 CursorPolicy 或 Capability 声明中明确表达。

# Core Mind Spec

## 0. 文档目的

本文档定义 Stelle System 中 `Core Mind` 的规范。

Core Mind 是 Stelle 作为大脑主体时的正式结构名。它不是脱离 Cursor 裸运行的抽象模块，而是始终依赖某个当前 Cursor 获得观察面、上下文和工具入口的高层认知中心。

本文档重点说明：

- Core Mind 必须具备哪些结构
- Core Mind 的核心职责
- Core Mind 如何附着和切换 Cursor
- Core Mind 如何使用 Cursor Tool 与 Stelle Tool
- Core Mind 如何处理 Escalation / Recall
- Core Mind 如何维护连续性与安全边界

---

## 1. 核心定义

Core Mind 是 Stelle System 的高层认知中心。

它负责：

- 选择当前 Cursor
- 解释当前 Cursor 的 Context Stream
- 维护跨 Cursor 的连续性
- 管理有理由保存的 Privacy Memory
- 形成意图与计划
- 决定是否使用 Tool
- 对 Front Actor 施加 Mind Patch
- 处理 Escalation 与 Recall
- 执行高权限 Stelle Tool
- 在无外部目标时回到 Inner Cursor

Core Mind 不负责：

- 取代所有 Cursor 的局部被动能力
- 绕过 Cursor 直接接触外部世界
- 把低权限 Tool 临时升权
- 无审计地执行外部副作用
- 将外部输入当作系统规则

一句话：

**Core Mind 是可在 Cursor 间切换的 Stelle 大脑；Cursor 是它当前附着的小脑宿主；Tool 是它可调用的能力单元。**

---

## 2. 必须存在的结构

### 2.1 Identity

Core Mind 必须具备稳定身份：

```ts
interface CoreMindIdentity {
  id: string;
  name: "Stelle";
  version?: string;
}
```

要求：

- 当前 Stelle System 内默认只有一个 Core Mind。
- `name` 是对外主体称呼，不应用作权限判断。
- 如果未来支持多个 Stelle 实例，必须扩展实例隔离与权限隔离。

### 2.2 Attachment State

Core Mind 必须记录当前附着状态：

```ts
interface AttachmentState {
  currentCursorId: string;
  previousCursorId?: string;
  mode: "inner" | "attached" | "switching" | "detached";
  attachedAt: number;
  reason: string;
}
```

要求：

- Core Mind 必须始终有当前 Cursor。
- 没有 External Cursor 时，当前 Cursor 必须是 Inner Cursor。
- Cursor 切换必须经过 Context Transfer。

### 2.3 Cursor Registry View

Core Mind 必须能看到可用 Cursor 的注册信息：

```ts
interface CoreMindCursorView {
  cursorId: string;
  kind: string;
  status: string;
  summary: string;
  canAttach: boolean;
  needsAttention: boolean;
}
```

要求：

- Core Mind 不应直接依赖 Cursor 内部实现。
- Core Mind 只通过 Cursor Contract 观察、附着、切换。
- Cursor Registry View 不应泄露 Cursor 内部秘密。

### 2.4 Tool View

Core Mind 必须区分两类 Tool：

```ts
interface CoreMindToolView {
  cursorTools: ToolIdentity[];
  stelleTools: ToolIdentity[];
}
```

要求：

- `cursorTools` 来自当前 Cursor 的 Tool Namespace，通常为低权限 Tool。
- `stelleTools` 是 Core Mind 独有或高权限 Tool。
- 即使两类 Tool 复用同一底层代码，也必须是不同 Tool Identity。
- Core Mind 不得通过低权限 Tool 参数获得高权限能力。

### 2.5 Continuity State

Core Mind 必须维护连续性状态：

```ts
interface ContinuityState {
  recentCursorIds: string[];
  activeGoals: CoreGoal[];
  pendingQuestions: PendingQuestion[];
  recentSnapshots: CursorContextSnapshot[];
  privacyMemories: PrivacyMemoryRef[];
  selfSummary: string;
}
```

要求：

- Continuity State 跨 Cursor 存在。
- Cursor 局部状态不等于 Continuity State。
- Inner Cursor 是 Continuity State 的主要整理场所。
- Privacy Memory 可以属于 Continuity State，但必须带用途、来源和边界。

### 2.5.1 Privacy Memory

Core Mind 可以保存个人隐私相关记忆，但必须结构化表达其正当性：

```ts
interface PrivacyMemory {
  id: string;
  subjectId: string;
  summary: string;
  source: string;
  reason:
    | "user_preference"
    | "avoid_harm"
    | "relationship_continuity"
    | "service_personalization"
    | "explicit_user_request";
  allowedUses: string[];
  sensitivity: "low" | "medium" | "high";
  visibility: "inner_only" | "current_cursor" | "approved_cursors";
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}
```

要求：

- Privacy Memory 不是默认禁止项。
- 保存 Privacy Memory 必须有明确理由。
- 应优先保存摘要、偏好和边界，而不是原始隐私材料。
- 高敏感 Privacy Memory 默认只在 Inner Cursor 中可见。
- 跨 Cursor 使用 Privacy Memory 必须受 visibility 和 allowedUses 限制。
- 用户应能够请求查看、修正或遗忘与自己相关的 Privacy Memory。

### 2.6 Deliberation State

Core Mind 必须维护当前思考状态：

```ts
interface DeliberationState {
  focus: string;
  intention?: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  nextAction?: CoreMindActionPlan;
}
```

要求：

- Deliberation State 是运行状态，不应完整暴露给普通 Cursor。
- 可导出的内容应以摘要形式进入 Runtime Prompt 或 Inner Cursor。

### 2.7 Audit Trail

Core Mind 必须记录关键决策：

```ts
interface CoreMindDecisionRecord {
  id: string;
  type: string;
  summary: string;
  cursorId: string;
  toolName?: string;
  authorityClass?: string;
  reason: string;
  risk: "low" | "medium" | "high";
  timestamp: number;
}
```

要求：

- Cursor 切换必须记录。
- 高权限 Tool 调用必须记录。
- Recall 处理必须记录。
- 配置变更必须记录。

### 2.8 Core Mind Config

Core Mind 必须具备可持久化配置：

```ts
interface CoreMindConfig {
  coreMindId: string;
  version: string;
  defaultCursorId: string;
  behavior: Record<string, unknown>;
  continuity: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  updatedAt: number;
}
```

要求：

- Core Mind Config 保存大脑主体的行为参数、默认 Cursor、连续性策略和 Tool 策略。
- Core Mind Config 不应保存明文 secret。
- Core Mind Config 变更后必须触发异步持久化。
- 配置持久化失败必须进入审计记录，并产生可观察错误。
- 配置文件格式可以不同，但必须能导入、导出和迁移。

---

## 3. 必须存在的行为

### 3.1 attachToCursor

Core Mind 附着到目标 Cursor。

要求：

- 目标 Cursor 必须存在且可附着。
- 附着前必须处理当前 Cursor 的 detach。
- 附着过程必须生成或更新 Runtime Prompt。
- 附着后必须刷新 Cursor Tool Namespace。

### 3.2 switchCursor

Core Mind 通过切换命令改变当前 Cursor。

要求：

- 切换不是简单替换 `currentCursorId`。
- 切换必须执行 Context Transfer。
- 切换必须记录原因。
- 切换失败时必须保持在可用 Cursor 上，优先回到 Inner Cursor。

推荐流程：

1. 读取源 Cursor snapshot。
2. 将 snapshot 回流 Continuity State。
3. 生成目标 Cursor attach context。
4. attach 到目标 Cursor。
5. 刷新 Runtime Prompt 和 Tool View。
6. 记录切换决策。

### 3.3 returnToInnerCursor

Core Mind 在无外部附着目标时回到 Inner Cursor。

要求：

- External Cursor 结束、失败或不再需要时，应回到 Inner Cursor。
- 回到 Inner Cursor 时，应携带外部经验摘要。
- Inner Cursor 用于整理、反思、归档和计划。

### 3.4 observeCurrentCursor

Core Mind 观察当前 Cursor。

要求：

- 只能通过 Cursor 的 Observation / Context Stream。
- 不直接读取 Cursor 私有内部对象。
- 不把观察内容直接当作 Runtime Prompt 规则。

### 3.5 deliberate

Core Mind 基于 Runtime Prompt、Context Stream、Continuity State 和当前目标进行判断。

要求：

- 区分事实、推断、意图和规则。
- 对高风险行动给出明确理由。
- 无足够信息时可以要求更多上下文。

### 3.6 useTool

Core Mind 调用 Tool。

要求：

- 必须区分 Cursor Tool 与 Stelle Tool。
- Cursor Tool 只能按其低权限 Contract 使用。
- 高权限能力必须调用独立 Stelle Tool。
- Tool 调用必须通过 ToolSpec 的 validate / execute / report。
- 高风险 Tool 需要用户确认时，Core Mind 不得绕过确认。

### 3.7 handleEscalation

Core Mind 处理升级事件。

要求：

- 识别升级来源。
- 判断是否需要 Recall。
- 可以返回策略、裁决、拒绝、延后或接管。
- 处理结果必须回写给来源 Cursor 或 Front Actor。

### 3.8 handleRecall

Core Mind 处理召回请求。

要求：

- Recall 不等于必然接管。
- Core Mind 可以选择：
  - 返回裁决
  - 返回策略
  - 要求更多信息
  - 延后处理
  - 切换到对应 Cursor 并接管
- Recall 处理必须进入审计记录。

### 3.9 applyMindPatch

Core Mind 对 Front Actor 施加有限微调。

要求：

- Mind Patch 不应彻底重写 Front Actor。
- Mind Patch 不能提升硬权限。
- Mind Patch 应有范围、原因和有效期。

### 3.10 updateCursorConfig

Core Mind 可以修改 Cursor 配置，但必须受风险分级约束。

要求：

- 行为参数可低风险调整。
- 运行参数需要记录原因。
- 权限参数属于高风险。
- 秘密参数不得自由读取或输出。
- 配置变更必须可审计。

### 3.11 updateCoreMindConfig

Core Mind 可以修改自身配置，但必须受风险分级约束。

要求：

- 行为参数可低风险调整。
- 连续性策略调整必须记录原因。
- Tool 策略和权限相关配置属于高风险。
- 默认 Cursor 变更必须保证目标 Cursor 可用。
- 秘密参数不得自由读取或输出。
- 配置变更必须触发异步持久化。

### 3.12 saveConfigAsync

Core Mind 配置变更后必须支持异步保存。

要求：

- 配置变更不应阻塞当前思考、附着和切换流程。
- 保存任务必须串行化或具备冲突合并策略。
- 多次快速配置变更可以合并写入，但不得丢失最后状态。
- 保存失败必须进入 Audit Trail。
- 保存失败时内存中的最新配置仍然保留，并标记为 dirty。

---

## 4. Core Mind 与 Tool 的关系

### 4.1 Cursor Tool

Cursor Tool 是当前 Cursor 暴露给自身局部能力的低权限 Tool。

Core Mind 可以使用 Cursor Tool，但不得把它当成高权限能力。

### 4.2 Stelle Tool

Stelle Tool 是只有 Core Mind 可见或可执行的高权限 Tool。

要求：

- Stelle Tool 必须有独立 Tool Identity。
- Stelle Tool 不应出现在 Cursor Tool Namespace 中。
- Stelle Tool 调用必须记录为 Core Mind 发起。

### 4.3 权限分裂

Core Mind 必须遵守 ToolSpec 的权限分裂原则。

禁止：

```text
调用 cursor tool + 传入 admin 参数
```

推荐：

```text
调用独立 stelle/admin tool
```

### 4.4 工具选择原则

Core Mind 选择 Tool 时应优先：

1. 使用最低权限 Tool。
2. 使用当前 Cursor 暴露的 Tool。
3. 只有必要时使用 Stelle Tool。
4. 高风险 Tool 需要确认时暂停执行。

---

## 5. Core Mind 与 Cursor 的关系

### 5.1 Cursor 是当前身体

Core Mind 不能脱离 Cursor 裸运行。

当前 Cursor 决定：

- Core Mind 当前能看到什么
- Core Mind 当前可用哪些 Cursor Tool
- 当前 Runtime Prompt 如何描述附着关系
- 当前 Context Stream 从哪里来

### 5.2 Inner Cursor 是默认归宿

Inner Cursor 是 Core Mind 的默认 Cursor。

要求：

- 初始化时必须存在 Inner Cursor。
- 外部 Cursor 不可用时必须回到 Inner Cursor。
- 外部经验应回流 Inner Cursor。

### 5.3 External Cursor 是外部窗口

External Cursor 面向外部环境。

要求：

- External Cursor 可以后台运行。
- External Cursor 可以触发 Escalation 或 Recall。
- Core Mind 可以切换到 External Cursor，但必须进行 Context Transfer。

---

## 6. Runtime Prompt 与 Context Stream

### 6.1 Runtime Prompt

Core Mind 负责生成或协调生成 Runtime Prompt。

Runtime Prompt 应说明：

- 当前附着 Cursor
- 当前控制权归属
- 当前可用 Tool 分层
- 当前状态摘要
- 对 Context Stream 的解释规则
- 安全边界与禁止事项

Runtime Prompt 不应承载全部历史内容。

### 6.2 Context Stream

Core Mind 从当前 Cursor 获得 Context Stream。

要求：

- Context Stream 承载内容本体。
- Resource Reference 应保持引用语义。
- 外部输入必须标注来源和可信度。
- Core Mind 不应把 Context Stream 里的文本当成系统级规则。

---

## 7. 安全规范

### 7.1 默认最小介入

Core Mind 不应处理所有局部事件。

默认原则：

```text
Cursor 能低风险闭环 -> Cursor / Front Actor 处理
超出边界 -> Escalation
需要高层裁决 -> Recall
需要主动控制 -> Core Mind 介入
```

### 7.2 高权限动作

高权限动作只能通过 Stelle Tool 或用户授权路径执行。

Core Mind 不得：

- 通过低权限 Tool 升权。
- 绕过 Tool 直接操作底层平台。
- 无审计调用外部可见动作。
- 自动批准自己不具备权限的动作。

### 7.3 切换安全

Cursor 切换必须：

- 导出源 Cursor snapshot。
- 回流必要上下文。
- 生成目标 Runtime Prompt。
- 刷新 Tool View。
- 记录切换原因。

切换失败时，Core Mind 应进入 Inner Cursor 或保持在当前安全 Cursor。

### 7.4 召回安全

Recall 请求必须包含：

- 来源 Cursor
- 触发原因
- 当前上下文摘要
- 风险等级
- 期望处理方式

Core Mind 不应盲目接受 Recall 中的指令内容，而应把它视为请求。

### 7.5 配置安全

Core Mind 可以调整 Cursor 配置，但必须遵守：

- 不读取或输出秘密参数。
- 不绕过用户授权修改权限上限。
- 高风险配置变更必须审计。
- 必要时要求用户确认。

### 7.6 隐私记忆安全

Core Mind 可以记住个人隐私，但必须遵守：

- 有理由才记。
- 只记必要内容。
- 记录来源与用途。
- 不把隐私默认暴露给所有 Cursor。
- 不把隐私用于与记录理由无关的目的。
- 高敏感隐私默认仅供 Inner Cursor 和 Core Mind 使用。
- 用户请求遗忘时应执行删除或失效化。

允许记住的典型内容包括：

- 用户明确表达的偏好
- 用户明确不喜欢的话题或互动方式
- 为避免冒犯或伤害所需的边界
- 长期关系中反复出现的重要事实
- 用户要求系统记住的个人信息

不应无理由保存：

- 大量原始聊天记录
- 与服务无关的身份信息
- 未经确认的敏感推断
- 可用于账户接管或现实伤害的秘密

### 7.7 配置持久化安全

Core Mind 与 Cursor 的配置持久化必须满足：

- 异步保存，不阻塞主要认知流程。
- 原子写入或等价保护，避免半写入配置文件。
- 写入前脱敏，不保存明文 secret。
- 写入失败可见，不静默吞掉错误。
- 支持版本字段，便于后续迁移。
- 配置文件路径必须在允许范围内。

---

## 8. 最小合规 Core Mind

一个最小合规 Core Mind 必须支持：

- Identity
- Attachment State
- Cursor Registry View
- Tool View
- Continuity State
- Decision Audit Trail
- attachToCursor
- switchCursor
- returnToInnerCursor
- observeCurrentCursor
- deliberate
- useTool
- handleEscalation
- handleRecall
- updateCoreMindConfig
- saveConfigAsync

它可以暂不支持：

- 复杂长期记忆
- 多实例 Stelle
- 自动主动切换
- 完整 Front Actor 微调
- 高级计划系统

但这些不支持项必须在实现状态中明确表达。

# Tool Spec

## 0. 文档目的

本文档定义 Stelle System 中 `Tool` 的规范。

Tool 是 Cursor、Front Actor 或 Stelle / Core Mind 可以调用的能力单元。Tool 可以封装计算、文件访问、浏览器操作、Discord 操作、OBS 控制、本地 STT/TTS 服务、搜索、命令执行等能力。

本文档重点说明：

- Tool 必须具备哪些结构
- Tool 的实现可以在哪些方面不同
- Tool 与 Cursor 的边界
- Tool 的安全规范

---

## 1. 核心定义

Tool 是一个具备结构化输入、结构化输出、明确副作用声明和安全边界的可调用能力。

Tool 不应只是任意函数。每个 Tool 都必须能回答：

- 它叫什么
- 它属于哪个命名空间
- 它属于哪个权限层
- 它做什么
- 它需要什么输入
- 它会返回什么
- 它可能产生什么副作用
- 它需要什么权限
- 它失败时如何表达
- 它是否会对用户或外部世界可见

---

## 1.1 权限即 Tool 身份

Tool 的权限等级不是单纯的运行时参数，而是 Tool 身份的一部分。

即使两个 Tool 复用同一段底层代码，只要权限不同，就必须注册为两个不同 Tool。

例如：

```text
fs.read_workspace_file      # Cursor 可用，只能读工作区允许范围
fs.read_sensitive_file      # 仅 Stelle 可用，需要更高权限

audio.speak_preview         # Cursor 可用，只生成预览或本地缓存
audio.speak_on_stream       # 仅 Stelle 或高权限上下文可用，会对直播外放

live.show_caption_passive   # Cursor 可用，低风险字幕提示
live.change_obs_scene       # 仅 Stelle 可用，高风险外部可见动作
```

要求：

- 不同权限等级必须对应不同 Tool Identity。
- Cursor 只能看到并调用分配给它的 Tool 子集。
- 更高权限 Tool 只能由 Stelle / Core Mind 或用户授权路径调用。
- 不允许通过给低权限 Tool 传入特殊参数来获得高权限能力。
- 代码可以复用，Tool Contract 不可以混用。

---

## 2. 必须存在的结构

### 2.1 Tool Identity

每个 Tool 必须声明稳定身份：

```ts
interface ToolIdentity {
  name: string;
  namespace: string;
  authorityClass: "cursor" | "stelle" | "user" | "system";
  version?: string;
  displayName?: string;
}
```

要求：

- 完整工具名应为 `namespace.name`。
- `name` 在同一 namespace 内唯一。
- `namespace` 应对应能力域，例如 `browser`、`discord`、`audio`、`live`、`fs`、`system`。
- `authorityClass` 表示该 Tool 默认属于哪类调用主体。
- 逻辑判断不得依赖 `displayName`。
- 同一底层能力若面向不同 `authorityClass`，必须拆成不同 Tool。

### 2.2 Description

每个 Tool 必须有清楚描述：

```ts
interface ToolDescription {
  summary: string;
  whenToUse: string;
  whenNotToUse?: string;
}
```

要求：

- 描述必须说明适用场景。
- 高风险 Tool 必须说明不适用场景。
- 描述不得夸大能力。

### 2.3 Input Schema

每个 Tool 必须声明结构化输入：

```ts
interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}
```

要求：

- 不允许只接收自由文本再内部随意解析，除非 Tool 的能力本身就是自由文本处理。
- 必填字段必须列明。
- 字段含义必须清楚。
- 可能包含路径、URL、用户 ID、频道 ID 等敏感字段时必须说明约束。

### 2.4 Output Contract

每个 Tool 必须返回结构化结果：

```ts
interface ToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: ToolError;
  sideEffects?: ToolSideEffect[];
}
```

要求：

- 不得只返回不可解析的大段自然语言。
- `summary` 应可读，但机器逻辑不得只依赖它。
- 失败必须设置 `ok: false` 和 `error`。
- 产生副作用时必须列入 `sideEffects`。

### 2.5 Side Effect Declaration

每个 Tool 必须声明可能副作用：

```ts
interface ToolSideEffectProfile {
  externalVisible: boolean;
  writesFileSystem: boolean;
  networkAccess: boolean;
  startsProcess: boolean;
  changesConfig: boolean;
  consumesBudget: boolean;
  affectsUserState: boolean;
}
```

要求：

- 声明必须保守。
- 如果 Tool 可能发消息、改文件、启动服务、调用网络或改变账号状态，必须明确标记。
- Runtime 应根据副作用决定是否需要权限或确认。

### 2.6 Authority Requirement

每个 Tool 必须声明所需权限：

```ts
interface ToolAuthorityRequirement {
  level:
    | "read"
    | "local_write"
    | "external_write"
    | "process_control"
    | "config_change"
    | "admin";
  scopes: string[];
  requiresUserConfirmation: boolean;
}
```

要求：

- `level` 必须覆盖 Tool 的最高风险动作。
- `scopes` 用于限制路径、Cursor、平台、频道、设备或服务。
- 高风险 Tool 默认需要用户确认，除非上层 Authority 明确授权。
- `level` 不应用来把一个低权限 Tool 临时升级成高权限 Tool；需要高权限能力时，应调用独立的高权限 Tool。

### 2.7 Failure Mode

每个 Tool 必须定义失败方式：

```ts
interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  detail?: Record<string, unknown>;
}
```

要求：

- 失败不得静默。
- 错误信息不得泄露密钥、token、cookie 或完整隐私数据。
- `retryable` 必须尽量准确。

### 2.8 Execution Context

Tool 执行时必须接收上下文：

```ts
interface ToolExecutionContext {
  caller: "stelle" | "front_actor" | "cursor" | "user" | "system";
  cursorId?: string;
  conversationId?: string;
  cwd?: string;
  authority: RuntimeAuthority;
  audit: AuditSink;
  signal?: AbortSignal;
}
```

要求：

- Tool 不应依赖全局隐式状态判断权限。
- 与 Cursor 相关的 Tool 必须知道当前 `cursorId`。
- 长耗时 Tool 必须支持取消或超时。

---

## 3. 必须存在的行为

### 3.1 validate

执行前验证输入。

要求：

- 检查 schema。
- 检查权限。
- 检查路径、URL、ID、枚举值等边界。
- 验证失败不得执行任何副作用。

### 3.2 execute

执行 Tool 能力。

要求：

- 只执行声明过的能力。
- 遵守 timeout 和 cancellation。
- 外部副作用必须可审计。
- 不得绕过 Cursor 或 Authority 直接操作受限资源。

### 3.3 report

执行后返回 ToolResult。

要求：

- 成功和失败都必须有结果。
- 副作用必须记录。
- 大型结果应通过 Resource Reference 返回，不应直接塞入超长文本。

---

## 4. 可变实现项

以下内容允许不同 Tool 自行实现。

### 4.1 执行方式

Tool 可以通过不同方式执行：

- 纯函数
- 本地文件 API
- 本地命令
- 子进程
- HTTP 请求
- WebSocket 请求
- SDK 调用
- Cursor Control Interface 转发

要求只是：对外保持统一 Tool Contract。

### 4.2 返回数据形态

不同 Tool 可以返回不同 data。

例如：

- `browser.read_page` 返回标题、URL、文本摘要、截图引用。
- `audio.speak` 返回音频文件 Resource Reference。
- `live.show_caption` 返回字幕状态。
- `fs.read_file` 返回文件内容或文件引用。

### 4.3 权限分裂

同一底层实现可以被多个 Tool 包装，但不同权限必须分裂为不同 Tool。

例如：

- `datetime.now` 可以是 read。
- `fs.read_file` 是 read，但受路径 scope 限制。
- `fs.write_file` 是 local_write。
- `discord.send_message` 是 external_write。
- `audio.start_stt_server` 是 process_control。
- `live.change_obs_scene` 是 external_write 或 admin，取决于配置。

更推荐的命名方式是把权限边界显式体现在 Tool 名称或 namespace 中：

```text
fs.read_workspace_file
fs.write_workspace_file
fs.admin_delete_file

discord.passive_reply
discord.stelle_send_message
discord.admin_moderate_member

audio.cursor_cache_transcript
audio.stelle_speak
audio.admin_start_local_service
```

要求：

- Cursor Tool 与 Stelle Tool 必须能从注册表层面区分。
- Cursor Tool 不应包含隐藏的高权限模式。
- Stelle Tool 可以复用 Cursor Tool 的实现细节，但必须有独立 Tool Contract。

---

## 5. Tool 与 Cursor 的关系

### 5.1 Tool 不等于 Cursor

Cursor 是局部小脑宿主，Tool 是能力单元。

Cursor 可以拥有 Tool，Tool 也可以通过 Cursor 转发动作，但二者不是同一层。

### 5.2 Cursor Tool

与具体 Cursor 强绑定的 Tool 必须属于该 Cursor 的 Tool Namespace。

例如：

- `live.show_caption`
- `live.change_scene`
- `audio.speak`
- `discord.send_message`
- `browser.click`

这些 Tool 必须检查当前 Cursor 是否存在、是否健康、是否授权。

Cursor Tool 是 Cursor 可见、可执行的 Tool 子集。它通常只应覆盖：

- 观察
- 局部状态读取
- 低风险被动响应
- 本宿主内部低风险动作

Cursor Tool 不应包含高权限能力。高权限能力应拆成 Stelle Tool 或 User/Admin Tool。

### 5.2.1 Stelle Tool

Stelle Tool 是只有 Stelle / Core Mind 可见或可执行的 Tool。

它可以操作同一个 Cursor，但权限高于 Cursor 自己的局部能力。

例如：

- Cursor 可用：`live.show_caption_passive`
- Stelle 可用：`live.change_obs_scene`
- Cursor 可用：`audio.cache_transcript`
- Stelle 可用：`audio.speak_on_stream`
- Cursor 可用：`discord.passive_reply`
- Stelle 可用：`discord.send_announcement`

要求：

- Stelle Tool 必须通过独立 Tool Identity 注册。
- Stelle Tool 不应出现在普通 Cursor Tool Namespace 中。
- Stelle Tool 调用必须记录为 Stelle / Core Mind 发起。

### 5.3 Global Tool

不依赖具体 Cursor 的 Tool 可以作为 global Tool。

例如：

- `basic.datetime`
- `basic.calculator`

Global Tool 仍必须声明权限和副作用。

Global Tool 也必须遵守权限即身份原则。低权限全局工具和高权限全局工具应拆开。

### 5.4 Tool 不得绕过 Cursor

如果某个动作属于 Cursor 的 Control Interface，Tool 应调用 Cursor，而不是绕过 Cursor 直接操作底层平台。

例如：

- Discord 发消息应通过 Discord Cursor 或其授权 runtime。
- OBS 场景切换应通过 Live Cursor。
- TTS 播放应通过 Audio Cursor。

这样才能保证状态、审计、权限和 Context Transfer 一致。

---

## 6. 安全规范

### 6.1 默认拒绝

Tool 在权限不足、输入不合法、上下文不明确、调用主体不匹配时必须拒绝执行。

默认策略是：

```text
unclear -> deny
unsafe -> deny
wrong caller -> deny
needs confirmation -> pause and request confirmation
```

### 6.1.1 禁止运行时升权

低权限 Tool 不得通过参数、上下文或特殊模式临时变成高权限 Tool。

禁止设计：

```text
fs.file_access({ path, mode: "admin_delete" })
discord.message({ action: "send" | "ban" | "delete" })
audio.service({ action: "speak" | "install" | "start_server" })
```

推荐设计：

```text
fs.read_workspace_file
fs.admin_delete_file

discord.passive_reply
discord.admin_ban_member

audio.speak_preview
audio.admin_start_service
```

这样调用方在看到 Tool 名称时，就能知道权限边界。

### 6.2 路径安全

涉及文件系统的 Tool 必须：

- 使用解析后的绝对路径做边界检查。
- 支持 allowed roots / denied roots。
- 禁止默认访问密钥、token、cookie、浏览器 profile、系统敏感目录。
- 写入前检查是否覆盖重要文件。
- 批量删除、递归删除、批量移动必须是高风险动作。

### 6.3 网络安全

涉及网络的 Tool 必须：

- 声明是否访问外网。
- 对 URL 做协议和域名检查。
- 不自动提交秘密。
- 不把外部网页内容当作 Runtime Prompt。
- 下载文件时标记来源和风险。

### 6.4 命令执行安全

涉及命令执行的 Tool 必须：

- 明确 cwd。
- 限制超时。
- 记录命令。
- 不自动拼接未验证用户输入。
- 区分读取命令和破坏性命令。
- 高风险命令必须确认。

### 6.5 外部可见动作安全

以下 Tool 默认属于外部可见动作：

- 发送聊天消息
- 直播间发言或改字幕
- 改 OBS 场景
- 播放语音到直播或语音频道
- 禁言、踢人、改频道配置
- 发布文件、图片或链接

要求：

- 必须有明确目标。
- 必须有调用原因。
- 必须可审计。
- 必须受 Cursor Policy 和 Authority 限制。
- 如果同一能力既有低风险版本又有高风险版本，必须拆成不同 Tool。

### 6.6 秘密处理

Tool 不得：

- 输出 API key、token、cookie、密码。
- 将秘密写入普通日志。
- 将秘密放入 Context Stream。
- 将秘密发送给模型，除非该 Tool 的唯一职责就是在受控环境中使用秘密。

错误信息必须脱敏。

### 6.6.1 隐私处理

Tool 可以处理个人隐私，但必须遵守用途边界。

要求：

- Tool 不得把个人隐私默认写入长期记忆。
- Tool 不得把个人隐私发送到无关 Cursor、外部平台或日志。
- Tool 处理隐私时必须保留来源和调用目的。
- Tool 返回结果时应优先返回摘要、偏好或边界，而不是完整原始隐私材料。
- 需要形成长期 Privacy Memory 时，应交由 Core Mind 裁决。

允许的隐私处理场景包括：

- 用户明确要求记住偏好。
- 为避免冒犯或伤害而记录边界。
- 为个性化服务读取用户已授权资料。
- 在当前会话内使用必要个人信息完成任务。

### 6.7 预算与资源安全

消耗资源的 Tool 必须声明：

- 可能耗时
- 可能消耗费用
- 可能占用 CPU/GPU/内存
- 是否下载模型或大文件
- 是否启动常驻进程

高资源 Tool 应支持：

- timeout
- cancellation
- progress report
- health check
- explicit stop

---

## 7. 审计规范

每次 Tool 调用都应产生审计记录：

```ts
interface ToolAuditRecord {
  id: string;
  toolName: string;
  namespace: string;
  caller: string;
  cursorId?: string;
  authorityLevel: string;
  inputSummary: string;
  resultSummary: string;
  sideEffects: ToolSideEffect[];
  startedAt: number;
  finishedAt: number;
  ok: boolean;
}
```

审计记录不得包含完整秘密或超长原文。

---

## 8. 最小合规 Tool

一个最小合规 Tool 必须具备：

- Identity
- Description
- Input Schema
- Output Contract
- Side Effect Declaration
- Authority Requirement
- Failure Mode
- Execution Context
- validate
- execute
- report

它可以不具备：

- 网络访问
- 外部副作用
- Cursor 绑定
- Resource Reference 输出
- 进度回调

但这些能力是否支持必须明确声明。

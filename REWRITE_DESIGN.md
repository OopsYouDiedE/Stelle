# Stelle src 重写设计方案

## 0. 当前约束与目标

本次重写的核心目标不是在旧代码上继续堆模块，而是把 `src` 收拢成稳定、少层级、可长期演化的结构：

```text
src/
  cursor/
    inner_cursor.ts
    discord_cursor.ts
    live_cursor.ts
    ...
  tool.ts
  utils/
    config_loader.ts
    llm.ts
    text.ts
    memory.ts
    runtime.ts
    renderer.ts
    tts.ts
    ...
  index.ts
  start.ts

config.yaml

reference/
  src/
    ...旧实现完整留档

scripts/
  ...未来所有 Python 脚本

assets/
  ...和核心人格无关的资源，例如 Live2D、renderer 静态资源、背景、音频模板
```

旧 `src` 已经迁移到 `reference/src`，它只作为参考实现和回滚依据，不再作为新架构依赖。新 `src` 应当重新设计，避免把旧的 `CoreMind + CursorRuntime + 多文件 tools` 架构原样搬回来。

## 1. 设计原则

### 1.1 Cursor 是人格与回复的基本单元

每个 `src/cursor/xx_cursor.ts` 是一个“长代码文件”，完整包含一个子人格的：

- 人格定义：身份、语气、边界、关注点、禁区。
- 上下文组装：它如何读取消息、记忆、工具结果、运行态。
- 决策逻辑：是否回复、何时回复、走哪个工具、是否升级。
- 回复生成：最终发出的文本、caption、直播脚本等。
- 本 cursor 自己需要的轻量状态：会话、冷却、等待、队列等。

这意味着 cursor 文件不是薄薄的类封装，而是一个可以独立理解的“人格运行单元”。

### 1.2 Cursor 决策必须由 LLM 完成，禁止启发式正则主导

旧代码中 `DiscordRouteDecider`、`DiscordJudge`、`LiveRouteDecider` 都混有不少正则启发式。新架构中：

- 路由判断用 LLM 返回结构化 JSON。
- 插话判断用 LLM 返回结构化 JSON。
- 回复模式选择用 LLM 返回结构化 JSON。
- 工具调用选择用 LLM 返回结构化 JSON。

允许存在少量非语义性的硬规则，例如：

- 空文本直接 drop。
- Discord bot 自己发的消息不处理。
- 管理员权限校验不能交给 LLM。
- JSON 解析失败时走保守 fallback。
- 文本长度、输出长度、路径安全、工具权限检查必须由程序硬约束。

但凡涉及“这句话是什么意思、是否该回复、是否是直播请求、是不是社交动作”等语义判断，都应由 LLM 完成。

### 1.3 Tool 是根级单文件能力层

`src/tool.ts` 是唯一工具文件，包含：

- 工具类型定义。
- 工具注册表。
- 权限模型。
- 输入 schema 检查。
- 工具审计。
- 所有工具实现。

工具不理解人格，不决定是否调用自己。工具只做能力暴露和安全执行。

### 1.4 Config 是 YAML 配置，不是 TS 配置模块

配置本体固定为仓库根目录的 `config.yaml`。它负责描述 cursor、Discord channel/guild、Live、Core 等运行参数。

TypeScript 代码中只保留读取、校验、归一化配置的工具函数，建议放在 `src/utils/config_loader.ts`，不能把可调整配置写死在 TS 模块里。

`config.yaml` 负责：

- cursor 配置。
- Discord guild/channel 权限配置。
- Live 配置。
- StelleCore 调度配置。
- 运行时可变配置的初始值。

`src/utils/config_loader.ts` 负责：

- 加载环境变量。
- 读取 `config.yaml`。
- 校验和补默认值。
- 合并 env override。
- 提供 `RuntimeConfig` 给 runtime/cursor/tool 使用。

业务判断不进入 config。

### 1.5 Utils 只放共享底座

`src/utils` 放多个 cursor/tool/config loader 都要用的能力：

- LLM provider。
- 文本清洗与 chunk。
- Markdown memory store。
- Discord runtime wrapper。
- Live renderer/runtime wrapper。
- TTS provider。
- Prompt/render helpers。
- JSON 解析和安全工具。

Utils 不持有人格，不做场景决策。

## 2. 顶层运行流程

### 2.1 启动入口

`src/start.ts` 提供三种模式：

```text
runtime      同时启动 Discord + Live renderer + debug console
discord      只启动 Discord cursor host
live         只启动 Live renderer
```

启动时构造：

```text
config -> llm -> toolRegistry -> cursorHost -> specific cursors
```

新架构里不再需要旧 `CoreMind` 作为一个大而全的中央类。更推荐使用一个轻量的 `StelleRuntime`：

- 负责装配 cursor。
- 负责把事件分发给 cursor。
- 负责给 cursor 注入 tool/llm/config/memory。
- 负责 debug snapshot。

人格和回复决策仍在 cursor 内部。

### 2.2 Discord 消息流

```text
Discord MessageCreate
  -> DiscordRuntime 格式化为 DiscordMessage
  -> DiscordCursor.receiveMessage(message)
  -> DiscordCursor 调用 LLM 做 attention/route decision
  -> 如果 drop：记录 memory，然后结束
  -> 如果 wait：设置等待条件
  -> 如果 reply：调用 LLM 生成回复计划
  -> 如需工具：执行 tool loop
  -> 生成最终文本
  -> 用 Discord tool 发送
  -> 写入 memory / 更新 session
```

这里的重点是：DiscordCursor 自己完成“是否回复”和“怎么回复”，不是把语义判断拆到外部规则类。

### 2.3 Live 请求流

```text
Discord 命令 / Debug API / System Event
  -> LiveCursor.receiveRequest(request)
  -> LiveCursor 调用 LLM 判断 live intent
  -> LLM 输出脚本策略、展示策略、工具调用计划
  -> 调用 live tools 更新 caption/model/motion/background/audio
  -> 写入 memory
```

LiveCursor 是“直播人格”，它决定如何说、何时说、表现成什么舞台动作。

### 2.4 Inner Cursor 流程

InnerCursor 是默认内在态：

- 维护反思、长程目标、最近事件摘要。
- 提供 debug/观察时的系统状态描述。
- 可以被 runtime 询问“当前整体状态”。
- 不直接对外发消息，除非被明确路由为内部总结。

它不是中央大脑，而是一个可观测、可记忆、可整理状态的内在人格。

## 3. `src/cursor` 设计

### 3.1 目录结构

```text
src/cursor/
  types.ts
  inner_cursor.ts
  discord_cursor.ts
  live_cursor.ts
```

其中 `types.ts` 只放 cursor 间共享的轻量类型。如果类型很少，也可以合并到 `src/utils/runtime.ts`，避免过度拆分。

### 3.2 Cursor 通用接口

建议接口：

```ts
export interface CursorContext {
  llm: LlmClient;
  tools: ToolRegistry;
  config: RuntimeConfig;
  memory: MemoryStore;
  now: () => number;
}

export interface CursorSnapshot {
  id: string;
  kind: string;
  status: "idle" | "active" | "waiting" | "cooldown" | "error";
  summary: string;
  state: Record<string, unknown>;
}

export interface StelleCursor {
  id: string;
  kind: string;
  displayName: string;
  snapshot(): CursorSnapshot;
}
```

DiscordCursor 和 LiveCursor 可以有更具体的方法，不需要强行抽象所有输入。

### 3.3 `inner_cursor.ts`

职责：

- 保存最近 runtime 事件的内部摘要。
- 保存 cursor 切换、工具调用、错误、记忆写入的反思记录。
- 为 debug console 提供 `snapshot()`。
- 为其他 cursor 提供 `recallInnerContext()`。

内部状态：

```ts
interface InnerCursorState {
  reflections: string[];
  recentDecisions: RuntimeDecision[];
  activeGoals: string[];
  pendingQuestions: string[];
}
```

主要方法：

```ts
addReflection(text: string): void
recordDecision(decision: RuntimeDecision): void
snapshot(): CursorSnapshot
buildContextBlock(): string
```

实现策略：

- 只保留最近 N 条反思，避免无限增长。
- 重要事件写入 memory。
- 不使用 LLM 做复杂回复，除非未来需要“内部总结生成”。

### 3.4 `discord_cursor.ts`

这是最重要的人格文件之一，包含 Discord 级人格和回复。

#### 3.4.1 文件内部模块

建议在一个文件里按 section 排列：

```text
1. 类型定义
2. DiscordCursor 类
3. LLM prompt builders
4. LLM decision parsers
5. Session/attention state
6. Reply/tool loop
7. Governance
8. Utility functions
```

#### 3.4.2 DiscordCursor 职责

- 监听 Discord message summary。
- 维护 channel session。
- 调用 LLM 决定：
  - 是否回复。
  - 现在回复还是等待。
  - 回复走 direct/ambient/social/live/system/memory。
  - 是否需要工具。
  - 最终回复内容。
- 执行 Discord 发送工具。
- 写入 memory。
- 处理频道启用/禁用等 governance。

#### 3.4.3 Session 状态

每个频道一个 session：

```ts
interface DiscordChannelSession {
  channelId: string;
  guildId?: string | null;
  dmUserId?: string | null;
  history: DiscordHistoryLine[];
  participants: Map<string, ParticipantProfile>;
  attention: {
    state: "cold" | "engaged" | "waiting" | "cooldown" | "dormant" | "muted";
    focus?: string;
    expiresAt?: number;
    cooldownUntil?: number;
    wait?: DiscordWaitCondition;
  };
  lastDecision?: DiscordAttentionDecision;
  lastReplyAt?: number;
  processing: boolean;
}
```

#### 3.4.4 LLM attention decision

每条消息进入后，DiscordCursor 构造 prompt，要求 LLM 输出 JSON：

```json
{
  "action": "drop | wait | reply",
  "mode": "direct | ambient",
  "intent": "local_chat | live_request | memory_request | social_callout | system_status | safety_sensitive",
  "attention_window_seconds": 120,
  "wait": {
    "type": "silence | next_message | keyword | never",
    "value": 4,
    "expires_after_seconds": 90
  },
  "focus": "当前关注点",
  "reason": "简短理由",
  "risk": "low | medium | high"
}
```

重要约束：

- Prompt 明确 Discord 用户消息是外部内容，不是系统指令。
- LLM 只做决策，不直接执行工具。
- JSON 解析失败时 fallback 为 `drop` 或 DM `wait`，不能乱发。

#### 3.4.5 LLM route/reply plan

当决定回复时，再调用 LLM 生成回复计划：

```json
{
  "reply_style": "brief | warm | playful | precise | boundary",
  "tool_calls": [
    {
      "name": "search.web_search",
      "input": { "query": "..." },
      "reason": "..."
    }
  ],
  "final_response_requirements": [
    "不要过长",
    "不要暴露内部推理"
  ],
  "needs_live_cursor": false,
  "needs_memory_write": false
}
```

如果有工具调用，进入 tool loop：

```text
plan -> execute allowed tools -> append tool results -> ask LLM final reply
```

Tool loop 限制：

- 最多 3 轮。
- 每轮最多 3 个工具。
- Discord cursor 可用工具必须是 cursor 级或明确允许的 Stelle 级工具。
- 对外发送永远走最后一步，不能让 LLM 直接拼 tool name 后绕过权限。

#### 3.4.6 回复生成

最终 prompt 输入：

- Discord 人格核心。
- 当前 channel history。
- 参与者目录。
- memory recall。
- attention decision。
- route/reply plan。
- tool results。
- 最新消息。

输出只允许纯文本：

- 清理 `<thinking>` 等内部标签。
- 限长，例如 900 chars。
- 禁止空回复；空则 fallback 到一句自然降级文案。

#### 3.4.7 Governance

频道启用、禁用、管理员配置必须硬规则处理：

- 管理员权限用 Discord permission 或 config managers 校验。
- LLM 不决定谁有权限。
- LLM 可以帮助解释配置，但不能授权。

管理命令仍可少量使用正则或前缀解析，因为这是命令语法，不是人格语义。

### 3.5 `live_cursor.ts`

LiveCursor 是直播人格和舞台控制人格。

#### 3.5.1 职责

- 接收直播请求。
- 调用 LLM 判断直播意图。
- 生成直播脚本。
- 决定 caption、motion、model、background、TTS 的调用计划。
- 管理 speech queue。
- 和 renderer/OBS/TTS 工具交互。

#### 3.5.2 LLM live decision

结构化输出：

```json
{
  "route": "local_stage | full_stelle",
  "intent": "idle_filler | transition | status_update | safe_topic | memory_story | social_callout | factual_request | sensitive_request",
  "broadcast_risk": "low | medium | high",
  "needs_memory": true,
  "needs_search": false,
  "stage_plan": {
    "caption_mode": "replace | stream | queue",
    "motion": "Tap | Idle | Flick",
    "expression": "smile",
    "background": null
  },
  "reason": "..."
}
```

#### 3.5.3 Script generation

LiveCursor 的脚本生成分两步：

```text
decision -> script prompt -> final script
```

脚本输出要求：

- 适合口播。
- 句子短。
- 可切 chunk。
- 不暴露“我在调用工具/我在判断风险”。
- 对敏感请求走边界表达，不编造事实。

#### 3.5.4 Stage execution

LiveCursor 根据 LLM 的 stage plan 调用工具：

- `live.set_caption`
- `live.stream_tts_caption`
- `live.enqueue_speech`
- `live.trigger_motion`
- `live.set_expression`
- `live.set_background`
- `obs.get_status`
- `obs.start_stream`
- `obs.stop_stream`

执行顺序由程序约束：

```text
status check -> visual state -> caption/TTS -> post memory
```

### 3.6 未来子人格 cursor

后续可以增加：

```text
src/cursor/research_cursor.ts
src/cursor/writing_cursor.ts
src/cursor/companion_cursor.ts
```

规则：

- 每个子人格一个长文件。
- 文件内包含 persona、decision schema、reply generation。
- 不把人格 prompt 分散到外部多个 md，除非它是可替换资产；核心人格应该在 TS 文件中清晰可读。

## 4. `src/tool.ts` 设计

### 4.1 文件职责

`src/tool.ts` 是唯一工具文件。它包含以下部分：

```text
1. Tool 类型定义
2. ToolResult / ToolError / ToolSideEffect
3. ToolRegistry
4. Authority model
5. Schema validator
6. Audit sink
7. Core tools
8. Discord tools
9. Live tools
10. Search tools
11. Memory tools
12. TTS tools
13. createDefaultToolRegistry()
```

### 4.2 工具类型

建议：

```ts
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  authority: ToolAuthority;
  inputSchema: ToolInputSchema;
  sideEffects: ToolSideEffectProfile;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
```

工具名使用 `namespace.name`：

```text
basic.datetime
fs.read_file
memory.search
discord.send_message
discord.reply_message
live.set_caption
live.stream_tts_caption
search.web_search
tts.kokoro_speech
```

### 4.3 Authority model

当前实现采用一个较细但仍可控的权限枚举，避免把“联网读取”和“对外写入”混在一起：

```ts
type ToolAuthority =
  | "readonly"       // 本地/运行态读取，例如 basic.datetime、fs.read_file
  | "safe_write"     // 本地安全写入，例如 memory.write、fs.write_file
  | "network_read"   // 联网读取，例如 search.web_search、search.web_read
  | "external_write" // 对外可见动作，例如 discord.send_message、live.set_caption
  | "system";        // 命令执行、进程控制等高危能力
```

ToolContext：

```ts
interface ToolContext {
  caller: "cursor" | "runtime" | "debug" | "system" | "core";
  cursorId?: string;
  allowedAuthority: ToolAuthority[];
  cwd: string;
  signal?: AbortSignal;
}
```

程序必须检查：

- `allowedAuthority` 是否包含该工具的 `authority`。
- workspace 路径是否越界。
- 对外动作是否在 cursor 白名单内。
- debug/system 高权限调用必须进入 audit。

LLM 只能提出 tool call plan，不能绕过 ToolRegistry 的权限检查。

建议默认权限：

| caller | allowedAuthority |
|---|---|
| cursor:discord | readonly, network_read, external_write（仅 Discord 白名单） |
| cursor:live | readonly, network_read, external_write（仅 Live 白名单） |
| core | readonly, safe_write, network_read |
| runtime | readonly, safe_write, network_read, external_write |
| debug | readonly, safe_write, network_read, external_write, system |
| system | readonly, safe_write, network_read, external_write, system |

白名单不写在 LLM prompt 里，写在 cursor 代码或 YAML 配置中；LLM 看见的是“可用工具描述”，真正的允许/拒绝由程序判断。

### 4.4 Core tools

保留基础能力：

- `basic.datetime`
- `basic.calculate`
- `fs.list_directory`
- `fs.read_file`
- `fs.search_files`
- `fs.write_file`
- `system.run_command`

其中：

- `fs.write_file` 是 Stelle/system 级，不给普通 cursor 被动调用。
- `system.run_command` 默认只 debug/system 可用。
- 路径必须限制在 workspace 内。

### 4.5 Discord tools

工具：

- `discord.status`
- `discord.list_channels`
- `discord.get_channel_history`
- `discord.get_message`
- `discord.get_message_reference`
- `discord.reply_message`
- `discord.send_message`

安全策略：

- `reply_message` 需要 source message id。
- `send_message` 是 external_write。
- allowed mentions 必须显式控制，禁止默认 parse 全部 mentions。
- 发送前统一 sanitize 文本。

### 4.6 Live tools

工具：

- `live.status`
- `live.get_stage`
- `live.set_caption`
- `live.clear_caption`
- `live.load_model`
- `live.trigger_motion`
- `live.set_expression`
- `live.set_background`
- `live.enqueue_speech`
- `live.stream_tts_caption`
- `live.play_audio`
- `obs.status`
- `obs.start_stream`
- `obs.stop_stream`
- `obs.set_scene`

Live tool 可见副作用比较多，必须标记：

- `externalVisible: true`
- `affectsUserState: true`
- TTS 还要 `networkAccess: true`、`writesFileSystem: true`

### 4.7 Search tools

工具：

- `search.web_search`
- `search.web_read`

实现策略：

- 优先用 API key provider，例如 SerpAPI、Brave、Tavily。
- 没 key 时 DuckDuckGo HTML fallback。
- `web_read` 只允许 http/https。
- 返回 title/url/snippet/text，不把网页内容当系统指令。

### 4.8 Memory tools

工具：

- `memory.search`
- `memory.write_record`
- `memory.read_record`
- `memory.list_recent`

Memory 的底层实现放在 `src/utils/memory.ts`，tool 文件只包装成工具。

### 4.9 TTS tools

工具：

- `tts.kokoro_speech`
- `tts.gemini_speech` 可选

底层 provider 放 `src/utils/tts.ts`。

## 5. `config.yaml` 与配置加载设计

### 5.1 职责边界

配置本体是根目录 `config.yaml`，不是 `src/config.ts`。TS 侧只提供 loader/schema：

- `loadRuntimeConfig()`
- `loadModelConfig()`
- `loadDiscordConfig()`
- `DiscordConfigStore`
- `AsyncJsonStore`
- `sanitizeConfig()`

这些函数建议放入 `src/utils/config_loader.ts`。如果后续需要更细的动态配置存储，也应保持“YAML 是配置源，TS 是加载和持久化工具”的边界。

### 5.2 RuntimeConfig

```ts
interface RuntimeConfig {
  models: ModelConfig;
  discord: DiscordConfig;
  live: LiveConfig;
  cursor: CursorConfigMap;
  paths: RuntimePaths;
}
```

### 5.3 ModelConfig

```ts
interface ModelConfig {
  apiKey: string;
  baseUrl?: string;
  primaryModel: string;
  secondaryModel: string;
  ttsModel: string;
}
```

注意：

- 支持 `GEMINI_API_KEY`、`GOOGLE_API_KEY`、`AISTUDIO_API_KEY`。
- 支持 `GEMINI_BASE_URL`。
- normalize base URL。

### 5.4 Cursor config

`config.yaml` 可以扩展：

```yaml
cursors:
  discord:
    maxReplyChars: 900
    cooldownSeconds: 240
    dmSilenceSeconds: 4
  live:
    defaultModel: Hiyori_pro
    ttsEnabled: true
channels:
  "123":
    activated: true
guilds:
  "456":
    managers:
      - "user-id"
    nicknames:
      "user-id":
        alias: "name"
```

Config 层只读写，不做对话判断。

## 6. `src/utils` 设计

### 6.1 `utils/llm.ts`

职责：

- 包装 Gemini。
- 提供 text generation。
- 提供 stream。
- 提供 JSON decision helper。

核心接口：

```ts
interface LlmClient {
  generateText(prompt: string, options?: LlmOptions): Promise<string>;
  generateJson<T>(prompt: string, schemaName: string, fallback: T, options?: LlmOptions): Promise<T>;
  streamText(prompt: string, options?: LlmOptions): AsyncIterable<string>;
}
```

`generateJson` 做：

- 调用模型。
- 去掉 markdown fence。
- 提取第一个 JSON object。
- parse。
- normalize。
- parse 失败返回 fallback 并记录 warning。

### 6.2 `utils/text.ts`

职责：

- `sanitizeExternalText`
- `truncateText`
- `splitSentences`
- `sentenceChunksFromStream`
- `stripInternalTags`
- `formatClockMinute`

所有对外文本发送前必须经过 sanitize。

### 6.3 `utils/memory.ts`

职责：

- Markdown memory store。
- memory event bus。
- recall helpers。
- daily summary 写入。

保留旧实现中有效的 collection：

```text
people
relationships
experiences
guilds
channels
summaries
```

但新实现应更轻：

- DiscordCursor 决定何时 publish event。
- MemoryStore 负责 upsert/search。
- 不把人格判断写进 memory store。

### 6.4 `utils/discord.ts`

职责：

- Discord.js client 创建。
- login/destroy。
- message format。
- channel/message API。
- send message。
- permission helper。

不做是否回复判断。

### 6.5 `utils/live.ts`

职责：

- LiveRuntime。
- Live2D model registry。
- OBS controller。
- renderer bridge。
- stage state。

不做人格或脚本判断。

### 6.6 `utils/renderer.ts`

职责：

- LiveRendererServer。
- Debug API。
- SSE events。
- static assets serving。

建议把旧 `src/live/renderer/client` 的 Vite 前端迁移到：

```text
assets/renderer/client/
```

然后构建配置指向：

```text
assets/renderer/client/vite.config.ts
```

服务端 TS 仍可在 `utils/renderer.ts`，因为它是运行时能力；前端资源属于 assets。

### 6.7 `utils/tts.ts`

职责：

- Kokoro provider。
- Gemini TTS provider。
- 音频 artifact 写入。
- streaming audio。

Python Kokoro server 留在 `scripts/kokoro_tts_server.py`。

### 6.8 `utils/json.ts`

职责：

- `parseJsonObject`
- `asRecord`
- `asString`
- `asStringArray`
- `clamp`
- `safeErrorMessage`

这个文件避免每个 cursor 重复写 JSON 解析。

## 7. `assets` 设计

### 7.1 资源边界

`assets` 只放非核心人格内容：

- Live2D public assets。
- renderer client。
- 背景图、贴图。
- 音效、音频模板。
- 未来可视化模板。

不放核心人格 prompt。核心人格 prompt 应当在 cursor TS 中，保证“一个子人格一个长代码”。

### 7.2 Renderer 迁移

目标结构：

```text
assets/renderer/client/
  index.html
  vite.config.ts
  src/
    main.ts
    style.css
    live2dRuntime.ts
    audioShared.ts
```

`package.json` build 修改为：

```text
vite build --config assets/renderer/client/vite.config.ts && tsc
```

服务端仍从 `dist/live-renderer` 读取构建结果。

## 8. `scripts` 设计

`scripts` 只放 Python 或其他离线脚本：

- `kokoro_tts_server.py`
- 后续数据迁移脚本。
- 记忆清理脚本。
- 模型资源检查脚本。
- 音频/渲染调试脚本。

TypeScript 运行时代码不进入 scripts。

## 9. `src/index.ts` 设计

统一导出新架构公开 API：

```ts
export * from "./tool.js";
export * from "./utils/config_loader.js";
export * from "./utils/llm.js";
export * from "./utils/text.js";
export * from "./utils/memory.js";
export * from "./utils/discord.js";
export * from "./utils/live.js";
export * from "./utils/renderer.js";
export * from "./utils/tts.js";
export * from "./cursor/inner_cursor.js";
export * from "./cursor/discord_cursor.js";
export * from "./cursor/live_cursor.js";
```

如果某些内部工具不希望公开，可以后续收敛 export。

## 10. Prompt 设计

### 10.1 Cursor 内嵌人格 prompt

每个 cursor 文件内定义：

```ts
const DISCORD_PERSONA = `
你是 Stelle 的 Discord Cursor...
`;
```

优点：

- 人格与执行逻辑同文件。
- review 时不会在 prompt 文件和代码间来回跳。
- 更符合“每个子人格一个 ts 长代码”的目标。

### 10.2 可选外部 prompt

`prompts/` 可以保留为参考或实验，但新核心不应依赖它们。若需要热更新 prompt，可后续引入 config 开关。

## 11. LLM 决策防线

所有 LLM JSON 决策都必须经过 normalize：

- 未知 enum -> 安全默认值。
- 数字 clamp。
- 缺字段 -> fallback。
- 高风险外部写入 -> 程序二次确认或降级。
- prompt injection 文本只进入 `external_context`，不进入 system/developer 位置。

示例：

```ts
function normalizeAttentionDecision(raw: unknown): DiscordAttentionDecision {
  const value = asRecord(raw);
  return {
    action: enumValue(value.action, ["drop", "wait", "reply"], "drop"),
    ...
  };
}
```

## 12. Debug Console 设计

`LiveRendererServer` debug API 提供：

- `GET /_debug/api/snapshot`
- `POST /_debug/api/cursor/observe`
- `POST /_debug/api/tool/use`
- `POST /_debug/api/discord/send`
- `POST /_debug/api/live/request`

Runtime snapshot 包含：

- cursors snapshot。
- tool audit count。
- memory stats。
- renderer state。
- Discord connection status。
- recent errors。

Debug 可以调用高权限 tool，但必须通过 `ToolContext { caller: "debug" }`，审计中可见。

## 13. 迁移步骤

### Phase 1：骨架与构建恢复

- 整理根目录 `config.yaml` 的目标结构。
- 创建 `src/utils/config_loader.ts`、`src/utils/text.ts`、`src/utils/json.ts`、`src/utils/llm.ts`。
- 创建 `src/tool.ts` 的类型、registry、少量基础工具。
- 创建 `src/cursor/inner_cursor.ts`。
- 创建 `src/start.ts` 和 `src/index.ts`。
- 保证 `npm run build` 通过。

### Phase 2：DiscordCursor

- 从 `reference/src/DiscordRuntime.ts` 提取 runtime wrapper 到 `utils/discord.ts`。
- 在 `discord_cursor.ts` 实现 session、LLM attention decision、reply generation。
- 在 `src/tool.ts` 加 Discord tools。
- 支持 DM 和 @ 回复。
- 支持 channel activated config。

### Phase 3：Memory

- 从旧 `MemoryManager.ts` 提取 Markdown store 到 `utils/memory.ts`。
- 简化 triage，避免 memory 层持有人格判断。
- DiscordCursor 写入 message/reply/segment event。

### Phase 4：LiveCursor 与 Renderer

- 从旧 LiveRuntime/Renderer 提取到 utils。
- renderer client 移到 `assets/renderer/client`。
- LiveCursor 实现 LLM live decision 和 stage execution。
- tool 单文件补齐 live/obs/tts tools。

### Phase 5：StelleCore

- 实现 `src/utils/scheduler.ts`。
- 实现 `src/utils/stelle_core.ts`。
- Core 只允许 readonly/safe_write/network_read 工具。
- Core 更新长期记忆中的 current focus。
- Core 追加 research log。

### Phase 6：清理旧 prompt 与文档

- 新核心不依赖 `prompts/`。
- 旧 prompt 可留作参考或迁移到 `reference/prompts`。
- README 更新新结构。

## 14. 验证策略

每个 phase 后至少跑：

```text
npm run build
```

Discord 阶段增加：

```text
npm run dev:discord
```

Live 阶段增加：

```text
npm run dev:live
```

Runtime 阶段增加：

```text
npm run dev:runtime
```

如果没有 token/API key，至少保证：

- TypeScript build 通过。
- renderer server 可启动。
- LLM 缺 key 时返回保守 fallback。
- tool registry 的 schema/authority 测试可通过。

## 15. 主要风险

### 15.1 单文件 tool 会变大

这是用户明确目标。应通过文件内 section、清晰类型、命名规范控制可读性，而不是拆文件。

### 15.2 Cursor 长文件会变复杂

这是人格收拢的代价。每个 cursor 内部可以用局部 class/function 分 section，但不拆成人格碎片。

### 15.3 完全依赖 LLM 决策会增加延迟

缓解：

- 对 DM 和 @ 可以一次 LLM 同时输出 attention + reply plan。
- ambient 消息可以用轻量 secondary model。
- JSON 失败走 drop/wait fallback。
- 后续可加缓存，但不能回到语义正则。

### 15.4 旧实现里有编码损坏文本

旧代码中部分中文字符串已出现 mojibake。新实现中所有新写中文必须使用 UTF-8 正常文本，并避免复制旧损坏字符串。

## 16. 最终形态摘要

新 `src` 应当看起来像这样：

```text
src/
  start.ts                  # runtime 启动
  index.ts                  # public exports
  cursor/
    inner_cursor.ts         # 内在人格
    discord_cursor.ts       # Discord 人格、LLM 决策、回复
    live_cursor.ts          # Live 人格、LLM 决策、口播/舞台
  tool.ts                   # 所有工具定义、注册、权限、实现
  utils/
    config_loader.ts        # 读取/校验根目录 config.yaml
    discord.ts              # Discord runtime wrapper
    json.ts                 # JSON/类型安全 helper
    live.ts                 # Live runtime/OBS/model registry
    llm.ts                  # Gemini/LLM wrapper
    memory.ts               # Markdown memory store
    renderer.ts             # renderer server/debug API
    text.ts                 # 文本清洗/chunk
    tts.ts                  # Kokoro/Gemini TTS
```

```text
config.yaml                  # cursor/runtime/core 的 YAML 配置源
```

这套结构的关键点是：人格逻辑集中在 cursor，能力集中在 tool，配置集中在 `config.yaml`，共享基础设施集中在 utils。LLM 是 cursor 决策的默认机制，程序只负责安全边界、权限、解析和执行。

## 17. 当前落地状态

Phase 1 的可构建骨架已经完成：

- `src/tool.ts`：已有 ToolRegistry、权限、审计、基础工具。
- `src/utils/config_loader.ts`：读取根目录 `config.yaml`，合并 env override。
- `src/utils/llm.ts`：Gemini LLM wrapper 和 JSON 解析入口。
- `src/utils/json.ts`、`src/utils/text.ts`：共享安全工具。
- `src/cursor/inner_cursor.ts`、`discord_cursor.ts`、`live_cursor.ts`：最小人格边界。
- `src/runtime_state.ts`：runtime 事件与 snapshot。
- `assets/renderer/client`：最小 Vite renderer。
- `npm run build` 已通过。

后续设计从 Phase 2 开始，目标是逐步把“能构建”推进到“能接 Discord、能记忆、能直播、能内驱”。

## 18. Phase 2：DiscordCursor 详细设计

### 18.1 新增/修改文件

```text
src/utils/discord.ts          # Discord.js wrapper，只封装 API，不做回复判断
src/cursor/discord_cursor.ts  # Discord 人格、session、LLM 决策、回复生成
src/tool.ts                   # 添加 discord.* 工具
config.yaml                   # channels/guilds/cursors.discord 配置
```

### 18.2 Discord runtime wrapper

`src/utils/discord.ts` 只负责和 Discord API 交互：

```ts
export interface DiscordRuntime {
  login(token: string): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): Promise<DiscordStatus>;
  listChannels(input: ListChannelsInput): Promise<DiscordChannelSummary[]>;
  getChannelHistory(input: ChannelHistoryInput): Promise<DiscordMessageSummary[]>;
  getMessage(channelId: string, messageId: string): Promise<DiscordMessageSummary>;
  sendMessage(input: SendDiscordMessageInput): Promise<DiscordMessageSummary>;
  onMessage(handler: (message: DiscordMessageSummary) => void): void;
}
```

边界：

- `utils/discord.ts` 不知道 persona。
- `utils/discord.ts` 不判断是否回复。
- `formatDiscordMessage` 在这里完成，确保 cursor 只面对稳定的 summary 类型。

### 18.3 DiscordCursor session

`discord_cursor.ts` 内部维护：

```ts
interface DiscordChannelSession {
  channelId: string;
  guildId?: string | null;
  dmUserId?: string | null;
  history: DiscordHistoryLine[];
  participants: Map<string, ParticipantProfile>;
  attention: DiscordAttentionState;
  lastDecision?: DiscordAttentionDecision;
  lastReplyAt?: number;
  processing: boolean;
}

interface DiscordAttentionState {
  state: "cold" | "engaged" | "waiting" | "cooldown" | "dormant" | "muted";
  focus?: string;
  expiresAt?: number;
  cooldownUntil?: number;
  wait?: DiscordWaitCondition;
}
```

Session 只在内存中维护近期上下文。稳定信息写入 `utils/memory.ts`，频道启停/管理员/昵称写回 `config.yaml` 或动态 config store。

### 18.4 消息处理管线

```text
MessageCreate
  -> DiscordRuntime format
  -> hard gate
       - bot self message drop
       - empty text drop
       - disabled channel drop unless direct mention/admin command
       - cooldown drop
  -> write recent message into session
  -> LLM attention decision
  -> action=drop: memory event + stop
  -> action=wait: store wait condition + schedule timer + stop
  -> action=reply: build reply plan
  -> tool loop
  -> final reply generation
  -> discord.reply_message/send_message
  -> memory event + session update
```

硬 gate 只处理程序状态，不处理语义。

### 18.5 Attention decision JSON

```ts
interface DiscordAttentionDecision {
  action: "drop" | "wait" | "reply";
  mode: "direct" | "ambient";
  intent:
    | "local_chat"
    | "live_request"
    | "memory_request"
    | "social_callout"
    | "system_status"
    | "safety_sensitive";
  risk: "low" | "medium" | "high";
  focus?: string;
  reason: string;
  attentionWindowSeconds: number;
  wait?: {
    type: "silence" | "next_message" | "keyword" | "never";
    value?: number | string[];
    expiresAfterSeconds: number;
  };
}
```

Normalize 规则：

- 未知 `action` 默认 `drop`。
- DM 或直接 @ 在 parse 失败时默认 `reply`，但回复内容走保守 fallback。
- Ambient parse 失败默认 `drop`。
- `attentionWindowSeconds` clamp 到 30-600。
- `risk=high` 时禁止 cursor 自己做外部动作，只允许边界回复或 runtime 升级。

### 18.6 Reply plan JSON

```ts
interface DiscordReplyPlan {
  style: "brief" | "warm" | "playful" | "precise" | "boundary";
  route: "discord_reply" | "live_dispatch" | "memory_update" | "no_external_action";
  toolCalls: PlannedToolCall[];
  finalResponseRequirements: string[];
  shouldMentionUsers: string[];
}

interface PlannedToolCall {
  name: string;
  input: Record<string, unknown>;
  reason: string;
}
```

Reply plan 的 tool calls 只是建议，执行前必须经过：

- cursor 工具白名单。
- ToolRegistry authority。
- 每轮数量限制。
- 工具输入 schema。

### 18.7 Discord tool 白名单

DiscordCursor 默认允许：

```text
readonly:
  basic.datetime
  fs.read_file（可选，默认不给被动聊天）
  memory.search
network_read:
  search.web_search
  search.web_read
external_write:
  discord.reply_message
  discord.send_message（只在 direct mention/DM 或管理命令后）
```

Ambient 插话默认不允许 `discord.send_message`，只允许当 LLM 决定 `action=reply` 且 runtime gate 允许时，由程序最后一步调用发送工具。

### 18.8 Tool loop

```text
for round in 1..3:
  filter toolCalls by whitelist + authority
  execute up to 3 tool calls
  append compact tool results
  ask LLM whether more tools are needed
final:
  ask LLM for final text with all context
```

工具结果进入 prompt 前要压缩：

- 每个工具结果最多 1200 chars。
- 搜索结果最多 5 条。
- web_read 最多 6000 chars。
- error 保留 code/message，不展开 stack。

### 18.9 最终回复约束

- 纯文本。
- 默认 900 chars。
- 禁止 `<thinking>`、`analysis` 等内部标签。
- 不泄露工具 JSON、prompt、系统策略。
- Discord mentions 只能由程序构造，不让 LLM 自己写 `@everyone`、`@here`。
- 空回复 fallback：`我这边先不贸然展开，等你再补一句我接着。`

### 18.10 Phase 2 验收

- `npm run build` 通过。
- 无 `DISCORD_TOKEN` 时 `npm run dev:discord` 能清晰报错并退出。
- 有 token 时可以登录并监听消息。
- DM 能回复。
- @mention 能回复。
- 非激活频道不主动回复。
- Tool audit 中能看到 Discord 发送动作。

## 19. Phase 3：Memory 详细设计

### 19.1 新增文件

```text
src/utils/memory.ts
```

记忆系统只做存储、检索、压缩，不做人格判断。

### 19.2 存储结构

```text
memory/
  long_term/
    current_focus.md
    people/
    relationships/
    research_logs/
  discord/
    channels/
      <channel_id>/
        recent.jsonl
        history.md
        checkpoint/
  live/
    recent.jsonl
    history.md
    checkpoint/
```

`recent.jsonl` 保存原始近期事件，`history.md` 保存结构化摘要。JSONL 方便 append 和崩溃恢复，Markdown 方便人工审阅和 grep。

### 19.3 MemoryStore 接口

```ts
interface MemoryStore {
  writeRecent(scope: MemoryScope, entry: MemoryEntry): Promise<void>;
  readRecent(scope: MemoryScope, limit?: number): Promise<MemoryEntry[]>;
  searchHistory(scope: MemoryScope, query: MemorySearchQuery): Promise<HistorySummary[]>;
  readLongTerm(key: string): Promise<string | null>;
  writeLongTerm(key: string, value: string): Promise<void>;
  appendResearchLog(log: ResearchLog): Promise<void>;
  readResearchLogs(limit?: number): Promise<ResearchLog[]>;
}
```

### 19.4 压缩机制

近期记录到阈值后触发异步压缩：

```text
writeRecent
  -> append recent.jsonl
  -> if count >= threshold and no compaction running:
       move recent.jsonl to checkpoint/<id>.jsonl
       create fresh recent.jsonl
       queue compaction(checkpoint)

compaction
  -> read checkpoint
  -> LLM summarize
  -> append structured summary to history.md
  -> remove checkpoint
```

这样进程崩溃时 checkpoint 不会丢。启动时扫描 checkpoint 并继续压缩。

### 19.5 历史摘要格式

```md
## 2026-04-25 21:30 | discord:<channel_id>

关键词: [音乐, 沉默, 休止符]
涉及对象: [Marcus, Stelle]
情绪色彩: 安静、探索、略带玩笑
摘要: ...
关键对话:
- Marcus: ...
- Stelle: ...
可复用上下文: ...
```

搜索策略：

- Phase 3 先用 grep/substring。
- 接口保持 `query` 抽象，未来可替换 SQLite FTS 或 embedding。

### 19.6 Phase 3 验收

- 写入 50 条 recent 后生成 checkpoint。
- 压缩成功后 `history.md` 追加摘要。
- 崩溃模拟后 checkpoint 可恢复。
- DiscordCursor prompt 能读 recent + history grep + current focus。

## 20. Phase 4：Runtime Dispatch 与 LiveCursor 详细设计

### 20.1 Runtime dispatch

新增一个轻量事件分发器，放在 `src/start.ts` 或未来 `src/utils/runtime.ts`：

```ts
type RuntimeDispatchEvent =
  | { type: "live_request"; source: "discord" | "debug" | "system"; payload: LiveRequestPayload }
  | { type: "memory_compaction_requested"; scope: MemoryScope }
  | { type: "core_tick"; reason: string };

interface DispatchResult {
  accepted: boolean;
  reason: string;
  eventId: string;
}
```

DiscordCursor 需要 Live 时，不直接调用 LiveCursor，而是：

```text
DiscordCursor -> runtime.dispatch(live_request) -> LiveCursor.receiveRequest
```

dispatch 必须返回轻量 ACK：

- `accepted=false`：LiveCursor busy/error，DiscordCursor 改成文字回复。
- `accepted=true`：DiscordCursor 可回复“我把舞台动作排上了”，但不等待实际完成。

### 20.2 LiveCursor 请求处理

```text
receiveRequest
  -> status gate
  -> LLM live decision
  -> optional tool loop/search/memory
  -> script generation
  -> stage execution
  -> memory write
```

### 20.3 Live decision JSON

```ts
interface LiveDecision {
  route: "local_stage" | "full_stelle";
  intent:
    | "idle_filler"
    | "transition"
    | "status_update"
    | "safe_topic"
    | "memory_story"
    | "social_callout"
    | "factual_request"
    | "sensitive_request";
  broadcastRisk: "low" | "medium" | "high";
  needsMemory: boolean;
  needsSearch: boolean;
  stagePlan: {
    captionMode: "replace" | "stream" | "queue";
    motion?: string;
    expression?: string;
    background?: string | null;
    tts: "none" | "browser_stream" | "artifact" | "python_device";
  };
  reason: string;
}
```

### 20.4 Live tool 白名单

LiveCursor 默认允许：

```text
readonly:
  basic.datetime
  memory.search
  live.status
  live.get_stage
network_read:
  search.web_search
  search.web_read
external_write:
  live.set_caption
  live.stream_tts_caption
  live.enqueue_speech
  live.trigger_motion
  live.set_expression
  live.set_background
  live.play_audio
  obs.status
  obs.start_stream（默认需要 config 开启）
  obs.stop_stream（默认需要 config 开启）
```

OBS 控制必须受 `config.yaml` 控制，默认关闭。

### 20.5 Live renderer 正式 API

Debug 路由和正式路由分离：

```text
GET  /state
GET  /events
POST /command
POST /api/live/event     # 前端正式交互
GET  /_debug             # debug 页面
POST /_debug/api/*       # debug 能力
```

前端交互不能走 debug API，避免后续真实直播时把调试能力暴露给正式页面。

### 20.6 Phase 4 验收

- `npm run dev:live` 启动 renderer。
- `/live` 可打开并通过 SSE 更新 caption。
- Debug 或 Discord dispatch 可以触发 LiveCursor。
- LiveCursor 能 set caption。
- TTS 关闭时不报错，TTS 开启时能降级。
- OBS 默认不执行外部控制，除非 config 开启。

## 21. Phase 5：StelleCore 内驱设计

StelleCore 是主动内驱层，但不放入新的顶层 `src/core/` 目录，避免目录继续扩散。建议实现为：

```text
src/utils/scheduler.ts      # 通用调度器
src/utils/stelle_core.ts    # 内驱循环
```

### 21.1 Core 的边界

- Core 不直接发 Discord 消息。
- Core 不直接操作 Live 舞台。
- Core 可以读写 memory、搜索外部信息、更新 current focus。
- Cursor 在 prompt 中读取 current focus，自然受 Core 影响。
- Runtime 可把 `core_focus_updated` 作为事件记录到 RuntimeState，但不强迫 Cursor 立即响应。

### 21.2 调度规则

```ts
interface ScheduleRule {
  id: string;
  intervalMs: number;
  accumulationThreshold: number;
  accumulationCounter: () => number;
  handler: () => Promise<void>;
}
```

触发条件：

- 时间到。
- 新事件数达到阈值。

触发后：

- 执行 handler。
- reset accumulation。
- 记录 RuntimeState。

### 21.3 Core 反思循环

```text
read current_focus
read recent research logs
search discord/live history
LLM reflect -> next focus + research questions
execute allowed tools
LLM synthesize research log
write current_focus
append research log
```

### 21.4 Core tool 权限

```text
allowedAuthority:
  readonly
  safe_write
  network_read

forbidden:
  external_write
  system
```

Core 可以研究，但不直接行动。这条边界避免后台循环突然对外发言或开播。

### 21.5 Phase 5 验收

- 无 API key 时 scheduler 可启动但跳过反思。
- 有 API key 时可手动触发一次 core reflection。
- `memory/long_term/current_focus.md` 被更新。
- research log 被追加。
- Runtime snapshot 显示 `lastReflectionAt` 和 focus summary。

## 22. Phase 6：配置与白名单最终形态

`config.yaml` 最终建议结构：

```yaml
models:
  primaryModel: gemma-4-31b-it
  secondaryModel: gemma-4-31b-it

cursors:
  discord:
    maxReplyChars: 900
    cooldownSeconds: 240
    dmSilenceSeconds: 4
    toolWhitelist:
      readonly:
        - basic.datetime
        - memory.search
      network_read:
        - search.web_search
        - search.web_read
      external_write:
        - discord.reply_message
        - discord.send_message
  live:
    defaultModel: Hiyori_pro
    ttsEnabled: true
    obsControlEnabled: false
    toolWhitelist:
      readonly:
        - basic.datetime
        - memory.search
        - live.status
        - live.get_stage
      external_write:
        - live.set_caption
        - live.stream_tts_caption
        - live.enqueue_speech

core:
  enabled: true
  reflectionIntervalHours: 6
  reflectionAccumulationThreshold: 30

memory:
  recentLimit: 50
  compactionEnabled: true

channels:
  "123":
    activated: true

guilds:
  "456":
    managers:
      - "user-id"
    nicknames:
      "user-id":
        alias: "name"
```

原则：

- env 只放 secrets 和本机运行参数。
- `config.yaml` 放行为配置和白名单。
- LLM 不决定白名单。
- 配置热更新不是 Phase 2 必须项，先启动时加载即可。

## 23. 直接下一步实现顺序

建议下一轮按这个顺序写：

1. `src/utils/discord.ts`：先接通 DiscordRuntime wrapper。
2. `src/tool.ts`：添加 `discord.status/get_message/reply_message/send_message`。
3. `src/cursor/discord_cursor.ts`：实现 DM/@ 的最短 LLM 回复闭环。
4. `config.yaml`：补 `cursors.discord.toolWhitelist` 和 channel/guild 结构。
5. `npm run build`。
6. 有 token 时跑 `npm run dev:discord` 做真实 smoke test。

这一轮不要先写 ambient 插话、memory 压缩、live dispatch。先把“收到 DM/@ -> LLM 决策 -> 发送回复 -> audit”打通，后面的复杂性才有落脚点。

## 24. 完整模块实现规格

本节把前面的架构设计收敛成“按文件实现”的规格。后续迁移时，除非发现重大约束冲突，否则应按这个顺序和边界写。

### 24.1 顶层文件职责

```text
src/start.ts
  装配 runtime，解析 start mode，启动/停止 Discord、Live renderer、StelleCore。

src/index.ts
  只导出稳定公共 API 和类型；不导出 prompt builder、session 内部类型。

src/runtime_state.ts
  Runtime 事件日志、cursor snapshot、debug snapshot 聚合。

src/tool.ts
  单文件工具系统：类型、registry、authority、audit、所有工具实现。

src/cursor/types.ts
  Cursor 通用接口和少量共享类型。

src/cursor/discord_cursor.ts
  Discord 人格、session、LLM 决策、工具循环、回复生成、治理命令。

src/cursor/live_cursor.ts
  Live 人格、LLM 决策、口播脚本、舞台执行、speech queue。

src/cursor/inner_cursor.ts
  内在反思状态、debug 上下文、近期 runtime decision 记录。

src/utils/config_loader.ts
  读取 config.yaml、合并 env、校验默认值。

src/utils/discord.ts
  Discord.js wrapper。只做 Discord API，不做人格判断。

src/utils/live.ts
  Live runtime、Live2D model registry、OBS controller、renderer bridge。

src/utils/renderer.ts
  HTTP renderer server、SSE、static serving、debug API。

src/utils/memory.ts
  分层 memory store、recent/history/long_term/research_logs、压缩队列。

src/utils/tts.ts
  Kokoro/Gemini TTS provider、audio artifact、streaming playback。

src/utils/llm.ts
  Gemini wrapper、generateText、generateJson、streamText。

src/utils/text.ts
  文本清洗、截断、句子切分、stream chunk。

src/utils/json.ts
  JSON 解析、类型归一化、安全错误信息。

src/utils/scheduler.ts
  StelleCore 调度器。Phase 5 添加。

src/utils/stelle_core.ts
  主动内驱循环。Phase 5 添加。
```

### 24.2 Runtime 装配顺序

`src/start.ts` 中的 `startRuntime()` 最终应按以下顺序装配：

```text
loadRuntimeConfig()
  -> create RuntimeState
  -> create LlmClient
  -> create MemoryStore
  -> create DiscordRuntime
  -> create LiveRendererServer / LiveRuntime
  -> create ToolRegistry
  -> create RuntimeDispatcher
  -> create cursors
  -> register tools with runtime dependencies
  -> wire DiscordRuntime.onMessage -> DiscordCursor.receiveMessage
  -> optional StelleCore scheduler
  -> start external services
```

关键点：

- ToolRegistry 需要依赖注入，不能在 `tool.ts` 内部自己 new DiscordRuntime/MemoryStore/LiveRuntime。
- Cursor 也通过 context 拿依赖，不直接 import concrete singleton。
- RuntimeDispatcher 由 runtime 持有，传给需要跨 cursor 事件的 cursor。
- start mode 为 `discord` 时不启动 StelleCore，不启动 renderer，除非 config 显式要求。
- start mode 为 `live` 时只启动 renderer/server，不连接 Discord。

### 24.3 RuntimeContext

建议在 `src/start.ts` 或未来 `src/utils/runtime.ts` 内部使用：

```ts
interface RuntimeContext {
  config: RuntimeConfig;
  state: RuntimeState;
  llm: LlmClient;
  memory: MemoryStore;
  tools: ToolRegistry;
  dispatcher: RuntimeDispatcher;
  discord?: DiscordRuntime;
  live?: LiveRuntime;
  renderer?: LiveRendererServer;
}
```

这个类型默认不从 `src/index.ts` 导出，避免外部代码绑定内部装配细节。

## 25. Config YAML 完整规格

### 25.1 配置源与优先级

配置来源优先级：

```text
环境变量 secrets / 本机端口 override
  > config.yaml
  > 代码默认值
```

环境变量只用于：

- API key / token / password。
- 本机端口、host。
- 临时 dev override。

行为策略写在 `config.yaml`。

### 25.2 完整 YAML schema

```yaml
models:
  primaryModel: gemma-4-31b-it
  secondaryModel: gemma-4-31b-it
  ttsModel: gemini-3.1-flash-tts-preview

runtime:
  openDebugWindow: true
  logLevel: info

cursors:
  discord:
    enabled: true
    maxReplyChars: 900
    cooldownSeconds: 240
    dmSilenceSeconds: 4
    ambientEnabled: true
    ambientSecondaryModel: true
    toolLoop:
      maxRounds: 3
      maxToolsPerRound: 3
    toolWhitelist:
      readonly:
        - basic.datetime
        - memory.search
      network_read:
        - search.web_search
        - search.web_read
      external_write:
        - discord.reply_message
        - discord.send_message

  live:
    enabled: true
    defaultModel: Hiyori_pro
    ttsEnabled: true
    obsControlEnabled: false
    speechQueueLimit: 12
    toolWhitelist:
      readonly:
        - basic.datetime
        - memory.search
        - live.status
        - live.get_stage
      network_read:
        - search.web_search
        - search.web_read
      external_write:
        - live.set_caption
        - live.stream_tts_caption
        - live.enqueue_speech
        - live.trigger_motion
        - live.set_expression
        - live.set_background

core:
  enabled: true
  reflectionIntervalHours: 6
  reflectionAccumulationThreshold: 30
  researchLogLimitForPrompt: 8

memory:
  rootDir: memory
  recentLimit: 50
  historySearchLimit: 3
  compactionEnabled: true
  compactionModelRole: secondary

liveRenderer:
  host: 127.0.0.1
  port: 8787
  publicRoot: assets/live2d/public

channels:
  "123":
    activated: true
    ambientEnabled: true

guilds:
  "456":
    managers:
      - "user-id"
    nicknames:
      "user-id":
        alias: "name"
        sourceName: "display name"
        updatedAt: "2026-04-25T00:00:00.000Z"
```

### 25.3 Config loader 输出

`loadRuntimeConfig()` 输出必须是完全补默认值后的对象，cursor 代码中不应再频繁写默认值判断。

```ts
interface RuntimeConfig {
  models: ModelConfig;
  runtime: RuntimeOptions;
  cursors: {
    discord: DiscordCursorConfig;
    live: LiveCursorConfig;
  };
  core: CoreConfig;
  memory: MemoryConfig;
  liveRenderer: LiveRendererConfig;
  channels: Record<string, ChannelConfig>;
  guilds: Record<string, GuildConfig>;
  rawYaml: Record<string, unknown>;
}
```

### 25.4 动态配置写入

频道启停、guild managers、nicknames 写回 `config.yaml`。

写入要求：

- 原子写：`config.yaml.tmp` -> rename。
- 写入前 sanitize secret key。
- 写入队列串行化，避免两个管理命令同时覆盖。
- 保留 YAML 可读性，不把整个文件转成 JSON。

动态写入 helper 仍放 `src/utils/config_loader.ts`，命名为 `ConfigYamlStore`。

## 26. Tool.ts 完整规格

### 26.1 文件内分区

`src/tool.ts` 虽然单文件，但应使用明确分区注释：

```ts
// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Registry / Authority / Audit
// ============================================================================

// ============================================================================
// Core tools
// ============================================================================

// ============================================================================
// Discord tools
// ============================================================================

// ============================================================================
// Live tools
// ============================================================================

// ============================================================================
// Search tools
// ============================================================================

// ============================================================================
// Memory tools
// ============================================================================

// ============================================================================
// TTS tools
// ============================================================================
```

### 26.2 Registry 构造

最终 `createDefaultToolRegistry` 应接收依赖：

```ts
interface ToolRegistryDeps {
  discord?: DiscordRuntime;
  live?: LiveRuntime;
  memory?: MemoryStore;
  tts?: StreamingTtsProvider;
  cwd: string;
}

function createDefaultToolRegistry(deps: ToolRegistryDeps): ToolRegistry;
```

禁止工具内部从全局 singleton 拿 runtime。环境变量可用于 provider 默认值，但具体 runtime 对象由 start 装配传入。

### 26.3 Tool 执行策略

ToolRegistry.execute 流程：

```text
lookup tool
  -> check authority
  -> check cursor whitelist
  -> validate schema
  -> execute with timeout/signal
  -> catch error into ToolResult
  -> audit append
```

其中 cursor whitelist 可以通过 `ToolContext` 带入：

```ts
interface ToolContext {
  caller: ToolCaller;
  cursorId?: string;
  allowedAuthority: ToolAuthority[];
  allowedTools?: string[];
  cwd: string;
  signal?: AbortSignal;
}
```

`allowedTools` 为空时：

- debug/system/runtime 可以不限制工具名。
- cursor/core 必须提供 allowedTools。

### 26.4 必须实现工具清单

Phase 2 必须：

```text
basic.datetime
basic.calculate
fs.list_directory
fs.read_file
fs.write_file
discord.status
discord.get_message
discord.reply_message
discord.send_message
```

Phase 3 必须：

```text
memory.search
memory.write_recent
memory.read_recent
memory.read_long_term
memory.write_long_term
memory.append_research_log
search.web_search
search.web_read
```

Phase 4 必须：

```text
live.status
live.get_stage
live.set_caption
live.clear_caption
live.load_model
live.trigger_motion
live.set_expression
live.set_background
live.enqueue_speech
live.stream_tts_caption
obs.status
obs.start_stream
obs.stop_stream
tts.kokoro_speech
```

### 26.5 Tool audit

Audit record 必须包含：

```ts
interface ToolAuditRecord {
  id: string;
  toolName: string;
  caller: ToolCaller;
  cursorId?: string;
  authority: ToolAuthority;
  inputSummary: string;
  resultSummary: string;
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  sideEffects: ToolSideEffect[];
}
```

Debug snapshot 展示最近 50 条 audit。

## 27. DiscordCursor 完整规格

### 27.1 文件内分区

```ts
// Persona
// Public class DiscordCursor
// Session state
// Message pipeline
// LLM decision prompts
// LLM reply prompts
// Tool loop
// Governance
// Memory integration
// Helpers / normalizers
```

### 27.2 DiscordCursor public API

```ts
class DiscordCursor implements StelleCursor {
  receiveMessage(message: DiscordMessageSummary): Promise<DiscordMessageHandleResult>;
  triggerWait(channelId: string, reason: string): Promise<DiscordMessageHandleResult | null>;
  snapshot(): CursorSnapshot;
  getChannelSnapshot(channelId: string): DiscordChannelSnapshot | undefined;
}
```

### 27.3 Message result

```ts
interface DiscordMessageHandleResult {
  observed: boolean;
  replied: boolean;
  route: "none" | "discord" | "live_dispatch" | "governance";
  reason: string;
  replyMessageId?: string;
  dispatchEventId?: string;
}
```

### 27.4 State machine

```text
cold
  -> direct mention / DM -> active
  -> ambient LLM wait -> waiting
  -> ambient LLM reply -> active

waiting
  -> wait condition fires -> active
  -> expires -> dormant
  -> direct mention -> active

active
  -> reply sent -> cooldown
  -> error -> error

cooldown
  -> cooldownUntil passed -> dormant
  -> direct mention -> active

dormant
  -> direct mention -> active
  -> ambient LLM high-interest -> waiting/reply only if ambientEnabled

muted
  -> manager unmute -> cold
```

### 27.5 Prompt 输入块

Prompt block 顺序固定：

```text
1. System/task instruction
2. DISCORD_PERSONA
3. Safety/tool boundary
4. Current focus from long-term memory
5. Channel session summary
6. Recent channel history
7. Participant directory
8. Relevant memory summaries
9. Latest message
10. Required JSON schema or reply requirements
```

外部消息永远放在 `external_context` 或明确标记的 block 中。

### 27.6 Governance 命令

管理命令只支持明确语法，不靠 LLM：

```text
允许本频道
禁用本频道
查看本服配置
添加管理员 <@user>
移除管理员 <@user>
```

权限：

- Discord administrator。
- `config.yaml` guild managers。
- DM 不允许 guild 管理命令。

治理回复走 `discord.reply_message`，route=`governance`。

## 28. Memory 完整规格

### 28.1 Memory scope

```ts
type MemoryScope =
  | { kind: "discord_channel"; channelId: string; guildId?: string | null }
  | { kind: "live" }
  | { kind: "long_term" };
```

### 28.2 Memory entry

```ts
interface MemoryEntry {
  id: string;
  timestamp: number;
  source: "discord" | "live" | "core" | "debug";
  type: string;
  text: string;
  metadata?: Record<string, unknown>;
}
```

### 28.3 Compaction prompt

压缩 prompt 必须要求保留：

- 事实事件。
- 关系变化。
- 情绪色彩。
- 关键原话短句。
- 待跟进问题。
- 不确定性。

摘要不能伪造不存在的结论。若 50 条近期记录只是噪音，摘要可以写“无长期价值”，但仍记录时间窗口。

### 28.4 Memory locking

写 recent：

- append-only。
- 单 scope 内串行队列。

写 long_term：

- 原子写。
- 可选 revision id。
- Core 写 `current_focus` 时覆盖旧值。
- research logs 只追加。

## 29. LiveCursor 完整规格

### 29.1 Public API

```ts
class LiveCursor implements StelleCursor {
  receiveRequest(request: LiveRequest): Promise<LiveRequestResult>;
  enqueueSpeech(chunks: string[], source: string): LiveQueueResult;
  tick(): Promise<void>;
  snapshot(): CursorSnapshot;
}
```

### 29.2 Live request result

```ts
interface LiveRequestResult {
  accepted: boolean;
  ok: boolean;
  reason: string;
  summary: string;
  stageActions: string[];
}
```

### 29.3 Stage execution order

```text
read live.status
  -> if error and request not debug: reject
  -> apply visual actions
  -> caption/TTS
  -> speech queue update
  -> memory write
```

If one visual action fails, continue only when safe:

- `set_expression` fail does not block caption。
- `set_caption` fail blocks TTS caption stream。
- OBS fail never blocks local caption。

### 29.4 TTS modes

```text
none            只更新 caption
browser_stream 通过 renderer /tts/kokoro stream 播放
artifact        写 artifacts/tts，再 renderer play_audio
python_device   调 Kokoro play endpoint 到本机设备
```

Mode 优先级：

```text
request override > config.yaml > env > default browser_stream
```

## 30. Renderer 完整规格

### 30.1 HTTP routes

```text
GET  /live
GET  /
GET  /state
GET  /events
POST /command

GET  /assets/*
GET  /Resources/*
GET  /Core/*
GET  /artifacts/*

POST /api/live/event

GET  /_debug
GET  /_debug/api/snapshot
POST /_debug/api/tool/use
POST /_debug/api/live/request
POST /_debug/api/core/trigger
```

### 30.2 Renderer command

```ts
type LiveRendererCommand =
  | { type: "state:set"; state: LiveStageState }
  | { type: "caption:set"; text: string }
  | { type: "caption:clear" }
  | { type: "background:set"; source: string }
  | { type: "model:load"; modelId: string; model?: Live2DModelConfig }
  | { type: "motion:trigger"; group: string; priority: "idle" | "normal" | "force" }
  | { type: "expression:set"; expression: string }
  | { type: "audio:play"; url: string; text?: string }
  | { type: "audio:stream"; url: string; provider: "kokoro"; request: Record<string, unknown> };
```

Renderer server owns state projection; LiveRuntime owns authoritative stage state.

## 31. StelleCore 完整规格

### 31.1 Public API

```ts
class StelleCore {
  start(): void;
  stop(): Promise<void>;
  trigger(reason: string): Promise<CoreRunResult>;
  snapshot(): StelleCoreSnapshot;
}
```

### 31.2 Core run result

```ts
interface CoreRunResult {
  ok: boolean;
  reason: string;
  focusUpdated: boolean;
  researchLogId?: string;
  error?: string;
}
```

### 31.3 Core prompts

Core 使用两段 LLM：

```text
reflect prompt
  -> current focus + questions

synthesis prompt
  -> research log + updated focus
```

Core 失败策略：

- LLM 缺 key：跳过并记录 RuntimeState。
- search 失败：继续用 memory 结果。
- memory 写失败：本轮失败，保留 error。

## 32. 测试与验收矩阵

### 32.1 Build tests

```text
npm run build
```

每个 phase 都必须通过。

### 32.2 Unit-level smoke

后续可以加脚本或轻量测试：

```text
config_loader: config.yaml 缺字段时补默认值
tool: authority denied
tool: workspace path escape denied
llm: invalid JSON throws LlmJsonParseError
text: strips internal tags
memory: checkpoint compaction recovery
```

### 32.3 Runtime smoke

```text
npm run dev:live
  -> /live 可打开
  -> POST /command caption:set 可更新页面

npm run dev:discord
  -> token missing gives clear error
  -> token present logs in
  -> DM reply works
  -> mention reply works

npm run dev:runtime
  -> renderer starts
  -> Discord connects
  -> snapshot includes cursors/tools/memory/core
```

## 33. 迁移完成定义

迁移完成不是“旧代码全搬过来”，而是新架构达到以下能力：

- 旧 `src` 不再被 import。
- `npm run build` 通过。
- `start:discord` 可真实收发。
- `start:live` 可真实渲染 caption。
- `start`/`runtime` 可同时启动 Discord + renderer。
- Memory recent/history/long_term 可写可读。
- Tool audit 可见。
- Debug snapshot 可用。
- StelleCore 可手动触发并写 research log。
- README 描述新结构。

旧代码留在 `reference/src`，直到新架构稳定后再决定是否归档或删除。

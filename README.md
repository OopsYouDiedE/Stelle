# Stelle

Stelle 当前不是一个“已经完整自主行动的 AI”，而是一个正在从 `Discord Bot + LLM` 演化为“带有多个 Cursor 的环境式 Agent 系统”的代码库。

这份文档的目标不是介绍功能，而是梳理当前代码逻辑，判断它距离下列目标还有多远：

- 可以自主行动
- 具有自己的记忆
- 能做决策
- 能根据与人、以及其他环境交互得到的经验，决定空闲时行为

同时，这里会假设系统中的信息流，并根据当前代码判断这些信息流是否符合预期；如果不符合，会给出重构计划。

---

## 一、当前系统的真实定位

截至目前，Stelle 的代码结构已经出现了三个清晰层次：

1. Agent 层
- 位于 `src/agent/*`
- 负责 LLM 推理、工具调用循环、工具状态回传

2. Cursor 层
- 位于 `src/cursors/*`
- 目前已有：
  - `discord`
  - `browser`
  - `audio`
- 其中 `audio` 目前还是协议骨架，尚未接入真实语音引擎

3. 宿主与装配层
- 主要仍在 `src/index.ts`
- 负责启动 Discord、读取配置、记忆文件、注入依赖、挂接 Cursor

因此，项目目前的实际状态可以概括为：

> 它已经不再只是一个普通 Discord 机器人，但也还不是一个真正拥有主循环、自主调度多个环境 Cursor 的 Stelle。

更准确地说，它现在是：

> 一个已经拥有 Tool Loop、Browser Cursor、Discord Cursor 雏形、记忆系统与调试通道的过渡态系统。

---

## 二、当前代码结构梳理

### 1. `src/agent`

这一层是“思维循环”和“工具调用内核”。

- `src/agent/runner.ts`
  - `runAgentLoop(...)`
  - 负责：
    - 组装 messages
    - 把工具 schema 提供给模型
    - 执行 `tool_calls`
    - 将工具结果作为 `tool` 消息回填
    - 循环直到得到最终输出
  - 同时会发出状态：
    - `start`
    - `round`
    - `tool_start`
    - `tool_end`
    - `done`
    - `error`

- `src/agent/registry.ts`
  - 工具注册与执行中心

- `src/agent/prompt.ts`
  - Agent 用的系统提示词

- `src/agent/types.ts`
  - Agent 运行相关类型

当前判断：

- 这一层已经具备“调用工具完成任务”的能力
- 但还不具备“长期持续目标管理”能力
- 它更像一个强一点的任务型推理循环，而不是主循环

### 2. `src/tools`

这一层是“给 Agent 调用的离散工具集合”。

当前已有：

- `basic`
  - 时间、计算器
- `fs`
  - 读文件、写文件、列目录、搜索
- `system`
  - 命令执行
- `memory`
  - todo
- `meta`
  - 展示工具列表
- `browser`
  - 浏览器工具入口

需要注意的一点：

> `src/tools/browser/*` 已经不再是浏览器逻辑的真正中心。

现在浏览器工具只是：

> Agent 调 Browser Cursor 的工具入口适配层

也就是说：

```text
Agent
-> browser_* tool
-> BrowserCursor.run(...)
-> Playwright runtime
```

### 3. `src/cursors`

这是整个项目最重要的新方向。

#### `src/cursors/base.ts`

只保留了非常薄的一层共用抽象：

- `CursorActivation`
- `CursorReport`
- `CursorHost`

这是合理的，因为不同 Cursor 的时间尺度、信息密度、等待方式差异很大，不应强行统一。

#### `src/cursors/browser`

这是目前最成熟的 Cursor。

主要文件：

- `types.ts`
- `runtime.ts`
- `BrowserCursor.ts`
- `instance.ts`

它已经具备：

- 局部上下文
- 动作执行
- 页面观察
- 等待策略
- 预期检查
- 事件与报告
- `run()` 与 `tick()` 的分离

Browser Cursor 当前是真正意义上的“环境 Cursor”，而不只是工具集。

#### `src/cursors/discord`

主要文件：

- `types.ts`
- `runtime.ts`
- `DiscordCursor.ts`

当前结构可以分成两层：

1. `EventDrivenDiscordCursor`
- 负责事件队列
- 负责接收 `message_create`、`typing_start`
- 维护简化的 Cursor 级 snapshot

2. `DiscordChannelSession`
- 负责真正的频道局部上下文
- 负责：
  - `parseMsg`
  - `callAi`
  - `executeReply`
  - `maybeTriggerReview`
  - `snapshot`
  - `muteFor`
  - `resetRuntimeState`

也就是说，Discord Cursor 当前更准确的结构是：

```text
Discord Event Cursor
-> Channel Session Runtime
```

这说明 Discord 已经“开始成为 Cursor”，但还没有完全脱离原来 `index.ts` 的宿主结构。

#### `src/cursors/audio`

主要文件：

- `types.ts`
- `SpeechCursor.ts`

这一层目前只是语音环境的协议骨架：

- 支持转写请求排队
- 支持合成请求排队
- 支持 `tick()`
- 支持 `snapshot()`
- 依赖抽象的 `SpeechEngine`

当前判断：

- 它还不是可用的语音 Cursor
- 它现在是“接口设计已成型，真实运行未接入”的阶段

### 4. `src/index.ts`

这仍然是当前项目最大的宿主文件。

它负责：

- Discord client 启动
- 配置文件读写
- 用户索引
- 记忆文件管理
- Slash Command
- 调试频道状态输出
- 将 Discord 事件转给 `discordCursor`
- 将 LLM、工具、MemoryManager 等依赖注入到 `DiscordChannelSession`

所以它现在的真实地位不是“AI 本体”，而是：

> 当前 Stelle 系统的装配器和 Discord 宿主层

---

## 三、记忆系统现在是什么状态

当前代码里确实已经有“记忆”。

主要在：

- `memories/channels/*`
- `memories/users/*`
- `src/index.ts` 中的 `MemoryManager`
- `src/cursors/discord/runtime.ts` 中的 `DiscordChannelSession.memoryManager`

目前记忆分为两类：

1. 频道记忆
- 历史事件
- 短期进程
- review / distill

2. 用户记忆
- 用户全局资料

当前记忆系统的特点：

- 它是存在的
- 它会被 review/distill
- 它会在 Discord 对话主链中被读取

但它还不是“Stelle 的统一经验记忆”。

更准确地说，它现在是：

> 以 Discord 对话为主的、文件型、偏摘要式记忆系统

它还缺少：

- 跨 Cursor 统一经验索引
- 明确的 episodic memory
- 明确的 world state / self state
- 空闲时可回看的待办与目标记忆

---

## 四、当前信息流假设

为了判断系统是否合理，先假设一套“Stelle 应有的信息流”。

### 预期中的理想信息流

理想状态下，系统的信息流应当是：

```text
环境输入
-> 对应 Cursor 接收激活
-> Cursor 更新局部上下文
-> Cursor 产出报告 / 状态变化
-> Main Loop 决定是否分配注意力或任务
-> Agent / Planner 决定动作
-> 工具或 Cursor 行为执行
-> 结果再次进入记忆与上下文
-> 空闲时根据目标、记忆、经验产生主动行为
```

这里至少应该有四类核心流：

1. 事件流
- 外部环境产生输入

2. 上下文流
- Cursor 内部维护局部状态

3. 决策流
- Main Loop / Agent 决定下一步做什么

4. 经验流
- 行为结果进入记忆，改变未来选择

---

## 五、按当前代码判断信息流是否符合预期

### 1. Discord 输入流

当前实际流动：

```text
Discord MessageCreate / TypingStart
-> src/index.ts
-> discordCursor.activate(...)
-> discordCursor.tick()
-> processDiscordMessage / processDiscordTypingStart
-> DiscordChannelSession
-> callAi / executeReply
```

判断：

- 这条流是基本合理的
- Discord 已经不再直接驱动所有 AI 逻辑
- 但 `processDiscordMessage(...)` 和 `discordRuntimeDeps` 仍然挂在 `index.ts`

所以结论是：

> 这条流符合“Cursor 化”的方向，但还没有完全收拢进 Discord Cursor 自己的模块边界。

### 2. Browser 输入与行动流

当前实际流动：

```text
用户请求 / Agent 决策
-> runAgentLoop(...)
-> browser_* tool
-> BrowserCursor.run(...)
-> BrowserRuntime / Playwright
-> 结果返回 Agent
```

判断：

- 作为“任务型浏览器环境”这一条流是合理的
- Browser 已经是当前最符合 Cursor 思想的部分

但仍有一个结构问题：

> `src/browser/session.ts` 仍然挂在 `src/browser`，而不是并入 `src/cursors/browser`

这意味着 Browser 的概念边界仍然分裂：

- 语义中心在 `src/cursors/browser`
- 旧 runtime 残留在 `src/browser`

所以结论是：

> 浏览器的信息流逻辑基本符合预期，但目录边界不符合预期。

### 3. 记忆流

当前实际流动：

```text
Discord 对话
-> history 累积
-> 达到阈值后 review
-> review 结果写入 memory markdown
-> main callAi 时重新读取 memory context
```

判断：

- 在 Discord 内部闭环里，这条流是成立的
- 但它几乎完全是 Discord 专用的

因此它不符合未来预期中的：

```text
多个 Cursor 共用经验记忆
```

所以结论是：

> 当前记忆流只满足“频道对话型 AI”的需求，不满足“环境式自主 AI”的需求。

### 4. 主动行为流

预期中应该存在：

```text
空闲
-> 根据目标 / 记忆 / 环境状态
-> 决定主动做什么
```

当前实际代码中：

- 没有真正的 Main Loop
- 没有全局目标管理器
- 没有统一调度器
- 没有 idle planner
- 没有“空闲时行为选择器”

所以结论非常明确：

> 当前系统几乎还没有真正的主动行为流。

这意味着距离“自主行动 AI”的差距仍然很大。

---

## 六、它距离目标还有多远

目标是：

> 可以自主行动，具有自己记忆，决策，根据和人，以及其他方式搜集互动的经验决定空闲时行为的 AI

按这个目标拆开看。

### 1. “可以自主行动”

当前状态：

- 已经可以在被请求时调用工具
- 已经可以完成多步浏览器任务
- 但还必须被消息或明确请求触发

判断：

- 只达到了“受触发后可执行”
- 没达到“自主行动”

### 2. “具有自己记忆”

当前状态：

- 有文件型记忆
- 有 review / distill
- 有用户记忆与频道记忆

判断：

- 已有基础
- 但还不是系统级统一记忆

### 3. “决策”

当前状态：

- `runAgentLoop(...)` 可以在任务内部做工具决策
- Discord judge 链可以做触发与等待决策

判断：

- 已有局部决策
- 没有全局决策

### 4. “根据经验决定空闲时行为”

当前状态：

- 基本不存在

判断：

- 这一项还没有真正开始

### 综合判断

如果粗略估计：

- 工具行动能力：中等偏上
- 局部记忆能力：中等
- 局部决策能力：中等
- 主循环：很弱
- 自主性：很弱
- 跨环境经验整合：很弱
- 空闲行为选择：几乎没有

所以当前 Stelle 更接近：

> 有工具、有记忆、有环境雏形的半体化 Agent

而不是：

> 已经具备持续自我运行能力的环境式 AI

---

## 七、当前最不符合预期的地方

### 1. 没有真正的 Main Loop

这是当前最大的缺口。

现在存在：

- Agent loop
- Discord Cursor
- Browser Cursor

但不存在：

- 统一调度它们的主循环

后果是：

- Cursor 之间没有真正的注意力分配
- 没有统一优先级
- 没有主动唤醒策略
- 没有空闲行为入口

### 2. 记忆仍然是 Discord 中心的

当前 MemoryManager 的真实使用场景几乎全在 Discord。

后果是：

- Browser 行为不能自然沉淀为统一经验
- Audio 未来接入后也无法自然复用
- “Stelle 的经验”被困在“频道记忆”里

### 3. `src/index.ts` 仍然过重

虽然 Discord 已经 Cursor 化了一部分，但 `index.ts` 仍然承担：

- 配置
- 记忆
- Discord runtime 注入
- Slash command
- 状态上报
- 各类工具桥接

后果是：

- Discord 仍然像宿主
- Stelle 还不像真正的中心

### 4. Browser 目录边界不干净

如果 Browser 已经是 Cursor，就不应该再在 `src/` 根下留一个平级 `browser/` 目录作为旧实现中心。

这会导致：

- 语义重心分裂
- 后续维护容易继续“半工具、半 Cursor”

### 5. Audio Cursor 只有协议，没有环境落地

当前 audio 只是骨架，不是有效环境。

---

## 八、重构计划

下面是一个按优先级排序的重构计划。

### 第一阶段：把“Cursor 化”收干净

目标：

- 让现有 Browser / Discord Cursor 真正边界清晰

任务：

1. 把 `src/browser/session.ts` 移入 `src/cursors/browser/session.ts`
2. 清理 Browser 相关 import，让 Browser 运行时完全归 `src/cursors/browser/*`
3. 删除 `src/browser` 这个旧平级目录
4. 把 Discord 事件处理和更多运行逻辑从 `src/index.ts` 继续迁入 `src/cursors/discord/*`
5. 最终让 `index.ts` 只做装配和平台启动

这是最先该做的，因为这一步会决定项目后面是否还能继续长成一个真正的系统。

### 第二阶段：建立 Main Loop

目标：

- 让 Stelle 不再只是“被动响应”

需要新增：

- `src/core/mainLoop.ts`
- `src/core/attention.ts`
- `src/core/planner.ts`

Main Loop 的最低职责应当是：

- 注册 Cursor
- 接收 Cursor report
- 决定谁被激活
- 决定什么时候分配任务
- 决定系统空闲时是否进行主动行为

没有这一层，就谈不上真正的自主性。

### 第三阶段：建立统一记忆层

目标：

- 让记忆不再是 Discord 专属

需要把当前记忆拆分成至少三层：

1. 环境局部记忆
- 例如 Discord channel session memory
- Browser 当前任务上下文

2. 系统经验记忆
- 用户偏好
- 经常成功的策略
- 失败经验
- 跨环境事件

3. 自我状态记忆
- 当前目标
- 最近任务
- 长期待办
- 空闲时可做事项

建议未来增加类似：

- `src/memory/episodic.ts`
- `src/memory/semantic.ts`
- `src/memory/selfState.ts`

### 第四阶段：建立 Idle Policy

目标：

- 让 Stelle 在没有外部消息时，也能根据经验与目标做事

需要新增：

- idle 触发器
- 空闲优先级规则
- 空闲任务池
- 安全边界

例如：

- 空闲时整理记忆
- 回顾 Browser 未完成任务
- 根据语音/直播状态决定是否观察新环境
- 对 pending todo 做规划

### 第五阶段：让 Audio 成为真正环境 Cursor

目标：

- 把语音从“协议骨架”变成“真实环境”

需要补：

- 真实 STT 引擎接入
- 真实 TTS 引擎接入
- 音频输入缓冲与分段
- 播放状态追踪
- 与 Discord / Stream 的桥接

---

## 九、一个更接近目标的最终结构

如果沿当前方向继续，我认为更合理的未来结构会接近这样：

```text
src
├─ core
│  ├─ mainLoop.ts
│  ├─ planner.ts
│  ├─ attention.ts
│  └─ stelle.ts
├─ memory
│  ├─ episodic.ts
│  ├─ semantic.ts
│  └─ selfState.ts
├─ cursors
│  ├─ base.ts
│  ├─ discord
│  ├─ browser
│  └─ audio
├─ agent
├─ tools
└─ index.ts
```

其中：

- `core` 是 Stelle 的主体
- `cursors` 是环境驻留单元
- `agent` 是任务级推理循环
- `tools` 是离散可调用能力
- `index.ts` 只是装配器

---

## 十、结论

当前代码已经踏出了非常关键的一步：

- Browser 不再只是工具，而开始成为 Cursor
- Discord 不再只是宿主，而开始成为 Cursor
- Audio 也开始以 Cursor 形式被定义
- Agent loop 已经能做工具型推理
- 记忆系统已经存在

但离目标中的：

> 自主行动、具有统一记忆、根据经验决定空闲时行为

还有一段明显距离。

目前最大的瓶颈不是模型能力，也不是工具数量，而是：

1. 缺少真正的 Main Loop
2. 缺少统一经验记忆
3. `index.ts` 仍然过重
4. 部分模块边界仍是过渡态

所以现在最重要的不是继续堆工具，而是：

> 把系统从“能做事的 Bot”继续推成“有主循环的 Stelle”。

如果后续继续开发，最优先的顺序应该是：

1. 清理 Browser / Discord 的边界
2. 建立 Main Loop
3. 把记忆升级成跨 Cursor 的经验系统
4. 再做 idle policy 与真正的自主行为

---

## 十一、最新进展

在这轮重构之后，当前代码状态相较于上文已有两个重要变化：

1. Discord 已基本完成 Cursor 化
- `src/cursors/discord/controller.ts` 已成为 Discord 的运行控制器
- 消息处理、typing 状态、等待条件触发、session 管理、手动记忆操作、历史导入都已经移入 `src/cursors/discord/*`
- `src/index.ts` 现在主要只负责：
  - Discord client 启动
  - 依赖装配
  - slash command 注册
  - 事件绑定到 `MainLoop`

2. Main Loop 已有最小 attention / idle 入口
- `src/core/mainLoop.ts` 现在支持：
  - `runAttentionCycle()`
  - `setIdleStrategy(...)`
  - 周期性 `tickAll()`
- `src/index.ts` 已经启动了周期 attention cycle
- 当前 idle strategy 还是空实现，但“主循环空闲入口”已经存在

这意味着系统已经从：

> 只有 Cursor 类存在

推进到了：

> Cursor 已被一个真实运行中的 Main Loop 周期驱动

离真正的自主行为仍有距离，但结构上已经进入下一阶段。

---

## 十二、阶段复盘与目标更新

这一节用于重新检查前文列出的问题，看哪些已经解决，哪些还没解决。

### 已解决或基本解决的问题

1. `Main Loop` 缺位
- 状态：部分解决
- 现在已有：
  - `src/core/mainLoop.ts`
  - `runAttentionCycle()`
  - `setIdleStrategy(...)`
  - 周期性 attention cycle
- 结论：
  - 系统已经不再是“完全没有主循环”
  - 但当前主循环还只是最小骨架，不具备成熟的注意力分配、优先级管理和目标驱动能力

2. Discord 没有真正成为 Cursor
- 状态：基本解决
- 现在已有：
  - `src/cursors/discord/controller.ts`
  - `src/cursors/discord/slash.ts`
  - `src/cursors/discord/runtime.ts`
  - `src/cursors/discord/DiscordCursor.ts`
- `src/index.ts` 已不再直接承载 Discord 的运行主链
- 结论：
  - Discord 现在已经可以视为一个真正成立的 Cursor
  - 仍然存在宿主装配代码，但那已经属于平台接线，而不是 Discord 行为本体

3. Browser 边界不干净
- 状态：已解决
- 现在浏览器 runtime / session 都已经在：
  - `src/cursors/browser/*`
- 旧的 `src/browser/session.ts` 已删除
- 结论：
  - Browser 的语义中心和运行中心已经统一

4. `index.ts` 过重，Discord 宿主性太强
- 状态：部分解决
- 已经移走：
  - Discord 消息处理主链
  - typing 状态管理
  - slash 命令处理主逻辑
- 仍保留在 `index.ts` 的主要是：
  - 平台启动
  - 配置与记忆装配
  - slash command 注册定义
  - 各类依赖注入
- 结论：
  - `index.ts` 比之前明显更像装配器了
  - 但它仍然偏大，离“纯宿主层”还有距离

### 尚未解决的问题

1. 统一经验记忆仍未建立
- 状态：未解决
- 当前仍然以 Discord 记忆为主
- Browser / Audio / 未来 Minecraft 的经验还没有进入统一记忆层
- 这仍是系统自主性的关键短板

2. Idle policy 还是空实现
- 状态：未解决
- 现在 Main Loop 的 idle strategy 已有接口，但默认是空数组
- 也就是说：
  - 系统会空闲醒来
  - 但醒来后还不会主动决定去做什么

3. Attention policy 不成熟
- 状态：未解决
- 目前 `runAttentionCycle()` 更像周期 tick
- 还没有真正的：
  - 注意力竞争
  - 优先级计算
  - 多 Cursor 协调
  - 中断与恢复策略

4. Audio Cursor 还只是协议骨架
- 状态：未解决
- 还没有接入真实 TTS/STT runtime
- 还没有变成真正参与系统运行的环境 Cursor

5. 统一的“自主目标系统”仍不存在
- 状态：未解决
- 现在还没有：
  - 长期目标
  - 当前目标
  - 空闲待办池
  - 自主行为触发规则

### 当前阶段重新判定

如果按 README 最初的目标来划分阶段，当前系统已经不应该再被描述为：

> 只有工具循环和 Cursor 雏形的过渡态系统

更准确的阶段描述应该更新为：

> 已完成 Cursor 基础建模、Discord / Browser 环境落地、最小 Main Loop 接线，但尚未形成统一记忆与自主行为策略的早期环境式 Agent 系统

### 建议的阶段划分更新

建议把项目开发阶段明确写成下面四段：

1. 第一阶段：Cursor 基础成型
- Browser Cursor 成立
- Discord Cursor 成立
- Main Loop 最小可运行
- 当前已基本完成

2. 第二阶段：系统调度成型
- 完成 attention policy
- 建立 idle policy
- 让多个 Cursor 真正受主循环调度
- 当前正在进入这一阶段

3. 第三阶段：统一经验与自我状态
- 建立跨 Cursor 记忆
- 建立目标 / 待办 / 自我状态层
- 让行为结果影响未来空闲决策
- 当前尚未开始

4. 第四阶段：新增环境 Cursor
- 接入 Minecraft Cursor
- 接入真实 Audio Cursor
- 让 Stelle 在多个环境中持续驻留
- 当前尚未开始，但 Minecraft Cursor 将是下一步重点

### 当前最优先目标

基于最新代码状态，当前最合理的目标阶段不再是“继续做 Discord Cursor 化”，因为这件事已经基本完成。

当前最优先目标应该更新为：

1. 为 Main Loop 设计真正的 attention policy
2. 为 Main Loop 设计第一个非空的 idle policy
3. 设计统一经验记忆层
4. 在这个基础上接入 Minecraft Cursor

一句话总结：

> Discord Cursor 化和 Browser 边界清理已经基本过关，项目的下一阶段重点应该从“模块迁移”切换到“主循环决策与跨环境经验系统”。 

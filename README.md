# Stelle

## 当前进度

当前代码已经不再是“以 Discord Bot 为主体、AI 为附属能力”的结构，而是正在转向“主循环 + 多 Cursor 环境”的系统。

目前已经完成的关键迁移有：

- `Agent` 工具循环已经独立到 `src/agent/*`
- `Browser` 已经从一组工具升级为 `Browser Cursor`
- `Discord` 的主运行逻辑已经迁入 `src/cursors/discord/*`
- `MainLoop` 已经存在，并开始承担 Cursor 注册、激活、`tick`、attention cycle 入口
- `Minecraft Cursor` 第一版已经接入

这意味着项目当前已经具备了“多个环境挂在同一系统下运行”的基本骨架，但还没有进入真正的自主行动阶段。

## 当前代码结构

```text
src
├─ agent
│  ├─ prompt.ts
│  ├─ registry.ts
│  ├─ runner.ts
│  └─ types.ts
├─ core
│  ├─ mainLoop.ts
│  └─ runtime.ts
├─ cursors
│  ├─ audio
│  │  ├─ index.ts
│  │  ├─ SpeechCursor.ts
│  │  └─ types.ts
│  ├─ browser
│  │  ├─ BrowserCursor.ts
│  │  ├─ index.ts
│  │  ├─ instance.ts
│  │  ├─ runtime.ts
│  │  ├─ session.ts
│  │  └─ types.ts
│  ├─ discord
│  │  ├─ app.ts
│  │  ├─ controller.ts
│  │  ├─ DiscordCursor.ts
│  │  ├─ index.ts
│  │  ├─ runtime.ts
│  │  ├─ slash.ts
│  │  └─ types.ts
│  ├─ minecraft
│  │  ├─ index.ts
│  │  ├─ instance.ts
│  │  ├─ MinecraftCursor.ts
│  │  ├─ runtime.ts
│  │  └─ types.ts
│  └─ base.ts
├─ tools
│  ├─ basic
│  ├─ browser
│  ├─ fs
│  ├─ memory
│  ├─ meta
│  ├─ system
│  └─ index.ts
└─ index.ts
```

### 各层职责

#### `src/index.ts`

当前只承担系统入口角色：

- 启动 Discord 环境入口
- 不再承载具体 Discord 运行逻辑

现在它只是：

```ts
import "./cursors/discord/app.js";
```

#### `src/agent/*`

这部分是任务级工具调用循环。

职责包括：

- 组装 prompt
- 向模型发送 tools schema
- 执行模型返回的 `tool_calls`
- 将工具结果回填给模型
- 输出最终文本回复

它现在更像“短时思考引擎”，而不是整个系统的主循环。

#### `src/core/*`

这部分是系统级主循环基础设施。

当前已具备：

- Cursor 注册
- Cursor 激活
- Cursor `tick`
- `tickAll`
- `runAttentionCycle`
- `IdleStrategy` 入口
- 主循环报告汇总

但目前 `idle strategy` 还是空实现，所以主循环虽然存在，还没有形成真正的自主调度行为。

#### `src/cursors/browser/*`

这是浏览器环境 Cursor。

当前已经具备：

- 页面打开
- 页面读取
- 截图
- 点击
- 输入
- 后退
- 刷新
- `run(action + wait + expect)` 语义
- `snapshot()`
- 与 Playwright 会话绑定

浏览器不再只是工具集合，而是一个有上下文和运行状态的环境 Cursor。

#### `src/cursors/discord/*`

这是 Discord 环境 Cursor。

当前职责包括：

- Discord client 宿主启动在 `app.ts`
- 消息/输入事件转入 Cursor
- 频道级 session 管理
- typing 状态维护
- 等待条件判断
- slash command 处理
- 调用 Agent 回复
- 对接记忆回顾 / distill

这里最重要的变化是：

- Discord 逻辑已经不再留在 `src/index.ts`
- Discord 已经被视为一个 Cursor 环境

不过 `app.ts` 仍然是一个偏大的宿主装配文件，后面还可以继续拆成：

- bootstrap
- dependency wiring
- event binding

#### `src/cursors/audio/*`

这里目前还是 TTS / STT Cursor 的协议骨架，不是完整运行时。

已具备：

- `speech` Cursor 接口
- 输入转写 / 输出合成的队列语义
- `tick()`
- `snapshot()`

但还没有接入真实语音服务。

#### `src/cursors/minecraft/*`

这是 Minecraft 环境 Cursor 的第一版。

当前支持：

- 连接 Minecraft 服务器
- 获取当前状态快照
- 发送聊天
- 寻路到坐标
- 跟随玩家
- 停止当前移动目标

当前这部分还属于“可连接、可执行基础动作”的阶段，距离真正“自主玩 Minecraft”还差很远。

#### `src/tools/*`

这里是 Agent 可以直接调用的工具层。

注意现在浏览器工具已经不是自己直接操作 Playwright 了，而是转发到 `BrowserCursor.run(...)`。  
也就是说，工具层开始成为“Agent 与 Cursor 的适配层”。

## 当前功能状态

### 已经可用的部分

- Discord 中的消息驱动 AI 回复
- Agent 工具调用循环
- 文件、搜索、命令、时间、计算等基础工具
- Browser Cursor 基础网页操作
- Minecraft Cursor 基础连接与动作
- 主循环注册多个 Cursor

### 已经形成但还不完整的部分

- `MainLoop`
- Browser Cursor 的等待/预期语义
- Discord Cursor 的频道局部上下文
- Audio Cursor 协议骨架

### 还没有完成的部分

- 统一经验记忆层
- 真正非空的 `idle strategy`
- attention policy
- Cursor 之间的协同协议
- Minecraft 的观察、采集、战斗、背包、规划能力
- Speech Cursor 的真实语音运行时

## 当前信息流

### 1. Discord 信息流

```text
Discord Event
-> src/cursors/discord/app.ts
-> stelleMainLoop.activateCursor(...)
-> Discord Cursor tick
-> DiscordChannelSession
-> Agent Loop / Memory / Tools
-> 回复到 Discord
```

这条链路已经基本符合“Discord 只是环境 Cursor”的方向。

### 2. Browser 信息流

```text
Agent
-> browser_* tool
-> BrowserCursor.run(...)
-> Playwright runtime/session
-> Browser observation / screenshot / action result
```

Browser 当前已经不再是根层模块，而是 Cursor 体系的一部分。

### 3. Minecraft 信息流

```text
MainLoop / future Agent task
-> MinecraftCursor
-> Mineflayer runtime
-> movement / chat / follow / snapshot
```

Minecraft 目前已经进入系统，但还没有形成完整 Agent 调用接口和任务语义。

## 当前距离目标还有多远

目标不是“一个看起来像人的聊天 AI”，而是：

- 可以自主行动
- 具有自己的记忆
- 会根据经验和互动调整行为
- 会在空闲时自己决定做什么
- 能在多个环境中持续存在

和这个目标相比，当前系统还处于“骨架完成，行为中枢未完成”的阶段。

### 已经接近目标的地方

- Cursor 体系已经立起来了
- Discord 已经从主体变成环境
- Browser 已经是有状态环境
- Minecraft 已经开始接入
- Agent 与工具循环已经可运行

### 离目标还远的地方

- 还没有统一的长期经验记忆
- 还没有真正的自主 attention / idle 决策
- 主循环还没有形成稳定的“我现在该关注谁、空闲时该做什么”的内部策略
- Cursor 之间还是并列挂载，尚未形成系统级协同

## 当前阶段判断

当前可以认为项目已经完成：

- 第一阶段：Cursor 基础成型

当前正在进入：

- 第二阶段：系统调度成型

第二阶段的核心目标应该是：

1. 让 `MainLoop` 拥有真正的 attention policy
2. 让 `idle strategy` 不是空实现
3. 让不同 Cursor 的重要经验进入统一记忆层
4. 让 Minecraft Cursor 成为下一个真正可行动的环境 Cursor

## 接下来建议

如果继续按当前方向推进，优先级建议如下：

1. 为 `MainLoop` 设计最小 attention policy
2. 给 Minecraft Cursor 增加观察协议与 Agent 工具入口
3. 设计统一经验记忆层
4. 为 Audio Cursor 接入真实 TTS/STT 运行时

到这一步之后，Stelle 才会逐渐从“带多个环境接口的系统”走向“会自己在多个环境中生活的系统”。

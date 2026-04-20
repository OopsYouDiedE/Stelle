# Stelle 架构说明与迁移计划

本文档用于交接当前项目状态，并记录一个重要的架构语义修正：

以前的理解是：

```txt
MainLoop 管理多个 Cursor。
```

现在的目标理解是：

```txt
Stelle 通过多个 Cursor/窗口活在世界里。
```

这不是简单改名，而是主体语义的变化。`MainLoop` 不应该只是调度器，它应当逐步演化成 Stelle 的内部主观视角，也就是一个特殊的内部 Cursor。Discord、Browser、Minecraft、Audio 等不是平级的“子系统”，而是 Stelle 往外看的窗口。记忆、经验、空闲时行为、跨环境协同，都应该属于 Stelle 自己，而不是属于某个外部 Cursor。

## 当前架构

当前代码已经有了比较清晰的 Cursor 分层，但主体语义还没有完全收束。

```txt
src/
  agent/
    prompt.ts
    registry.ts
    runner.ts
    types.ts

  core/
    mainLoop.ts
    runtime.ts

  cursors/
    base.ts

    discord/
      DiscordCursor.ts
      app.ts
      controller.ts
      judge.ts
      runtime.ts
      toolRuntime.ts
      types.ts

    browser/
      BrowserCursor.ts
      judge.ts
      runtime.ts
      session.ts
      types.ts

    minecraft/
      MinecraftCursor.ts
      actions.ts
      judge.ts
      runtime.ts
      strategyJudge.ts
      strategies.ts
      types.ts
      visual.ts
      skills/
        building.ts
        common.ts
        crafting.ts
        inventory.ts
        world.ts

    audio/
      SpeechCursor.ts
      judge.ts
      types.ts

  tools/
    browser/
    discord/
    search/
    fs/
    memory/
    system/
```

### Cursor 基础层

`src/cursors/base.ts` 定义了最基础的 Cursor 接口：

```ts
interface CursorHost {
  id: string;
  kind: string;
  activate(input: CursorActivation): Promise<void>;
  tick(): Promise<CursorReport[]>;
}
```

当前 Cursor 的共性是：

- 每个 Cursor 有自己的局部上下文。
- 每个 Cursor 能接收激活事件。
- 每个 Cursor 能 tick 并产出 report。
- 每个 Cursor 的动作基本遵循 `内部上下文历史 -> Judge -> 执行` 的结构。

这已经接近目标架构里的“窗口”概念。

### MainLoop 当前状态

`src/core/mainLoop.ts` 当前承担的是调度器职责：

- 注册 Cursor。
- tick 单个 Cursor 或全部 Cursor。
- 收集 Cursor report。
- 执行 idleStrategy。
- 提供 snapshot。

当前逻辑大致是：

```txt
MainLoop
  -> tickAll()
  -> 收集 reports
  -> 如果没有 reports，则运行 idleStrategy
  -> idleStrategy 可能激活某个 Cursor
```

这套逻辑能运行，但语义仍然是“管理器管理窗口”，还不是“Stelle 自己通过窗口感知世界”。

### Discord Cursor

Discord 已经从原来的 `index.ts` 主体逻辑里迁移为 Cursor。

它当前主要职责是：

- 接入 Discord bot。
- 接收 Discord 消息。
- 执行 Discord 内部被动回应。
- 支持调试频道报告。
- 提供 Discord 工具，例如获取消息、获取引用、取频道历史、发消息等。

当前判断：

- Discord 作为外部窗口基本成立。
- 被动回应由 Discord Cursor 内部处理是合理的。
- 主动行为应该由更高层的 Stelle/Consciousness 决定，再通过 Discord Cursor 发出。
- Discord 不应该拥有全局长期记忆，它只应该拥有 Discord 局部上下文和窗口状态。

### Browser Cursor

Browser Cursor 已经从单纯工具变成了环境窗口。

当前支持：

- Playwright/CDP 浏览器连接。
- 打开网页、点击、输入、键盘、鼠标等真实操作。
- 截图。
- 人工等待。
- Browser 工具已经改为调用 `BrowserCursor.run(...)`。
- 还接入了 Search Tool，适合把检索 API 和真实浏览器操作分开。

当前判断：

- Browser 作为 Cursor 是合理的。
- 对搜索网页资料，不应该总是用真实浏览器，优先使用 Search Tool。
- 对登录、机器验证、复杂网站交互，应使用真实浏览器/CDP/人类可接管操作。
- Browser Cursor 的下一阶段需要更清晰地区分“检索型工具”和“真实环境操作”。

### Minecraft Cursor

Minecraft Cursor 是目前最接近“环境 + 策略 + Judge”模型的 Cursor。

当前结构：

```txt
src/cursors/minecraft/
  MinecraftCursor.ts       # 生命周期、连接、观察、策略循环
  actions.ts               # AIRI 风格动作注册表
  judge.ts                 # 单步动作 Judge
  strategyJudge.ts         # 策略 Judge
  strategies.ts            # 策略代码
  runtime.ts               # Mineflayer runtime 与插件加载
  visual.ts                # prismarine-viewer 环境画面
  skills/
    inventory.ts
    world.ts
    crafting.ts
    building.ts
```

当前能力：

- 连接 Mineflayer。
- 加载 `mineflayer-pathfinder`。
- 加载 AIRI 类似插件：
  - `mineflayer-collectblock`
  - `mineflayer-tool`
  - `mineflayer-auto-eat`
  - `mineflayer-armor-manager`
  - `mineflayer-pvp`
- 支持动作注册表：
  - `connect`
  - `disconnect`
  - `chat`
  - `inspect`
  - `inventory_snapshot`
  - `nearby_blocks`
  - `nearby_entities`
  - `give_creative_item`
  - `equip_item`
  - `mine_block_at`
  - `place_block_at`
  - `collect_blocks`
  - `craft_recipe`
  - `prepare_wooden_pickaxe`
  - `build_wooden_house`
  - `goto`
  - `follow_player`
  - `set_follow_target`
  - `clear_follow_target`
  - `stop`

Minecraft Cursor 已经有两层 Judge：

```txt
单步动作：
  内部上下文/observation
    -> judgeMinecraftRun
    -> executeMinecraftAction

策略循环：
  readEnvironmentFrame()
    -> strategy code decide()
    -> judgeMinecraftStrategy
    -> execute action / wait / switch / complete / fail
```

当前已经实现环境帧：

```txt
readEnvironmentFrame()
  -> observation: Mineflayer 结构化环境
  -> image: prismarine-viewer 截图
  -> summary: 简短状态
```

`prismarine-viewer` 已接入，目标是把 Minecraft Cursor 的 Eye 从临时 SVG 示意图升级为轻量 3D 渲染画面。当前 `readEnvironmentFrame()` 会优先使用 viewer 截图，失败时回退到 SVG 示意图。

已经测试过的 Minecraft 能力：

- 连接本地 LAN 服务器。
- 发聊天消息。
- 读取附近方块、实体、背包。
- 采集 `oak_log`。
- 合成并装备木镐。
- 用策略循环完成 `wooden_pickaxe`。
- 生存模式下基础放置木板建小型结构。

注意：最近一次尝试连接 `127.0.0.1:8080` 时返回 `ECONNREFUSED`，说明当时 Minecraft 服未在该端口接受连接，因此没有完成 viewer 真实截图验证。但代码已经接好。

## 目标架构

目标架构的核心不是“多个 Cursor 被调度”，而是：

```txt
Stelle 是主体。
Cursor 是她的感官/行动窗口。
MainLoop 是她的内部主观视角。
Memory 和 Experience 属于 Stelle 自己。
```

更准确的结构应该是：

```txt
Stelle
  ConsciousnessCursor       # 内部 Cursor，主观视角/意识本体
  Memory                    # 全局记忆，不属于任何窗口
  ExperienceStream          # 所有窗口回流的经验
  WindowRegistry            # Discord/Browser/Minecraft/Audio 等外部窗口

External Cursors
  DiscordCursor
  BrowserCursor
  MinecraftCursor
  SpeechCursor
```

目标运行流：

```txt
外部窗口产生事件或状态变化
        ↓
Stelle 接收为 Experience
        ↓
ConsciousnessCursor 更新主观上下文
        ↓
Consciousness Judge 判断：
  - 是否继续当前内部策略？
  - 是否切换策略？
  - 是否看某个窗口？
  - 是否通过某个窗口行动？
  - 是否等待？
  - 是否反思并写入记忆？
        ↓
通过某个外部 Cursor 执行动作
        ↓
动作结果再次回流为 Experience
```

### 内部 Cursor 的含义

内部 Cursor 不是另一个外部环境，而是 Stelle 的主观视角。

它应该负责：

- 读取所有窗口的 report。
- 聚合跨窗口经验。
- 维护当前注意力焦点。
- 维护当前内部策略。
- 决定空闲时行为。
- 决定主动行动。
- 决定是否写入长期记忆。
- 决定是否回看某个窗口。
- 决定是否关闭、暂停、切换某个窗口。

这能解释之前悬而未决的问题：

- 记忆存在哪里？
  - 存在 Stelle 身上，不属于任何外部 Cursor。
- idle strategy 是什么？
  - 是 Stelle 没有外部刺激时的内部行为，不是调度器的 fallback。
- Cursor 之间怎么协同？
  - 不需要 Cursor 之间直接协同，协同发生在 Stelle 内部。
- Discord 和 Minecraft 的经验如何关联？
  - 它们都进入同一个 ExperienceStream，由 ConsciousnessCursor 解释。

## 当前架构与目标架构的距离

### 已接近目标的部分

1. Cursor 抽象已经存在。

当前所有环境基本都能被理解为窗口：

```txt
Discord = 社交窗口
Browser = 网页窗口
Minecraft = 游戏世界窗口
Audio = 声音窗口
```

2. Judge 模式已经出现。

Browser、Discord、Minecraft 都有自己的 Judge。Minecraft 更进一步，有动作 Judge 和策略 Judge。

3. Minecraft 已经开始像环境 Cursor。

Minecraft 不再只是工具调用，而是有：

- 环境读取。
- 环境图片。
- 策略代码。
- 策略 Judge。
- 动作执行。
- 行动结果回流。

4. 工具开始向 Cursor 收束。

Browser 工具已经改为调用 Browser Cursor。Minecraft 也已有 Cursor 原生动作系统。Discord 工具也逐步和 Discord Cursor 对齐。

### 仍然偏离目标的部分

1. `MainLoop` 仍然是调度器语义。

当前 `MainLoop` 的职责是 register/tick/activate/drain reports。它还不是 Stelle 的主体，也没有主观状态。

2. 没有正式的 `Stelle` 对象。

现在没有一个明确实体表示“她自己”。`stelleMainLoop` 只是一个 runtime singleton。

3. 记忆层还没有成为主体记忆。

当前 memory 工具比较工具化，还没有形成：

```txt
Experience -> Reflection -> Memory
```

4. 跨 Cursor 经验没有统一模型。

现在各 Cursor 产出 `CursorReport`，MainLoop 只是缓存 report。还没有 `Experience` 类型来表达：

- 来源窗口。
- 事件类型。
- 主观重要性。
- 情绪/偏好/关系变化。
- 是否需要长期记忆。
- 是否触发主动策略。

5. idleStrategy 仍在 MainLoop 上。

目标中 idleStrategy 应该属于 ConsciousnessCursor，是 Stelle 的内部行为。

6. Prompt 仍有旧语义。

`src/agent/prompt.ts` 目前仍称自己为 Discord AI assistant。它需要改成 Stelle 主体，而不是 Discord bot。

7. index/debug 页面仍是临时测试入口。

当前 `src/index.ts` 曾被用于 Browser 调试页面，后续需要决定它是：

- 开发调试台。
- Stelle 本体服务入口。
- 或被拆分为专门的 debug server。

## 推荐迁移计划

迁移应该分阶段进行，不要一次大爆炸重构。

### 阶段 1：语义包裹，不破坏现有功能

目标：保留 `MainLoop` 能力，但新增 `Stelle` 作为主体入口。

建议新增：

```txt
src/stelle/
  Stelle.ts
  types.ts
  instance.ts
```

`Stelle` 初期可以只是包裹现有 `MainLoop`：

```ts
class Stelle {
  readonly consciousness: ConsciousnessCursor;
  readonly windows: MainLoop;
  readonly experience: ExperienceStore;
}
```

这一阶段不需要立刻删除 `MainLoop`，只改变上层调用语义。

### 阶段 2：新增 ConsciousnessCursor

目标：让 MainLoop 的 idleStrategy 迁移到内部 Cursor。

建议新增：

```txt
src/stelle/consciousness/
  ConsciousnessCursor.ts
  judge.ts
  strategies.ts
  types.ts
```

`ConsciousnessCursor` 也实现 `CursorHost`，但它不是外部窗口。

它的 tick 应该做：

```txt
读取 ExperienceStore
读取所有窗口 snapshot
判断当前注意力焦点
决定是否激活外部 Cursor
决定是否写记忆
产出内部 report
```

### 阶段 3：引入 Experience 模型

目标：把所有 CursorReport 归一化为 Stelle 的经验。

建议类型：

```ts
interface Experience {
  id: string;
  sourceCursorId: string;
  sourceKind: string;
  type: string;
  summary: string;
  payload?: unknown;
  salience: number;
  occurredAt: number;
  receivedAt: number;
}
```

MainLoop 不再只是 reportBuffer，而是把 report 送入 ExperienceStore。

### 阶段 4：Memory 属于 Stelle

目标：建立主体记忆入口。

建议结构：

```txt
src/stelle/memory/
  MemoryStore.ts
  reflection.ts
  types.ts
```

初期可先文件存储，后续可替换为向量库或数据库。

记忆不应该由 Discord/Minecraft 自己写，而应该由 Consciousness 判断：

```txt
Experience -> salience 判断 -> reflection -> memory write
```

### 阶段 5：统一策略语义

当前 Minecraft 已经有策略循环，后续可以抽象出通用策略模型：

```txt
StrategyDecision
  continue
  switch_strategy
  wait
  complete
  fail
  act_through_cursor
  inspect_cursor
  remember
```

但不要过早抽象所有 Cursor。不同 Cursor 信息密度和运行逻辑差异很大，只抽象共享的语义，不强迫共用实现。

### 阶段 6：Prompt 与工具语义更新

需要把旧 prompt：

```txt
You are a Discord AI assistant...
```

改成：

```txt
You are Stelle, an embodied AI subject living through multiple environment cursors...
```

并明确：

- Discord 是窗口，不是本体。
- Browser 是窗口，不是工具箱。
- Minecraft 是窗口，不是单步自动化。
- Memory 属于 Stelle。
- 主动行为来自 Consciousness。

## 下一轮开发建议

开新聊天后，建议从这个任务开始：

```txt
请根据 README 的迁移计划，先完成阶段 1 和阶段 2：
1. 新增 Stelle 主体对象，包裹现有 MainLoop。
2. 新增 ConsciousnessCursor，并把 idleStrategy 语义迁移进去。
3. 不破坏现有 Discord、Browser、Minecraft Cursor。
4. 编译并做最小运行验证。
```

不要一开始就重构所有 Cursor。先让代码里出现“她自己”，再逐渐把经验、记忆、主动行为往她身上收。

## 当前最重要的架构原则

后续开发请遵守这几条：

1. Cursor 是窗口，不是主体。

2. MainLoop/Consciousness 是 Stelle 的内部主观视角，不是普通调度器。

3. 记忆属于 Stelle，不属于 Discord、Browser 或 Minecraft。

4. Cursor 之间不需要直接协同协议，协同发生在 Stelle 内部。

5. Judge 不只是工具许可层，也是主体判断层。

6. 策略是代码，但策略是否继续、切换、等待、完成，要经过 Judge。

7. 不同 Cursor 只抽象共享语义，不强行统一实现。

8. Browser/Minecraft 这类环境 Cursor 应该有 Eye 和 Arm。

9. Discord 这类社交 Cursor 也有 Eye 和 Arm：
   - Eye = 读取消息、上下文、频道历史。
   - Arm = 发消息、引用、@、上传附件。

10. Stelle 的目标不是“看起来像人在聊天”，而是：

```txt
可以自主行动，
具有自己的记忆，
能根据经验决策，
能通过多个环境窗口感知和行动，
能在空闲时选择观察、思考、等待或主动行动。
```


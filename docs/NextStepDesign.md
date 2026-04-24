# Stelle 下一步设计方案

这份文档讨论的是 Stelle 在当前 `Core Mind + Cursor` 主体已经能跑通之后，下一阶段应该怎样继续演进。

目标不是把抽象做得更花，而是把项目继续往下面三个方向推实：

1. 保留真实能力，去掉伪能力
2. 让真实经历能够沉淀成长期素材
3. 让直播内容优先来自真实经历，而不是即时复读

## 1. 硬约束

### 1.1 Cursor 只负责现场

`Cursor` 是运行时现场，不是长期记忆容器。

- `Discord Cursor` 负责 Discord 频道与会话现场
- `Live Cursor` 负责直播舞台现场
- `Inner Cursor` 负责内部整理与反思现场
- 未来的 `Browser Cursor`、`Minecraft Cursor` 只有在真实 runtime 存在时才允许注册

`Cursor` 不直接负责：

- 长期记忆落盘
- 记忆筛选规则
- 跨场景人物事实写入
- 全局情绪状态主存

### 1.2 Tool 只暴露真实动作

Tool 必须是现实中可执行、可审计的动作，而不是人为拆出来的伪认知步骤。

适合做 Tool 的：

- 发送 Discord 消息
- 设置字幕
- 播放 TTS
- 读取网页
- 写入一条记忆记录
- 检索一批相关记忆

不适合做 Tool 的：

- “请先思考再决定”
- “请模拟人格反应”
- “请自动整理所有记忆并输出意识流”

### 1.3 长期记忆不属于任何 Cursor

长期记忆应该放在独立的 `memory/` 层，而不是挂在 `DiscordCursor`、`LiveCursor` 或 `InnerCursor` 身上。

推荐关系：

- `Cursor` 产出事件
- `InnerCursor` 参与反思与整理
- `memory/` 负责筛选、写入、检索

### 1.4 情绪层不能改事实和权限

情绪层只能影响表达方式：

- 语气
- 节奏
- 句长
- 主动表达欲

情绪层不能影响：

- 事实真假
- Tool 权限
- 是否越权行动
- 是否伪造经历

## 2. 未来代码分层

建议继续收敛到下面几层：

```text
src/
  core/
  cursors/
    inner/
    discord/
    live/
    browser/      # 只有真实附着时才注册
    minecraft/    # 只有真实 runtime 时才注册
  memory/
    events/
    profiles/
    relationships/
    retrieval/
    writers/
  content/
    live/
    discord/
  emotion/
    state/
    presentation/
  tools/
    discord/
    live/
    search/
    tts/
    memory/
```

职责边界：

- `core/`：调度、附着、权限边界
- `cursors/`：当前现场
- `memory/`：长期记忆与检索
- `content/`：把真实经历转成可说内容
- `emotion/`：只修饰表达
- `tools/`：真实可执行动作

## 3. 记忆系统设计

### 3.1 主存先用 Markdown

当前阶段先不引入 SQLite，也不把向量库当主存。

主存直接采用 `md` 文件，原因很简单：

- 可读
- 可手改
- 易审计
- 易调试
- 方便 `grep`

### 3.2 目录结构

仓库根目录下建立 `memory/`：

```text
memory/
  people/
  relationships/
  experiences/
  guilds/
  channels/
  summaries/
```

命名示例：

- `memory/people/123456789.md`
- `memory/relationships/guild-1__user-123.md`
- `memory/experiences/2026-04-24-live-audio-debug.md`
- `memory/guilds/123456789.md`
- `memory/channels/987654321.md`

### 3.3 文件格式

每条长期记忆使用轻量 frontmatter：

```md
---
id: person_123456789
type: person_profile
source: discord
updated_at: 2026-04-24T12:00:00+08:00
tags:
  - social
  - stable
---

这个人常在直播群互动，偏好被叫“小王”。
```

### 3.4 记忆分类

`people/` 存稳定人物信息：

- 称呼
- 别名
- 偏好
- 禁忌
- 稳定身份线索

不存：

- 瞬时情绪
- 一次性争执
- 草率负面标签

`relationships/` 存关系状态：

- 熟悉程度
- 最近互动变化
- 未完成承诺
- 共同经历摘要

`experiences/` 存真实发生过的事件：

- 调试事故
- 直播片段
- 任务完成/失败
- 社交互动节点

`summaries/` 存阶段性整理结果：

- 最近一周发生了什么
- 某个人最近的关系变化
- 当前直播可讲素材池

## 4. 记忆数据流

推荐固定为这条管线：

```text
Cursor 现场事件
-> MemoryEventBus
-> Triage / Filter
-> Inner Reflection Pipeline
-> Markdown Memory Writer
-> Retrieval
-> Prompt / Content Builder
```

分工如下：

- `MemoryEventBus`：统一接收各 Cursor 产出的事件
- `Triage / Filter`：决定哪些值得长期保留
- `Inner Reflection Pipeline`：把值得保留的事件整理成更稳定的材料
- `Markdown Memory Writer`：写入 `memory/*.md`
- `Retrieval`：按人、频道、tag、关键词召回

## 5. Inner Cursor 的职责

`InnerCursor` 不承载长期记忆本体，但要参与记忆加工。

它负责：

- 反思
- 总结
- 把短期现场整理成阶段材料
- 提炼未来可讲的直播素材

它不负责：

- 直接落盘人物档案
- 直接保存关系事实
- 直接成为长期记忆数据库

一句话：

`InnerCursor` 负责理解，不负责保存。

## 6. Browser 与 Minecraft 的原则

### 6.1 Browser

不再把“未登录通用浏览器自动化”当正式能力。

后续只允许两类浏览器相关能力：

1. 本地 `Live Renderer`
2. 真实浏览器附着能力

如果没有真实用户会话、真实 profile、真实附着入口，则不注册 `Browser Cursor`。

### 6.2 Minecraft

Minecraft 同理。

没有真实 server/runtime、没有稳定会话、没有明确在线反馈，就不注册 `Minecraft Cursor``。

保留方向可以是：

- 独立适配器
- 默认不注册
- 有真实世界连接时再挂进系统

## 7. 直播内容系统

直播内容层的核心目标：

不要只复读当前聊天，而要能从真实经历里取材。

未来建议新增：

```text
src/content/live/
  LiveExperienceSelector.ts
  LiveStoryBuilder.ts
  LiveMonologuePlanner.ts
```

职责：

- `LiveExperienceSelector`：从长期经历里筛出当前可讲素材
- `LiveStoryBuilder`：把真实经历转成适合直播口语的材料
- `LiveMonologuePlanner`：在没人说话时，也能主动从真实素材里开话题

## 8. 区别对待的边界

允许基于记忆做轻度区别对待，但仅限关系连续性。

可以受记忆影响的：

- 称呼
- 熟悉度
- 已知偏好
- 共同话题
- 未完成事项提醒

不可以受记忆影响的：

- 基本尊重
- 是否说真话
- 权限边界
- 是否提供基本帮助
- 是否长期贴负面标签

## 9. 分阶段实施计划

### 阶段 A：继续清理主运行时

目标：

- 进一步拆分 `LiveRendererServer` 与启动入口
- 继续清掉残余的伪浏览器暗示
- 明确 `Browser/Minecraft` 只有真实会话存在时才注册

完成标准：

- 主链路仍然能 `npm run build`
- README 与代码口径一致

### 阶段 B：建立 Markdown 记忆骨架

目标：

- 新增 `memory/` 目录
- 建立 `people / relationships / experiences / summaries / guilds / channels`
- 新增基础 writer / reader / search 入口

完成标准：

- 能写一条人物记忆
- 能写一条经历事件
- 能按 `id / tag / 关键词` 检索

### 阶段 C：建立事件总线与反思管线

目标：

- Discord / Live 输出统一事件
- InnerCursor 对重要事件做整理
- 长期记忆不再由 Cursor 直接写

完成标准：

- 至少一条 Discord 事件能进入长期经历文件
- 至少一条 Live 事件能进入长期经历文件

### 阶段 D：建立直播取材机制

目标：

- 让直播文案优先从经历中取材
- 没人互动时也能从经验池里开题

完成标准：

- 能从近期 `experiences/` 或 `summaries/` 生成一段 live monologue

### 阶段 E：情绪层只做表现增强

目标：

- 新增轻量情绪状态
- 只影响表达，不影响事实与权限

完成标准：

- 同一段内容能根据状态输出不同语气
- 不改变动作权限和记忆写入规则

## 10. 当前不做的事

为了避免架构再次过胖，下面这些先不做：

- SQLite 主存
- 全量向量库
- 未登录浏览器自动化
- 未连接 Minecraft 主干能力
- 复杂人格剧本系统
- 情绪直接参与路由决策

## 11. 阶段 B 最小落地接口

为了让阶段 C 的事件总线与反思管线有明确挂点，阶段 B 先只落最小闭环，不提前引入数据库、向量库或复杂调度。

当前建议固定为这组实现边界：

```text
src/memory/
  types.ts
  MarkdownMemoryStore.ts

src/tools/
  memory.ts

memory/
  people/
  relationships/
  experiences/
  guilds/
  channels/
  summaries/
```

### 11.1 Store 层职责

`MarkdownMemoryStore` 只做四件事：

1. 确保 `memory/` 目录结构存在
2. 把 record 写成 markdown + frontmatter
3. 按 `collection + id` 读取单条记忆
4. 按 `collection / id / tag / query` 做基础检索

它不负责：

- 判断一条事件值不值得记忆
- 自动生成人物结论
- 自动生成直播素材
- 处理跨 Cursor 的调度策略

### 11.2 Tool 层最小接口

阶段 B 先只暴露三类工具：

- `memory.write_record`
- `memory.read_record`
- `memory.search_records`

这样已经足够覆盖当前完成标准：

- 能写一条人物记忆
- 能写一条经历事件
- 能按 `id / tag / 关键词` 检索

### 11.3 Record 约束

统一 record 结构：

```yaml
id: string
collection: people | relationships | experiences | guilds | channels | summaries
type: string
source: string
updated_at: ISO datetime
created_at: ISO datetime?
title: string?
tags: string[]
related_ids: string[]?
metadata: object?
```

正文保持自然语言，不强迫结构化过度。阶段 B 的目标不是“一次把记忆建模到完美”，而是先让记忆稳定落盘、可读、可检索、可继续演进。

## 12. 最后一句

下一步不是继续发明更多工具，而是：

让 `Cursor` 提供真实现场；
让 `Memory` 沉淀真实经历；
让 `Content` 从真实经历里长出可讲内容。

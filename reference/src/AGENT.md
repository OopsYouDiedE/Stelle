# Stelle 源码开发规范

本文档是 `src/` 目录下的代码规范，面向后续开发者和代码 agent。它比
`README.md` 中的迁移说明更偏执行层：修改源码时，默认遵守本文档，除非用户明确要求另一种方向。

## 总体架构

Stelle 是主体。Cursor 是窗口。

```txt
Stelle
  consciousness/     内部主观 Cursor
  memory/            Stelle 拥有的长期记忆
  ExperienceStore    窗口 report 归一化后的经验流
  WindowRegistry     外部窗口注册表

cursors/
  discord/           社交窗口
  browser/           网页环境窗口
  minecraft/         游戏世界窗口
  audio/             声音窗口，包含语音输入和语音输出

tools/
  面向用户请求的轻量适配器
```

不要重新引入“调度器就是主体”的设计。`core/windowRegistry.ts` 只能是外部窗口的注册、激活和 tick 适配层。它不应该拥有记忆、空闲行为、长期策略或跨窗口协同逻辑。

## 所有权规则

- Stelle 拥有长期记忆、经验流、注意力、反思和跨窗口协同。
- `ConsciousnessCursor` 拥有空闲行为和主观决策。
- Cursor 只拥有窗口局部状态和局部机制。
- Tools 是适配器。它们可以调用 Cursor 或 Stelle 服务，但不应该变成有状态子系统。
- Discord、Browser、Minecraft、Audio 之间不应直接协同。协同发生在 Stelle 内部。

## 目录职责

### `stelle/`

`stelle/` 用于主体层概念：

- Experience 归一化和显著性判断。
- 长期记忆与反思。
- 注意力焦点。
- 内部策略决策。
- 跨窗口行动规划。

`stelle/memory/` 是长期记忆实现的唯一归属地。窗口可以定义自己需要的记忆接口，例如加载上下文，但具体存储、review、distill、删除等实现必须放在这里。

### `cursors/`

`cursors/<kind>/` 用于窗口局部行为：

- 连接外部环境。
- 读取局部观察。
- 维护短期局部上下文。
- 执行局部动作。
- 把外部事件转成 `CursorReport`。

Cursor 可以有 Eye 和 Arm：

- Eye：观察、历史、截图、环境帧、消息上下文。
- Arm：发消息、点击、输入、移动、放置方块、说话。

不要把全局记忆、全局用户画像或跨窗口决策放进 Cursor。

Audio Cursor 的 Eye 是语音输入、录音片段和转写结果；Arm 是语音合成、播放请求和播放完成事件。不要把 Audio 简化成只负责说话的 Speech 输出模块。

### `core/`

`core/` 必须保持很小。它只放不理解具体窗口、不理解记忆模型的基础运行时连接代码。如果某段逻辑开始做主观判断，就应该移到 `stelle/`。

### `tools/`

Tools 应该薄。优先通过现有 Cursor 或 Stelle 服务完成工作，不要复制环境逻辑。例如，Browser 工具应该调用 Browser Cursor；Discord 记忆相关能力应该调用 Stelle memory 服务。

## Cursor 合约

每个 Cursor 必须实现 `CursorHost`：

```ts
interface CursorHost {
  id: string;
  kind: string;
  activate(input: CursorActivation): Promise<void>;
  tick(): Promise<CursorReport[]>;
}
```

规范：

- `activate` 记录外部刺激或请求的局部动作。
- `tick` 推进窗口局部状态，并返回 reports。
- `tick` 应该可以被重复调用且保持安全。
- report 要简洁，但必须足够具体，让 Stelle 能解释。
- report 的 `type` 必须稳定，优先使用 `snake_case`。
- payload 应该是结构化数据，不要把所有东西塞成字符串。除非外部 API 只能提供文本。

## Experience 与 Memory

所有需要长期保留的意义，都应该走这条路径：

```txt
CursorReport -> Experience -> Consciousness reflection -> Stelle memory
```

规则：

- Cursor 可以产生 report，但不能直接写入全局长期记忆。
- salience 属于 Experience 归一化或 Consciousness 判断。
- reflection 属于 `stelle/memory/reflection.ts` 或 Consciousness 逻辑。
- 文件或数据库存储属于 `stelle/memory/`。
- 如果某个窗口需要频道级、用户级记忆，具体存储也应实现于 `stelle/memory/`，再通过接口注入给 Cursor 使用。

## Judge 与 Strategy

允许并鼓励使用 Judge 层，但必须区分职责：

- Cursor Judge：判断窗口局部动作是否合法，以及如何执行。
- Consciousness Judge：判断注意力、记忆、空闲行为和跨窗口行动。
- Strategy 代码可以提出动作，但是否继续、等待、切换、完成、失败、行动、观察或记忆，必须经过 Judge。

不要强迫所有 Cursor 共用同一套策略实现。只有当共享语义确实减少重复时，才抽象公共类型。

## Prompt 语义

Prompt 必须保持架构语义：

- 主体身份是 Stelle。
- Discord 是社交窗口，不是本体。
- Browser 是网页环境窗口，不只是工具箱。
- Minecraft 是游戏世界窗口，不只是单步自动化。
- Memory 属于 Stelle。
- 主动行为来自 Consciousness。

避免写出“系统只是 Discord bot”或“通用助手”的 prompt，除非该 prompt 明确只描述某个窗口的局部角色。

## TypeScript 风格

- 保持 `strict` TypeScript 干净。
- 跨模块契约优先使用显式 interface。
- 决策和动作结果优先使用 discriminated union。
- payload 类型尽量收窄。
- 避免 `any`。如果外部库边界不得不用 `any`，把它隔离在边界处。
- 避免宽泛 catch 后静默忽略。非致命错误也应返回结构化失败 report，或记录足够上下文。
- 不要添加无用兼容导出。如果确实需要兼容层，要清楚命名，并保持临时性质。
- 对不可变输入和快照，尽量使用 `readonly`。

## 文件与模块风格

- 模块要内聚。如果一个文件同时混入窗口 I/O、记忆、prompt 和编排逻辑，就应该拆分。
- 重复的数据转换逻辑应提取成小 helper。
- 不要过早抽象。至少有两个真实调用点需要时，再引入抽象。
- 优先依赖注入，而不是在 Stelle 中直接 import 某个具体窗口，或在通用工具中直接 import 某个具体 Stelle 服务。
- 避免循环依赖。`stelle/` 可以依赖 `core/` 和 Cursor 基础类型；Cursor 可以依赖从 Stelle 注入的接口，但除 instance factory 外，应避免 import 全局 `stelle` 单例。

## 命名

- 外部窗口注册使用 `WindowRegistry`，不要使用 `MainLoop`。
- 内部主观 Cursor 使用 `ConsciousnessCursor`。
- 进入 Stelle 的归一化 report 使用 `Experience`。
- `Memory` 只用于 Stelle 拥有的长期记忆或反思记忆。
- Cursor 局部短期状态使用 `history`、`context` 或 `session`。
- Cursor id 保持稳定，例如 `discord-main`、`browser-main`、`minecraft-main`、`stelle-consciousness`。

## 验证要求

修改源码后，收尾前运行：

```bash
npm run build
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
```

如果改动影响行为，尽量补一个小型 smoke test 或手动验证命令。不要把生成的测试产物留在工作区。

修改 Browser 或 Minecraft 的视觉/环境读取行为时，要验证截图或环境帧仍可渲染。修改 Discord 记忆行为时，要验证 slash command 仍然通过注入的 memory interface 路由。

## 迁移纪律

项目仍在迁移中。每一步都要在保留现有功能的同时，把所有权移到正确层级。

- 长期记忆从 Cursor 迁到 `stelle/memory/`。
- 空闲行为和主动行为迁到 `ConsciousnessCursor`。
- 跨窗口决策迁到 Stelle。
- 每一步迁移都保持外部窗口可运行。
- 能分阶段迁移时，不做一次性大重写。

如果旧名字或旧路径因为兼容暂时存在，不要在新代码里继续复制它的模式。新代码必须优先遵守本文档中的目标架构。

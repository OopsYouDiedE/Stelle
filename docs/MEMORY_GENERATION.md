# Stelle Memory Generation

这份文档说明记忆如何生成、压缩、审批和检索，重点是防止记忆系统被几个关键词带偏。

## Goals

Stelle 的记忆系统应该保留稳定、可解释、可追溯的信息，而不是把短期噪声当成事实。

核心目标：

- 最近事件可追溯。
- 长期记忆可审核。
- 检索排序不过度依赖单一关键词。
- LLM 压缩失败时有确定性 fallback。
- 不把未经确认的推断写成用户事实或核心身份。

## Memory Layers

| Layer         | Meaning                                   | Write Path                                    |
| ------------- | ----------------------------------------- | --------------------------------------------- |
| recent        | 原始短期事件，JSONL 追加写。              | `writeRecent()`                               |
| history       | recent 到达阈值后的 checkpoint 压缩结果。 | `createCheckpoint()` -> `compactCheckpoint()` |
| proposals     | 等待审核的长期记忆提案。                  | `proposeMemory()`                             |
| long-term     | 已写入的长期 Markdown 记忆。              | `writeLongTerm()`、`appendLongTerm()`         |
| research_logs | 内在循环或研究任务形成的反思记录。        | `appendResearchLog()`                         |

## Generation Flow

1. Cursor、直播 controller 或工具把事件写入 recent memory。
2. recent 达到 `recentLimit` 后，被移动到 checkpoint。
3. checkpoint 被压缩为 history block。
4. 如果配置了可用 LLM，压缩会提取 summary、participants、keywords。
5. 如果 LLM 不可用或失败，使用确定性 fallback：截断文本、简单关键词片段、可见参与者。
6. 长期记忆不应由普通事件直接写入，优先走 proposal 审核。

## Long-Term Memory Rules

长期记忆应满足至少一个条件：

- 用户明确表达的偏好、事实或长期目标。
- 多次出现且相互一致的行为模式。
- 系统运行所需的稳定自我状态。
- 已审核的节目设定、世界观或研究结论。

不要写入长期记忆：

- 单次情绪化表达。
- 未确认推断。
- 只由关键词相似产生的猜测。
- 已过期的直播临场状态。
- 重复刷屏、模板化弹幕、无上下文梗词。

## Anti-Bias Retrieval Design

检索不能只做 “关键词出现一次就加一分”。当前规则使用多信号评分：

- phrase signal：完整 query phrase 命中时加分。
- keyword coverage：显式关键词覆盖率加分，但单项封顶。
- token coverage：查询 token 覆盖率加分。
- diversity bonus：命中的不同信号越多，排序越靠前。
- weak-hit filter：当查询包含多个语义条件时，只命中一个词的记忆会被过滤。
- recent bonus：recent 可获得很小的新鲜度加分，但不能压过更完整的语义匹配。

这意味着：

- “Trashcan Trashcan Trashcan” 不会因为重复词多就压过更完整的上下文。
- 查询 “Trashcan quiet jokes Express” 时，只包含 “Trashcan” 的记录不会排在同时包含多个条件的记录前。
- 单关键词查询仍可工作，但只代表弱相关，不应该直接推动长期记忆写入。

## Proposal Review

记忆提案使用 `memory.propose_write` 或 `MemoryStore.proposeMemory()` 创建。审批时：

- 默认写入 `user_facts` 的 key 为 `user_<authorId>`。
- 其他 layer 默认写入 `approved_proposals`。
- 审批和拒绝都会记录 decision log。
- 控制页或工具层应该展示 proposal 的来源、理由、layer 和目标 key。

## Recovery

启动时会恢复 checkpoint：

- 只扫描已知 `live` 和 `discord` 根目录。
- 不扫描整个 workspace。
- 找到未完成 checkpoint 后重新压缩。
- 空 checkpoint 会被删除。

## Testing Expectations

修改记忆生成、压缩、搜索或 proposal 行为时，至少运行：

```powershell
npx tsc --noEmit
npx vitest run test/capabilities/cognition/memory_rag.test.ts
npm test
```

如果修改 prompt、LLM 压缩行为或长期记忆策略，再运行：

```powershell
npm run test:eval
```

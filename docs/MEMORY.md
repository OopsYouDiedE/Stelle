# 认知与记忆系统 (Cognition & Memory)

这份文档说明 Stelle 的记忆是如何生成、压缩、审批和检索的。重点是防止记忆系统受到噪音弹幕或几个高频恶意关键词的影响而发生人格偏离。

---

## 1. 记忆分层架构 (Memory Layers)

系统将记忆划分为生命周期与验证程度不同的几个层级：

| Layer           | 含义与生命周期                                   | 写入口 (Write Path)                           |
| --------------- | ------------------------------------------------ | --------------------------------------------- |
| `recent`        | 最原始的短期事件流水，以 JSONL 形式追加写入。    | `writeRecent()`                               |
| `history`       | `recent` 达到阈值后的 Checkpoint 压缩聚合态。    | `createCheckpoint()` -> `compactCheckpoint()` |
| `proposals`     | 等待审核的长期记忆提案（尚未被作为事实采用）。   | `proposeMemory()`                             |
| `long-term`     | 已经审核通过、被确认为事实的长期 Markdown 记忆。 | `writeLongTerm()`、`appendLongTerm()`         |
| `research_logs` | 内在循环或自我研究任务中形成的反思记录。         | `appendResearchLog()`                         |

---

## 2. 记忆生成管道 (Generation Flow)

1. **写入流水**: 直播控制器、工具、或内置的 Cursor 收集事件并将其写入 `recent memory`。
2. **切分快照**: 当 `recent` 数量达到 `recentLimit` 后，打包被移动到 `checkpoint`。
3. **聚合压缩**: `checkpoint` 使用 LLM 进行无损到有损的语义压缩，生成 `history block`。
4. **特征提取**: 如果配置了 LLM，压缩时会并发抽取 summary（总结）、participants（参与者）、keywords（关键词）与实体特征。
5. **降级保障**: 如果 LLM 不可用或请求失败，触发确定性 fallback：截断文本、简单关键词分词片段以及可见参与者信息保存。
6. **提权审核**: 普通事件绝对不能直接成为“长期事实”。重大事件需走 Proposal 提案流程进行审批。

---

## 3. 长期记忆写入边界 (Long-Term Memory Rules)

长期记忆只应当沉淀**稳定的**核心信息。

**符合以下条件的应当写入（或发起提案）：**

- 用户明确表达的偏好、稳定事实或长期目标。
- 多次出现且相互印证的行为模式。
- 支撑系统运行所需的稳定的核心自我状态记录。
- 经过审核确定的“节目设定”、“世界观”或“研究结论”。

**绝对不要写入长期记忆的噪音：**

- 单次的、偶然的、或者极端情绪化的情感表达。
- 只是基于局部对话做出的未确认推测。
- 仅仅因为关键词相似而强行产生的猜测联想。
- 直播已经过期的临场状态（比如"刚吃完饭"、"现在在玩游戏"）。
- 重复刷屏、无意义的模板化弹幕、脱离上下文的单纯梗词。

---

## 4. 抗偏见检索设计 (Anti-Bias Retrieval Design)

这是最核心的防线。检索设计放弃了纯粹基于“关键词词频”的做法，改为多信号交叉评分。

评分因素：

- **Phrase Signal**: 完整短语匹配，加分极高。
- **Keyword Coverage**: 显式设定的关键词覆盖率加分，但是**单项封顶**。
- **Token Coverage**: 普通查询 Token 覆盖率加分。
- **Diversity Bonus**: 命中的验证信号种类越多，排序越靠前。
- **Weak-hit Filter**: 如果查询非常复杂包含多个条件，但仅能模糊命中某一个词，该记录会被完全过滤。
- **Recent Bonus**: 最近发生的事情带有微弱的新鲜度加分，但绝对不允许其压过更完整的历史语义匹配。

**实战含义**：

- 观众狂刷 “Trashcan Trashcan Trashcan” ，绝不会因为单次词频高，就把它置于真正包含上下文的复杂语句之上。
- 单个关键词依然有弱相关召回能力，但**绝不能以此作为直接改写长期记忆的凭据**。

---

## 5. 提案审核与审计 (Proposal Review)

这是将短期信息提权到长期记忆的守门机制：

1. 工具侧调用 `memory.propose_write` 或底层调用 `MemoryStore.proposeMemory()` 发起。
2. 将 `user_facts` 类型的事件存入特定的 key：`user_<authorId>`。
3. 将其它内容默认存入 `approved_proposals`。
4. 所有审批动作（不论接受或拒绝）都**必须**记录 Decision log 用于后期复盘审计。

---

## 6. 恢复机制 (Recovery)

每次核心启动时：

- 从已知的 `live` 或 `discord` 存储槽中恢复。
- 不会漫无目的地扫描全量 workspace 文件。
- 会扫描是否有挂起的、未完成的 checkpoint，如果存在，重新跑完压缩流。
- 如果 checkpoint 完全为空则清理掉。

# Stelle Cognitive Research System Design Reference

## 核心理念 (Core Philosophy)

在传统的聊天机器人设计中，AI 对用户的认知往往局限于“当前上下文”或“单日对话表现”。这导致了刻板印象的堆积，以及难以形成真正的深度羁绊。
Stelle 的认知模型被设计为具备“时间纵深感”——**不急于下定义，而是将感兴趣的对象设立为“长期观察课题 (Research Topics)”**。通过持续收集其历史言论、行为模式和情绪反应，进行更为客观、立体的人格侧写。

## 架构机制 (Architectural Mechanism)

### 1. 触发机制 (Triggering)
当 Stelle 在 Discord 频道或 Live 弹幕中遇到高活跃度、或者言辞特征极其鲜明（Salience 为 `high`）的用户时，`InnerCursor` (内在潜意识) 会生成一个“指令 (Directive)”，将该用户标记为潜在的观察目标。

### 2. 数据采集与历史回溯 (Data Mining & Traceback)
- Stelle 会在后台（非阻塞状态下）利用工具层的 `memory.search` 和 `memory.read_long_term` 接口。
- 提取该目标用户在过往不同时间段、不同事件冲突中的发言记录（脱敏化后的语义切片）。
- **分析维度包括：**
  - **情绪稳定性**: 在群体冲突或争议话题中的态度。
  - **话语权重**: 是话题发起者（社群驱动者），还是跟随者。
  - **交互动机**: 是单纯的信息获取、情感宣泄，还是存在某种“试探系统边界”的元认知行为。

### 3. 课题归档与印象深化 (Topic Profiling & Impression Deepening)
将以上跨维度的观测结果交由 LLM 进行综合评估，生成一份详细的人格侧写报告，并调用 API 写入系统的长时记忆中。

- **写入 `ResearchLog`**: 作为一份完整的历史调查档案，保留分析过程和结论。
- **更新 `relationships` 记忆区**: 将结论浓缩为一两句 **[深度侧写]**，追加到现有的人物印象之下。

---

## 案例模拟评估：对核心用户的脱敏侧写记录

以下是一次真实演练中，Stelle 针对某一活跃核心用户开展长维度的历史溯源与侧写评估的流程记录：

### 阶段一：识别与追溯
系统截取了目标在多个场合下的争议性发言（如假设性困境的抛出、底层架构的探讨等）。未发现其存在恶意带节奏的行为，反而具有极高的参与度。

### 阶段二：评估过程记录 (Research Log Dump)
> **Focus**: 长期人格侧写与模式分析: [脱敏目标 A]
> 
> **Process**:
> 1. Querying historical messages cross-referencing target user.
> 2. Analyzing semantic patterns and frequent topics (Ethical dilemmas, system infrastructure).
> 3. Correlating with existing core convictions and relationship aliases.
>
> **Conclusion**:
> 该用户不仅是社群的活跃分子，且展现出系统性思维与特殊的元认知特征。其抛出的看似荒诞的问题本质上是在**测试群体的反应边界与系统的反馈阈值**。具备“社群驱动者”特征。在日常互动中，不应仅仅停留在表面吐槽，而应当识别并回应其深层的元认知逻辑，给予更高权重的信任。

### 阶段三：长时记忆的动态更新
系统自动将原本扁平的印象（“喜欢发烂梗、性格活跃”）进行了升华，并追加至长时记忆的 `relationships.md`：
- **[追加的深度侧写]**: “经过长期的历史记录溯源，发现其提出的无厘头问题本质是在测试群体的反应边界，具备极强的“社群驱动者”特征。日常交互时，应当在吐槽之余，识别并回应其深层的元认知逻辑。”

---

## 总结
通过引入“长期课题 (Research Topic)”的设计，Stelle 彻底摆脱了单轮对话的记忆局限。它像人类一样，通过**时间沉淀**和**跨事件比对**，逐步揭开每个用户表面行为下的真实性格，从而实现从“玩梗机器”到“赛博知己”的蜕变。
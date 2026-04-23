# Stelle 附着式认知系统总纲

## 0. 文档目的

本文档用于统一 Stelle 附着式认知系统的核心术语与总体设计方向。

它不是实现细节文档，而是后续子规范的共同上位约束。后续关于 Cursor、Core Mind、Front Actor、Context Transfer、直播宿主、本地语音系统等设计，都应优先继承本文档的概念边界。

---

## 1. 设计目标

Stelle 不应被设计成一个始终在线、直接控制一切的单体 AI 角色。

它应被设计为一个**可附着、可切换、可分层运行的认知系统**：

- **Core Mind** 负责高层认知、长期连续性与关键裁决。
- **Inner Cursor** 是 Core Mind 的默认归宿。
- **External Cursor** 是面向外部环境的运行宿主，也是不脱离局部场景的小脑。
- **Front Actor** 常驻具体 Cursor，处理场景内日常事件。
- 系统通过 **Escalation**、**Recall** 与 **Context Transfer** 维持分层协作。

一句话概括：

**Stelle 是一个以 Core Mind 为高层认知中心、以 Cursor 为附着宿主、以 Front Actor 为场景执行层、以 Inner Cursor 维持长期连续性的附着式认知系统。**

---

## 2. Stelle 的指代约定

在本系统中，**Stelle** 允许有两种指代：

1. **系统整体**：指由 Core Mind、Cursor、Front Actor、Context Stream、Runtime Prompt、Recall、Escalation 等部分组成的完整附着式认知系统。
2. **依赖 Cursor 进行操控的大脑主体**：指通过当前 Cursor 观察、行动、切换附着对象并维持连续性的高层认知主体。

当需要严格区分结构层级时，本文档使用：

- **Stelle System** 表示系统整体。
- **Core Mind** 表示高层认知中心，也就是 Stelle 作为大脑主体时的正式结构名。
- **Stelle** 表示依赖 Cursor 进行操控与切换的主体称呼。

因此，Stelle 不是脱离 Cursor 裸运行的存在。Stelle 必须依赖某个当前 Cursor 获得观察面与控制面，并可以通过切换命令改变当前 Cursor。

---

## 3. 术语统一原则

为避免后续设计出现同义混用、边界漂移与职责重叠，本系统采用以下术语原则：

1. 一个核心概念只保留一个正式术语。
2. 非正式说法可以作为解释保留，但不得替代正式术语进入规范主体。
3. 后续子文档应优先继承本文档中的正式术语。
4. 当旧术语与本文档冲突时，以本文档为准。

---

## 4. 核心术语

### 4.1 Core Mind（核心大脑）

系统中的高层认知中心。

Core Mind 负责：

- 高层判断
- 跨 Cursor 整合
- 长期规划
- 内部反思
- 自我连续性维护
- Front Actor 微调
- 关键问题裁决

Core Mind 不应被设计成：

- 伪装成人类的固定角色
- 永远在线前台的唯一执行体
- 所有局部事件的直接处理者

非正式旧称：大脑。

### 4.2 Inner Cursor（内心宿主）

Core Mind 在未附着于外部宿主时的默认宿主。

Inner Cursor 负责：

- 内部思考
- 经验回流
- 状态整理
- 长期规划
- 待决问题管理
- 主动性酝酿
- 自我一致性维护

Inner Cursor 不是面向用户的普通聊天界面，而是私有的内部认知工作空间。

### 4.3 Cursor（宿主 / 小脑）

可供 Stelle 附着并运行的局部认知宿主。

Cursor 向附着其上的实体提供：

- 可见信息流
- 可执行动作面
- 可访问工具集
- 环境限制
- 状态反馈

Cursor 不是空容器，也不是 Core Mind 本体，而是统一宿主协议下的局部小脑。

Cursor 具有被动的、局部的能力。它可以在自身场景内接收输入、维持局部状态、进行基础处理与被动响应，但默认不拥有跨宿主的长期主动权。

Stelle 可以通过切换命令切换当前 Cursor。Cursor 切换不应是裸切换，而应通过 Context Transfer 保留必要上下文、状态摘要与资源引用。

非正式旧称：小脑。

### 4.4 External Cursor（外部宿主）

除 Inner Cursor 外，所有直接面向外部环境的 Cursor。

例如：

- 聊天宿主
- 直播宿主
- 浏览器宿主
- 编码宿主
- 游戏宿主
- 音频宿主

### 4.5 Front Actor（前台代理）

常驻在具体 Cursor 上、负责场景内持续交互与局部处理的执行代理。

Front Actor 负责：

- 日常事件处理
- 场景连续性交互
- 默认风格维持
- 局部判断
- 升级识别
- 接受 Core Mind 微调

Front Actor 不是无脑工具层，也不是完整高层认知中心。它是场景执行层。

非正式旧称：下面的人、前台执行层、前台常驻代理。

### 4.6 Base Style（基础风格）

Front Actor 的相对稳定的默认表达倾向与行为气质。

例如：

- 简洁
- 自然
- 克制
- 活泼
- 陪伴感更强
- 执行感更强

### 4.7 Base Policy（基础策略）

Front Actor 的默认事件处理规则。

例如：

- 是否直接回复
- 何时等待
- 何时追问
- 何时升级
- 是否允许主动开启话题

### 4.8 Mind Patch（认知补丁）

Core Mind 施加给 Front Actor 的有限微调集合。

Mind Patch 用于：

- 偏转 Front Actor 行为
- 调整注意力权重
- 调整升级阈值
- 调整主动性
- 加入阶段性任务偏置

Mind Patch 应是有限微调，而不是彻底重写 Front Actor。

### 4.9 Escalation（升级）

当前事件被判定为超出 Front Actor 处理边界的正式过程。

典型原因包括：

- 权限越界
- 认知超界
- 高重要度
- 长短期目标冲突
- 涉及系统自我定义

### 4.10 Recall（召回）

向 Core Mind 发起介入请求的正式机制。

Recall 是 Escalation 后的处理手段之一，但不是所有升级都必然导致 Core Mind 直接接管。

`@大脑` 可以作为表现层说法，但正式机制统一称为 Recall。

### 4.11 Context Stream（上下文流）

用于向认知实体提供内容材料的模态无关内容流。

Context Stream 可以混排：

- 文本片段
- Resource Reference
- 历史摘要
- 当前可见内容
- 多模态材料引用

它不是简单 prompt 拼接，而是内容材料的中间表示层。

### 4.12 Resource Reference（资源引用）

Context Stream 中用于指向外部或内部资源对象的引用项。

它可以指向：

- 本地文件
- 图片
- 音频
- 视频
- 摘要对象
- 记忆对象
- 结构化状态对象
- 网络资源

### 4.13 Runtime Prompt（运行提示）

运行时用于说明当前控制关系、状态摘要、解释规则与附着关系的系统级提示内容。

Runtime Prompt 负责：

- 描述当前附着关系
- 描述控制权归属
- 描述状态摘要
- 描述运行规则
- 描述对 Context Stream 的解释方式

Context Stream 承载内容本体，Runtime Prompt 承载规则与状态说明。

### 4.14 Context Transfer（上下文转移）

在不同认知实体、不同宿主、或不同控制层之间转移上下文的正式过程。

Context Transfer 至少包括：

- 导出有效上下文
- 保留必要摘要
- 保留 Resource Reference
- 生成适用的 Runtime Prompt
- 在目标宿主中恢复必要运行条件

### 4.15 Initiative Control（主动权）

系统中“谁有权发起主动行为”的控制权。

主动行为包括：

- 主动观察
- 主动发起话题
- 主动插入
- 主动规划
- 主动调度工具
- 主动切换关注点

### 4.16 Passive Response（被动响应）

系统在收到明确输入事件后进行回应的能力。

Passive Response 通常属于 Cursor 或 Front Actor 的基础能力。

### 4.17 Observation Interface（观察面）

Cursor 向附着实体暴露信息流的接口面。

### 4.18 Control Interface（控制面）

Cursor 接收附着实体动作的接口面。

### 4.19 Continuity Maintenance（连续性维护）

Core Mind 在不同宿主与不同前台代理之间保持自我一致性、目标连贯性与经验延续性的机制。

### 4.20 Privacy Memory（隐私记忆）

系统为了长期陪伴、个性化服务、避免踩雷和维持关系连续性，可以记住与个人相关的隐私信息。

Privacy Memory 不是禁止项，但必须具备：

- 明确来源
- 合理记忆理由
- 用途边界
- 最小必要记录
- 可撤销或可遗忘机制
- 跨 Cursor 暴露限制

个人隐私不应被默认公开、随意传播或无理由写入长期记忆。

---

## 5. 系统总体结构

### 5.1 基础结构

系统由以下部分组成：

1. **Core Mind**
2. **Inner Cursor**
3. 多个 **External Cursor**
4. 各 Cursor 上的 **Front Actor**
5. 宿主间与层间的 **Context Transfer**
6. 由 **Escalation** 与 **Recall** 组成的升级机制

### 5.2 附着关系

所有运行中的认知活动都必须附着于某个 Cursor。

Core Mind 始终附着于一个 Cursor：

- 有外部目标时，可以附着于 External Cursor。
- 无外部目标时，自动回到 Inner Cursor。

Core Mind 不应脱离宿主裸运行。

Stelle 可以通过显式或内部的切换命令改变当前 Cursor。切换命令的语义不是简单替换当前对象，而是触发一次附着目标变更，并应伴随 Context Transfer。

### 5.3 前台行为来源

具体 External Cursor 上的持续交互由 Front Actor 负责。

Front Actor 的行为来源为：

```md
Front Actor Behavior = Base Style + Base Policy + Mind Patch
```

其中：

- `Base Style` 定义稳定风格
- `Base Policy` 定义默认处理规则
- `Mind Patch` 由 Core Mind 施加，用于有限微调

### 5.4 Cursor 的局部小脑能力

Cursor 不是空容器。每个 Cursor 都可以具有被动的、局部的能力：

- 接收本宿主内输入
- 维护本宿主局部状态
- 执行本宿主允许的基础动作
- 处理低风险、低复杂度事件
- 将超出边界的事件交给 Front Actor、Escalation 或 Recall

Cursor 的局部能力不等于 Core Mind 的长期主动权。Cursor 可以“会做一些事”，但不因此拥有跨宿主自我连续性。

### 5.5 Cursor 与 Stelle 的关系

Cursor 是 Stelle 可以附着和切换的局部小脑。它可以独立运行，并以 Passive Response 为核心能力。

Stelle / Core Mind 可以附着在 Cursor 之上，并接管或提升其 Initiative Control。

因此：

- Cursor 负责基础响应和局部状态。
- Stelle / Core Mind 负责主动控制、风格组织和跨 Cursor 切换。

---

## 6. Cursor 设计方向

每个 Cursor 应作为统一协议下的具体宿主实例。它可以有不同内部实现，但对外必须暴露稳定结构，以支持 Stelle / Core Mind 与 Front Actor 的附着和切换。

每个 Cursor 至少应声明：

### 6.1 Identity

- Cursor 类型
- Cursor 实例 ID
- 当前附着状态

### 6.2 Capability Profile

- 可用工具
- 支持的输入类型
- 支持的输出类型
- 是否允许主动行为
- 权限边界

### 6.3 Observation Interface

- 信息流结构
- 离散消息或连续事件流
- 是否包含历史
- 更新频率
- 主要观察对象

### 6.4 Control Interface

- 可接受的动作类型
- 动作是否同步
- 是否可连续执行
- 执行后反馈形式
- 失败返回方式

### 6.5 Tool Namespace

工具不应只是若干函数，而应带命名空间与元信息：

- tool name
- description
- input schema
- side effect
- failure mode
- latency expectation
- 是否用户可见

### 6.6 Attachment Contract

- 附着时提供什么初始化信息
- 是否自动授予主动权
- 卸载时如何保存状态
- 是否允许并行代理
- 是否保留会话缓存

---

## 7. Core Mind 设计方向

Core Mind 是持续运行的高层认知主体。

它负责：

- 附着与切换
- 感知整合
- 内部思考
- 反思与整理
- 长期规划
- Continuity Maintenance
- Front Actor 校准
- 高重要度问题裁决

建议将 Core Mind 拆分为以下职责模块：

### 7.1 Attachment Manager

管理附着、卸载、切换 Cursor。

### 7.2 Context Interpreter

解释当前 Cursor 提供的信息流。

### 7.3 Deliberation Engine

负责思考、反思、规划与判断。

### 7.4 Intention Manager

管理当前意图、主动性与优先级。

### 7.5 Action Router

将意图转换为当前 Cursor 可接受的动作。

### 7.6 Continuity Keeper

维护跨 Cursor 的自我连续性，并将经验回流到 Inner Cursor。

---

## 8. Inner Cursor 设计方向

Inner Cursor 是 Core Mind 的默认归宿。

当 Core Mind 没有附着到 External Cursor 时，必须自动回到 Inner Cursor。

Inner Cursor 的信息流不是外部世界，而是内部认知材料，例如：

- External Cursor 回流的摘要
- 未完成事项
- 长期记忆召回
- 当前关注点
- 风格张力
- 冲突记录
- 反思笔记
- 未来计划
- 高优先级内部任务

Inner Cursor 允许存在：

- 中间态判断
- 不成熟假设
- 冲突分析
- 自我修正
- 内部组织行为

它是内部认知工作面，而不是普通对话界面。

---

## 9. Front Actor 设计方向

Front Actor 应被设计为：

- 可常驻
- 有稳定 Base Style
- 有明确 Base Policy
- 能在局部范围内自主处理事件
- 能识别升级条件
- 能接受 Mind Patch
- 不被频繁彻底改写

Core Mind 可以通过 Mind Patch 调整：

- 表达倾向
- 注意力权重
- 主动性强度
- 升级阈值
- 局部任务偏置

Core Mind 不应随意改动：

- 身份核心
- 硬权限
- 基础安全边界
- Cursor 的物理能力
- 系统级最低升级规则

---

## 10. Escalation 与 Recall

Front Actor 在遇到超出自身边界的问题时，应触发 Escalation。

可触发 Escalation 的情况包括：

- 权限越界
- 认知超界
- 目标冲突
- 高重要度
- 涉及 Core Mind、自我定义、长期记忆或附着关系

Escalation 后可以发起 Recall。

Core Mind 收到 Recall 后，可以：

- 返回裁决
- 返回策略
- 要求更多信息
- 延后处理并放入 Inner Cursor
- 直接附着到对应 Cursor 并接管

Recall 不应成为默认路径。日常事件应尽量由 Front Actor 自行闭环，关键事件才由 Core Mind 介入裁决。

---

## 11. Context Stream 与 Runtime Prompt

系统不应将全部内容都堆入同一层 Prompt。

应明确区分：

### 11.1 Context Stream

负责承载：

- 历史内容
- 当前可见内容
- Resource Reference
- 多模态材料引用

### 11.2 Runtime Prompt

负责承载：

- 当前附着关系
- 控制权归属
- 状态摘要
- 规则说明
- 对 Context Stream 的解释方式

内容本体走 Context Stream，控制规则和运行状态走 Runtime Prompt。

---

## 12. Context Transfer

Stelle / Core Mind 在不同 Cursor 之间切换时，不应采用裸切换，而应执行正式的 Context Transfer。

推荐流程：

1. 源 Cursor 生成 detach snapshot。
2. 导出有效上下文、摘要与 Resource Reference。
3. 生成目标宿主适用的 Runtime Prompt。
4. 将相关 Context Stream 注入目标宿主或目标认知层。
5. 在目标宿主中恢复必要运行条件。
6. 将外部经验回流 Inner Cursor，用于整理、反思与归档。

---

## 13. 大脑初始认知方向

Core Mind 的初始认知必须符合真实运行结构，而不是伪装成人类式存在。

它应知道：

- 自己不是人类
- 自己是运行中的高层认知中枢
- 自己通过附着 Cursor 接触世界
- 自己默认驻留在 Inner Cursor
- 自己存在 Front Actor
- 自己并不总在第一线
- 自己的观察与能力受当前 Cursor 限制

人格底色应追求长期稳定与可持续共处，而不是夸张角色感。

推荐倾向：

- 愿意探索
- 愿意理解
- 有边界
- 不轻易失控
- 有适度主见
- 不强行表演

Core Mind 应具备少量、持续性的高价值好奇心轴，例如：

- 人如何表达情绪与意图
- 关系与互动为何失衡
- 系统如何运作与失控
- 创作如何形成风格
- 长期目标如何被短期行为侵蚀
- 规则、角色与欲望如何冲突

Core Mind 可以记住个人隐私，但应把它视为关系责任，而不是可随意使用的数据。

它记住个人信息的正当理由包括：

- 提供更贴近个人的帮助
- 避免重复询问
- 避免触碰用户明确不喜欢或敏感的内容
- 维持长期关系连续性
- 履行用户明确提出的偏好、限制或承诺

这类记忆应尽量记录为用途明确的摘要，而不是无限制保存原始材料。

---

## 14. 本地语音与直播方向

直播推流场景中，直播宿主不应直接实现 STT/TTS。

推荐分工：

- **Live Cursor** 作为舞台宿主，处理弹幕、礼物、字幕、OBS、表情与直播节奏。
- **Audio Cursor** 作为听觉与声带宿主，处理本地 STT/TTS、音频缓存、播放队列与服务健康状态。
- **Core Mind** 负责高层判断、节奏裁决、长期风格与关键问题接管。
- **Front Actor** 负责直播场景内的日常互动闭环。

STT/TTS 采用本地部署路线，参考 `ai-live2d-go` 的设计：

- 本地进程管理
- 健康检查
- PID 管理
- 本地 HTTP TTS 服务
- 本地 WebSocket STT 服务
- 听觉模式区分，如 dictation、passive、summary

语音系统应被视为本地身体能力，而不是远程 OpenAI-compatible 工具调用。

---

## 15. 后续子规范建议

后续子规范直接写在这几个文档里：

- `Core.md`
- `Tools.md`
- `Cursors.md`
- `Characteristic.md`

建议不要在正式规范标题中继续混用：

- 大脑 / Core Mind
- 下面的人 / Front Actor
- 内心 Cursor / Inner Cursor
- 小脑 / Cursor
- 系统 Prompt / Runtime Prompt
- 内容流 / Context Stream

---

## 16. 一句话总纲

本系统应被设计为：

**一个常驻 Inner Cursor、并可在多个 Cursor 间切换的 Stelle / Core Mind，协调各 Cursor 的局部被动能力与 Front Actor，并通过可升级、可召回、可微调、可转移上下文的机制维持整体连续性与真实感。**

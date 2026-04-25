# Stelle 直播架构

这份文档定义当前直播系统本身的职责边界。

核心原则只有一句话：

低风险直播内容可以在本地直接生成，高风险直播内容必须升级给 Stelle 处理。

## 目标

直播层需要同时满足两件事：

1. 现场不能轻易冷掉
2. 对外可见内容不能因为本地模板而越权、造事实、乱代表关系

这里先明确一个前提：

- `Live` 是 `Live`
- `Discord` 是 `Discord`
- Discord 触发直播内容，只是当前为了调试和测试跨 Cursor 协作保留的一条桥接入口

它不是直播系统的上游依赖，也不是直播系统的架构中心。

所以直播链路要拆成两层：

- `Live Cursor / Live Runtime`：负责执行现场动作
- `Live Content Routing`：负责决定这段内容能不能本地生成

## 分层

### 1. 执行层

执行层只做真实可执行动作，不负责决定内容立场：

- 设置字幕
- 触发 TTS
- 切 Live2D 动作
- 切背景
- 推送音频流
- 同步 OBS / renderer 状态

这一层对应当前代码里的：

- [src/cursors/live/LiveCursor.ts](/C:/Users/zznZZ/Stelle/src/cursors/live/LiveCursor.ts)
- [src/live/LiveRuntime.ts](/C:/Users/zznZZ/Stelle/src/live/LiveRuntime.ts)
- [src/tools/live_tools](/C:/Users/zznZZ/Stelle/src/tools/live_tools)

### 2. 内容路由层

内容路由层先判断一段直播请求属于哪一类，再决定走本地生成还是 Stelle 生成。

这一层对应当前新增的：

- [src/stelle/LiveRouteDecider.ts](/C:/Users/zznZZ/Stelle/src/stelle/LiveRouteDecider.ts)
- [src/stelle/LiveLocalScriptGenerator.ts](/C:/Users/zznZZ/Stelle/src/stelle/LiveLocalScriptGenerator.ts)
- [src/stelle/LiveContentController.ts](/C:/Users/zznZZ/Stelle/src/stelle/LiveContentController.ts)

如果内容来自 Discord，目前只是再通过一个适配器桥接进去：

- [src/stelle/DiscordLiveController.ts](/C:/Users/zznZZ/Stelle/src/stelle/DiscordLiveController.ts)

## 风险分流规则

### 本地可生成

这些内容默认视为低风险：

- 暖场
- 转场
- 串场
- 试音 / 状态播报
- 轻量节奏维持
- 不带事实承诺的轻主题展开

本地生成的约束：

- 只能说短句
- 只能维持气氛和节奏
- 不下事实结论
- 不替任何人发言
- 不调用长期记忆来强化“好像很懂”的错觉

### 必须升级给 Stelle

这些内容默认视为高风险：

- 事实判断、新闻、解释、分析、推荐、评价
- 带立场、带承诺、带公共表态的内容
- 点名互动、替别人说话、面向特定观众的社交动作
- 依赖记忆、关系连续性、既往经历的内容
- 隐私、敏感、违法、自伤等风险内容

Stelle 路径允许：

- 使用 `textProvider`
- 按需做 recall
- 结合当前上下文生成更完整的话术

但就算走 Stelle 路径，也仍然只能通过 live tool 落到真实动作层。

## 当前主链路

直播系统自己的主链路应当理解为：

```text
Live request
-> LiveContentController
-> LiveRouteDecider
   -> local
      -> LiveLocalScriptGenerator
      -> live.stelle_enqueue_speech / live.stelle_stream_tts_caption / live.stelle_set_caption
   -> stelle
      -> textProvider + optional recall
      -> live.stelle_enqueue_speech / live.stelle_stream_tts_caption / live.stelle_set_caption
-> LiveCursor / LiveRuntime
-> Live Renderer / OBS
```

## Discord 桥接链路

当前为了调试和测试跨 Cursor 协作，仓库里还保留了一条可选桥接：

```text
Discord live request
-> DiscordLiveController
-> LiveContentController
-> LiveCursor / LiveRuntime
```

这条链路的定位只有两个：

- 调试 live 内容生成
- 测试跨 Cursor 协作

它不意味着直播依赖 Discord，也不意味着 Discord 是直播系统的控制平面。

## 为什么这样拆

如果所有直播口播都直接走 Stelle：

- 成本高
- 延迟高
- 很多简单暖场没有必要

如果所有直播口播都走本地模板：

- 很容易在公开场景里乱讲
- 会误碰事实、关系、立场和敏感话题

所以最稳的办法不是二选一，而是先分流。

## 当前实现约定

### 本地层负责什么

- 生成安全 filler
- 生成保守转场
- 生成状态播报
- 在 Stelle 不可用时生成 guarded fallback

### Stelle 层负责什么

- 生成需要判断的直播内容
- 处理记忆和关系相关内容
- 处理事实性或敏感性更高的话题

### Live Cursor 负责什么

- 播放
- 展示
- 记录 live event
- 维持 speech queue

它不负责：

- 判断这段话能不能说
- 自己决定要不要调用长期记忆
- 自己生成高风险对外内容

### Discord 适配层负责什么

- 把 Discord 里的 live 调试指令桥接到 live 内容控制器
- 验证跨 Cursor 协作链路是否正常

它不负责：

- 定义直播系统的主架构
- 充当直播系统唯一入口
- 让 Live 和 Discord 绑定成一个系统

## 后续扩展方向

下一步如果要继续演进，应该优先补这些层，而不是直接往 `LiveRuntime` 里塞更多逻辑：

- `LiveMonologuePlanner`：决定什么时候需要主动开口
- `LiveTopicSelector`：从当前上下文或经验池挑安全话题
- `LiveRiskAnnotator`：对待播内容做更细粒度风控标签

不建议做的事：

- 让 `LiveCursor` 自己直接生成高风险文案
- 让模板层直接讲事实、讲关系、讲记忆
- 把 risk routing 和 renderer 执行层再次混在一起

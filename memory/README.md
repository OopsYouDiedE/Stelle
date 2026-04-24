# Memory

Stelle 的长期记忆主存先落在仓库根目录下的 Markdown 文件里。

当前约定的目录：

- `memory/people/`
- `memory/relationships/`
- `memory/experiences/`
- `memory/guilds/`
- `memory/channels/`
- `memory/summaries/`

文件使用轻量 frontmatter，正文存放可读的自然语言材料。

最小 frontmatter 结构：

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

运行时当前已提供三类基础接口：

- `memory.write_record`
- `memory.read_record`
- `memory.search_records`

当前仓库里的长期记忆已经不是单纯的存储层，而是完整管线：

- `MemoryEventBus`：接收 Discord 入站、Discord 出站、Live 动作事件
- `MemoryTriage`：决定哪些事件只更新档案、哪些事件值得写成 experience
- `MemoryManager`：顺序处理事件、驱动 reflection、落盘 record、更新 daily summary
- `MarkdownMemoryStore`：负责最终的 markdown/frontmatter 读写与检索

当前自动沉淀的集合：

- `people/`：用户长期画像
- `relationships/`：用户与 Stelle 的关系连续性
- `channels/`：频道层面的长期上下文
- `guilds/`：服务器层面的长期上下文
- `experiences/`：值得保留的 Discord / Live 事件
- `summaries/`：按天汇总的长期摘要

当前 recall 已接入：

- Discord 回复生成会读取相关人物、关系、频道、服务器与经验记录
- Live 文案生成会读取相关 `experiences/` 与 `summaries/`
